import { Type } from "@google/genai";
import { access } from "node:fs/promises";
import path from "node:path";

import {
  GEMINI_STATE_MODEL,
  KNOWLEDGE_EXTRACT_BASE_DELAY_MS,
  KNOWLEDGE_EXTRACT_CONCURRENCY,
  KNOWLEDGE_EXTRACT_RETRIES,
  KNOWLEDGE_FETCH_TIMEOUT_MS,
  KNOWLEDGE_MAX_TEXT_CHARS,
  KNOWLEDGE_MAX_URLS,
} from "@/lib/config";
import { getGeminiClient, SAFETY_SETTINGS_BLOCK_NONE } from "@/lib/gemini";
import { gameDir, isValidGameSlug, loadGameDef } from "@/lib/games";
import { chapterFileName } from "@/lib/knowledge";
import {
  accumulateGroups,
  type CastUnit,
  chapterHeadingRegExp,
  type ChapterCast,
  type ChapterChunk,
  decodeHtml,
  detectCharset,
  htmlToText,
  mergeChapterSources,
  renderChapterMarkdown,
  splitChapters,
} from "@/lib/knowledge-extract";
import { withRetry } from "@/lib/retry";
import type { KnowledgeBuilderDef, KnowledgeField } from "@/lib/types";

/**
 * 参照URLから章キャスト表の下書きを作る（ticket 16・§8.4）。
 *
 * ここは**ファイルを書かない**。下書きを返すだけで、保存は目視確認のあと
 * `/api/knowledge/save` が行う。LLM は表を読み違えても静かに間違うため、
 * 人間の検問所を必ず1枚挟む。
 *
 * 「何が表か」の判断だけを LLM に任せ、Markdown の整形は純関数が担う
 * （体裁ブレとプロンプト注入の余地を消す）。攻略手順の散文は捨てる。
 */

/** 抽出プロンプト。ゲーム固有の部分（同定・グループ・注意）は `game.json` から差す。 */
function buildExtractSystem(kb: KnowledgeBuilderDef): string {
  return [
    "あなたは、ゲーム攻略ページのテキストから『登場人物の名簿』だけを抜き出す抽出器です。",
    `対象は${kb.subject}です。`,
    "",
    "与えられたテキストは、ある1つの章（マップ）の記述です。ここから、",
    "表に**行として載っている人物だけ**を JSON で返してください。",
    "",
    "分類:",
    ...kb.groups.map((g) => `- ${g.key}: ${g.description}`),
    "",
    "厳守:",
    "- 表の行に無い人物を足さない。地の文（散文）に名前が出てくるだけの人物は含めない。",
    "- 攻略手順・戦術・加入方法（「〜で話しかける」「村を訪れる」等）は一切出力しない。",
    "- 表に無い数値・持ち物を創作しない。読み取れない数値は 0、持ち物が無ければ空配列にする。",
    "- 同一の雑兵が複数体いると明記されている場合だけ count に入れる。",
    "- title は章タイトルだけ。「Map.1」「第1章」などの番号は含めない。",
    ...(kb.extra ? [`- ${kb.extra}`] : []),
  ].join("\n");
}

/** 列ごとのスキーマ断片。`fields` で選ばれたものだけを使う（ticket 21）。 */
const FIELD_SCHEMAS: Record<KnowledgeField, object> = {
  klass: { type: Type.STRING, description: "職・クラス列の値。" },
  lv: { type: Type.INTEGER, description: "LV列の値。不明なら 0。" },
  hp: { type: Type.INTEGER, description: "HP列の値。不明なら 0。" },
  items: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: "装備・持ち物列の値。「/」区切りは分割する。無ければ空配列。",
  },
  isBoss: { type: Type.BOOLEAN, description: "BOSS と明記されていれば true。" },
  count: {
    type: Type.INTEGER,
    description: "同一ユニットの体数（複数体と明記されているときだけ）。",
  },
};

/** `count` だけは「複数体のときだけ」なので required にしない（他は必ず埋めさせる）。 */
const OPTIONAL_FIELDS: KnowledgeField[] = ["count"];

/**
 * 抽出スキーマをゲーム定義から組む。
 *
 * **任意フィールドはモデルが黙って省略する**（実測: `hp` と `items` が丸ごと落ちた）。
 * `required` と `propertyOrdering` を明示して、列を必ず埋めさせる。読み取れなかったぶんは
 * 0 / 空配列で返させ、整形側（`toUnit`）で落とす。
 */
function buildCastSchema(kb: KnowledgeBuilderDef): object {
  const unitProps: Record<string, object> = {
    name: { type: Type.STRING, description: "ユニット名（日本語）。" },
  };
  for (const f of kb.fields) unitProps[f] = FIELD_SCHEMAS[f];

  const unitSchema = {
    type: Type.OBJECT,
    properties: unitProps,
    propertyOrdering: ["name", ...kb.fields],
    required: ["name", ...kb.fields.filter((f) => !OPTIONAL_FIELDS.includes(f))],
  };

  const groupKeys = kb.groups.map((g) => g.key);
  const castProps: Record<string, object> = {
    title: { type: Type.STRING, description: "章タイトル（番号を含めない）。" },
  };
  for (const key of groupKeys) {
    castProps[key] = { type: Type.ARRAY, items: unitSchema };
  }

  return {
    type: Type.OBJECT,
    properties: castProps,
    propertyOrdering: ["title", ...groupKeys],
    required: ["title", ...groupKeys],
  };
}

class KnowledgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
}

/** `{ game, urls }` を検証する。1〜3件・http/https のみ（サーバから任意先へ出ていくため）。 */
function parseRequest(body: unknown): { game: string; urls: string[] } {
  if (typeof body !== "object" || body === null) {
    throw new KnowledgeError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { game, urls } = body as Record<string, unknown>;
  if (typeof game !== "string" || !isValidGameSlug(game)) {
    throw new KnowledgeError("game（ゲームslug）が不正です。", 400);
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new KnowledgeError("urls（1件以上の文字列配列）が必要です。", 400);
  }
  if (urls.length > KNOWLEDGE_MAX_URLS) {
    throw new KnowledgeError(`urls は最大 ${KNOWLEDGE_MAX_URLS} 件までです。`, 400);
  }
  const parsedUrls = urls.map((u) => {
    if (typeof u !== "string" || u.trim() === "") {
      throw new KnowledgeError("urls の要素は非空の文字列で指定してください。", 400);
    }
    let parsed: URL;
    try {
      parsed = new URL(u.trim());
    } catch {
      throw new KnowledgeError(`URL として解釈できません: ${u}`, 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new KnowledgeError(`http/https のURLだけ指定できます: ${u}`, 400);
    }
    return parsed.toString();
  });
  return { game, urls: parsedUrls };
}

/** 1件取得して章チャンクに割る。文字コード判定を誤ると LLM が幻覚を返すので必ず通す。 */
async function fetchChapters(url: string, heading: RegExp): Promise<ChapterChunk[]> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(KNOWLEDGE_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "tomoni-knowledge-builder (personal, one-shot)" },
  });
  if (!res.ok) {
    throw new KnowledgeError(`取得に失敗しました(HTTP ${res.status}): ${url}`, 502);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = htmlToText(decodeHtml(bytes, detectCharset(res.headers.get("content-type"), bytes)));
  return splitChapters(text.slice(0, KNOWLEDGE_MAX_TEXT_CHARS), heading);
}

/**
 * モデルの出力を整える。`required` にした列は「読めなかった」ぶんが 0 / 空配列で来るので、
 * ここで落として体裁に出さない（HP0 のような嘘を名簿に残さない）。
 */
function toUnit(raw: unknown): CastUnit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as Record<string, unknown>;
  const name = typeof u.name === "string" ? u.name.trim() : "";
  if (!name) return null;

  const positive = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const items = Array.isArray(u.items)
    ? u.items.filter((i): i is string => typeof i === "string" && i.trim() !== "")
    : [];

  return {
    name,
    klass: typeof u.klass === "string" && u.klass.trim() ? u.klass.trim() : undefined,
    lv: positive(u.lv),
    hp: positive(u.hp),
    items: items.length > 0 ? items : undefined,
    count: typeof u.count === "number" && u.count > 1 ? u.count : undefined,
    isBoss: u.isBoss === true ? true : undefined,
  };
}

/**
 * モデルが `Map.1 マルスの旅立ち` のように番号ごと返すことがあるので落とす。
 * 何が「番号つき見出し」かはゲーム定義の `sectionHeading` が知っている（ticket 21）。
 */
function cleanTitle(raw: unknown, heading: RegExp): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(heading, "").replace(/^\s*[:：]?\s*/, "").trim();
  return t === "" ? undefined : t;
}

async function extractCast(
  chunk: ChapterChunk,
  kb: KnowledgeBuilderDef,
  heading: RegExp,
): Promise<ChapterCast> {
  const result = await withRetry(
    () =>
      getGeminiClient().models.generateContent({
        model: GEMINI_STATE_MODEL,
        contents: chunk.text,
        config: {
          systemInstruction: buildExtractSystem(kb),
          responseMimeType: "application/json",
          responseSchema: buildCastSchema(kb),
          thinkingConfig: { thinkingBudget: 0 },
          safetySettings: SAFETY_SETTINGS_BLOCK_NONE,
        },
      }),
    {
      retries: KNOWLEDGE_EXTRACT_RETRIES,
      baseDelayMs: KNOWLEDGE_EXTRACT_BASE_DELAY_MS,
    },
  );
  const parsed = JSON.parse(result.text ?? "{}") as Record<string, unknown>;
  const list = (v: unknown): CastUnit[] =>
    Array.isArray(v) ? v.map(toUnit).filter((u): u is CastUnit => u !== null) : [];

  const groups: Record<string, CastUnit[]> = {};
  for (const g of kb.groups) groups[g.key] = list(parsed[g.key]);

  return {
    chapter: chunk.chapter,
    title: cleanTitle(parsed.title, heading),
    groups,
  };
}

/**
 * 章ごとのLLM呼び出しを、少数ずつ並べて走らせる。
 * 1章が失敗しても他を巻き添えにしない（25章のうち1つの 503 で全部やり直すのは高い）。
 * 失敗した章は呼び出し側へ返し、UIで再取得を促す。
 */
async function extractAll(
  chunks: ChapterChunk[],
  kb: KnowledgeBuilderDef,
  heading: RegExp,
): Promise<{ casts: ChapterCast[]; failed: number[] }> {
  const casts: ChapterCast[] = [];
  const failed: number[] = [];

  for (let i = 0; i < chunks.length; i += KNOWLEDGE_EXTRACT_CONCURRENCY) {
    const batch = chunks.slice(i, i + KNOWLEDGE_EXTRACT_CONCURRENCY);
    const results = await Promise.all(
      batch.map((chunk) =>
        extractCast(chunk, kb, heading).catch(() => {
          failed.push(chunk.chapter);
          return null;
        }),
      ),
    );
    casts.push(...results.filter((c): c is ChapterCast => c !== null));
  }
  return { casts, failed: failed.sort((a, b) => a - b) };
}

async function fileExists(game: string, chapter: number): Promise<boolean> {
  try {
    await access(path.join(gameDir(game), "chapters", chapterFileName(chapter)));
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new KnowledgeError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const { game, urls } = parseRequest(body);

    const gameDef = await loadGameDef(game);
    if (!gameDef) {
      throw new KnowledgeError(`ゲーム定義が見つかりません: ${game}`, 404);
    }
    const kb = gameDef.knowledgeBuilder;
    if (!kb) {
      throw new KnowledgeError(
        `「${gameDef.title}」は URL からの章キャスト表生成に対応していません（game.json に knowledgeBuilder がありません）。知識ファイルは手書きしてください。`,
        422,
      );
    }
    const heading = chapterHeadingRegExp(kb.sectionHeading);

    const perUrl = await Promise.all(urls.map((u) => fetchChapters(u, heading)));
    const chunks = mergeChapterSources(perUrl);
    if (chunks.length === 0) {
      throw new KnowledgeError(
        "章の見出しが1つも見つかりませんでした。別のURLを試すか、game.json の sectionHeading を見直してください。",
        422,
      );
    }

    const { casts, failed } = await extractAll(chunks, kb, heading);
    if (casts.length === 0) {
      throw new KnowledgeError("全ての章で抽出に失敗しました。時間をおいて再実行してください。", 502);
    }

    const drafts = await Promise.all(
      accumulateGroups(casts, kb.groups).map(async (cast) => ({
        chapter: cast.chapter,
        fileName: chapterFileName(cast.chapter),
        markdown: renderChapterMarkdown(cast, kb.groups, kb.sectionLabel),
        exists: await fileExists(game, cast.chapter),
      })),
    );

    return Response.json(
      { drafts, failed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof KnowledgeError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
