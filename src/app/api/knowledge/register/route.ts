import { Type } from "@google/genai";

import {
  GEMINI_NARRATE_MODEL,
  KNOWLEDGE_EXTRACT_BASE_DELAY_MS,
  KNOWLEDGE_EXTRACT_RETRIES,
  KNOWLEDGE_FETCH_TIMEOUT_MS,
  KNOWLEDGE_MAX_URLS,
  KNOWLEDGE_PRIMER_MAX_TEXT_CHARS,
} from "@/lib/config";
import { getGeminiClient, SAFETY_SETTINGS_BLOCK_NONE } from "@/lib/gemini";
import { decodeHtml, detectCharset, htmlToText } from "@/lib/knowledge-extract";
import { renderPrimerMarkdown } from "@/lib/primer-render";
import { withRetry } from "@/lib/retry";
import type { PrimerDraft, PrimerItem } from "@/lib/types";

/**
 * ゲーム登録：参照URLから `primer.md` の下書きを作る（ticket 23・§8.4 その0）。
 *
 * **ここはファイルを書かない**。下書きを返すだけで、保存は目視確認のあと
 * `/api/knowledge/save`（`kind: "game"`）が行う。16 とまったく同じ流儀——
 * 一度きりの取得 → 目視確認 → ファイル保存——であって、「AIが学習する」仕組みではない。
 *
 * 生成するのは §8.1 の型に沿った**構造化JSONだけ**。Markdown の体裁は純関数
 * （`renderPrimerMarkdown`）が組む。攻略手順の散文は捨てる。
 */

class RegisterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RegisterError";
  }
}

interface RegisterInput {
  title: string;
  platform: string;
  releasedAt: string;
  urls: string[];
}

/** 機種・発売時期は**同定のアンカー**なので任意にはするが、無いほど版の混同が起きやすい。 */
function parseRequest(body: unknown): RegisterInput {
  if (typeof body !== "object" || body === null) {
    throw new RegisterError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { title, platform, releasedAt, urls } = body as Record<string, unknown>;

  if (typeof title !== "string" || title.trim() === "") {
    throw new RegisterError("title（ゲームのタイトル）が必要です。", 400);
  }
  const str = (v: unknown, name: string): string => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") {
      throw new RegisterError(`${name} は文字列で指定してください。`, 400);
    }
    return v.trim();
  };

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new RegisterError("urls（1件以上の文字列配列）が必要です。", 400);
  }
  if (urls.length > KNOWLEDGE_MAX_URLS) {
    throw new RegisterError(`urls は最大 ${KNOWLEDGE_MAX_URLS} 件までです。`, 400);
  }
  const parsedUrls = urls.map((u) => {
    if (typeof u !== "string" || u.trim() === "") {
      throw new RegisterError("urls の要素は非空の文字列で指定してください。", 400);
    }
    let parsed: URL;
    try {
      parsed = new URL(u.trim());
    } catch {
      throw new RegisterError(`URL として解釈できません: ${u}`, 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new RegisterError(`http/https のURLだけ指定できます: ${u}`, 400);
    }
    return parsed.toString();
  });

  return {
    title: title.trim(),
    platform: str(platform, "platform"),
    releasedAt: str(releasedAt, "releasedAt"),
    urls: parsedUrls,
  };
}

/**
 * 1件取得して本文テキストにする。**文字コード判定を必ず通す**——
 * Shift-JIS を UTF-8 で読むと本文が化け、LLM が「GBA版」と幻覚した（16 で実測）。
 */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(KNOWLEDGE_FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "tomoni-knowledge-builder (personal, one-shot)" },
  });
  if (!res.ok) {
    throw new RegisterError(`取得に失敗しました(HTTP ${res.status}): ${url}`, 502);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = htmlToText(
    decodeHtml(bytes, detectCharset(res.headers.get("content-type"), bytes)),
  );
  return text.slice(0, KNOWLEDGE_PRIMER_MAX_TEXT_CHARS);
}

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING, description: "1文〜2文の日本語。箇条書き1項目ぶん。" },
    uncertain: {
      type: Type.BOOLEAN,
      description:
        "この版の仕様として確証が持てない、または版によって異なりうるなら true。迷ったら true。",
    },
  },
  propertyOrdering: ["text", "uncertain"],
  required: ["text", "uncertain"],
};

const itemList = (description: string) => ({
  type: Type.ARRAY,
  items: ITEM_SCHEMA,
  description,
});

/**
 * **任意フィールドはモデルが黙って省略する**（16 で実測）。`required` と `propertyOrdering`
 * を全部明示し、「概念が無いもの」は空文字で返させてサーバ側で落とす。
 */
const DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    slug: {
      type: Type.STRING,
      description:
        "知識ディレクトリ名の候補。半角英小文字・数字・ハイフンのみ（例: fe-fc, dq2-fc）。短く。",
    },
    version: {
      type: Type.STRING,
      description: "版の表記（例: 「ファミコン版（1990）」）。機種と発売年を含める。",
    },
    progressLabel: {
      type: Type.STRING,
      description:
        "そのゲームで進行状況をどう呼ぶか（例: 「到達章」「現在のエリア」「到達ステージ」）。",
    },
    progressPlaceholder: {
      type: Type.STRING,
      description: "進行状況の入力例（例: 「例: 第2章」「例: ワールド1-3」）。",
    },
    lostLabel: {
      type: Type.STRING,
      description:
        "仲間を永久に失う概念があるなら、その呼び方（例: 「失った仲間（ロスト）」）。**その概念が無いゲームなら空文字**。",
    },
    identity: itemList(
      "このゲームの同定。対象の版・発売年・主人公・どういうゲームか。後発のリメイクや続編と混ぜないための厳守事項。",
    ),
    emotions: itemList(
      "プレイ中に感情が動くポイント（最重要）。何が起きたら悲しむ・喜ぶ・ハラハラするのか。",
    ),
    rules: itemList("戦友が知っておくべき基本ルール。断定できないものは uncertain: true。"),
    background: itemList("当時・背景の語りネタ（発売時期・シリーズ上の位置づけ・開発元など）。"),
    forbidden: itemList(
      "このゲームで「手順」にあたる＝言ってはいけないことの例（最適な進め方・攻略の操作手順・最適手）。手順そのものは書かず、「何が手順にあたるか」の例として書く。",
    ),
    allowed: itemList(
      "語ってよい「事実」の例（登場人物の正体・先の展開などのネタバレを含む）。手順は含めない。",
    ),
    screenNotes: itemList(
      "画面認識上の固有事情（ドット絵で個人を判別できない、画面に出る情報の種類など）。",
    ),
  },
  propertyOrdering: [
    "slug",
    "version",
    "progressLabel",
    "progressPlaceholder",
    "lostLabel",
    "identity",
    "emotions",
    "rules",
    "background",
    "forbidden",
    "allowed",
    "screenNotes",
  ],
  required: [
    "slug",
    "version",
    "progressLabel",
    "progressPlaceholder",
    "lostLabel",
    "identity",
    "emotions",
    "rules",
    "background",
    "forbidden",
    "allowed",
    "screenNotes",
  ],
};

function buildSystem(input: RegisterInput): string {
  const anchor = [input.title, input.platform, input.releasedAt].filter(Boolean).join(" / ");
  return [
    "あなたは、レトロゲームを一緒にプレイする「戦友AI」に読ませる前提知識（プライマー）の下書きを作る補助ツールです。",
    "",
    `対象は **${anchor}** です。この版だけを対象にしてください。`,
    "",
    "目的は**AIの感情・反応を正しくすること**であって、攻略の役に立つことではありません。",
    "戦友AIは「事実は語るが、手順は言わない」——ネタバレはしてよく、攻略アドバイスはしません。",
    "",
    "厳守:",
    "- **後発のリメイク・移植・続編の要素を混ぜない。** 仕様が違う。版が違えば別のゲームとして扱う。",
    "- **攻略手順・最適手・レベル上げの手順・進軍ルート・仲間の加入操作を一切書かない。** それらは forbidden に『何が手順にあたるか』の例として抽象的に挙げるだけにする。",
    "- **確証が持てない項目・版によって異なりうる項目は uncertain: true にする。** 迷ったら true。断定して間違えるより、確認を促すほうがよい。",
    "- 攻略ページの散文をそのまま写さない。**感情を正しくする最小限**に絞る（各項目は3〜7件程度）。",
    "- 戦友としての振る舞い（能動的に話す・読み上げ前提・固有名は慎重に 等）は別のファイルが持っている。**ここには書かない。**",
    "- 参照テキストは版の同定のためのアンカーです。テキストに無いことでも、この版の一般的な事実として確かなら書いてよい（ただし uncertain を正しく付ける）。",
    "- 出力はすべて日本語。",
  ].join("\n");
}

function toItems(raw: unknown): PrimerItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (typeof r !== "object" || r === null) return null;
      const { text, uncertain } = r as Record<string, unknown>;
      if (typeof text !== "string" || text.trim() === "") return null;
      return { text: text.trim(), uncertain: uncertain === true };
    })
    .filter((i): i is PrimerItem => i !== null);
}

function str(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new RegisterError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const input = parseRequest(body);

    const texts = await Promise.all(input.urls.map(fetchText));
    const sources = texts
      .map((t, i) => `## 参照テキスト ${i + 1}（${input.urls[i]}）\n\n${t}`)
      .join("\n\n");

    // 一度きりの生成で、外すと版の取り違えがそのまま動画に出る。テンポ制約が無いので
    // 実況（flash）と同じモデルを思考ONで使う（thinkingConfig を付けない）。
    const result = await withRetry(
      () =>
        getGeminiClient().models.generateContent({
          model: GEMINI_NARRATE_MODEL,
          contents: sources,
          config: {
            systemInstruction: buildSystem(input),
            responseMimeType: "application/json",
            responseSchema: DRAFT_SCHEMA,
            safetySettings: SAFETY_SETTINGS_BLOCK_NONE,
          },
        }),
      {
        retries: KNOWLEDGE_EXTRACT_RETRIES,
        baseDelayMs: KNOWLEDGE_EXTRACT_BASE_DELAY_MS,
      },
    );

    const parsed = JSON.parse(result.text ?? "{}") as Record<string, unknown>;
    const draft: PrimerDraft = {
      identity: toItems(parsed.identity),
      emotions: toItems(parsed.emotions),
      rules: toItems(parsed.rules),
      background: toItems(parsed.background),
      forbidden: toItems(parsed.forbidden),
      allowed: toItems(parsed.allowed),
      screenNotes: toItems(parsed.screenNotes),
    };

    const version = str(parsed.version);
    const primer = renderPrimerMarkdown(draft, { title: input.title, version });

    return Response.json(
      {
        // slug はここでは検証しない（保存時に `gameDir` が弾く）。UIで編集できる下書き。
        slug: str(parsed.slug),
        game: {
          title: input.title,
          version,
          progressLabel: str(parsed.progressLabel),
          progressPlaceholder: str(parsed.progressPlaceholder),
          lostLabel: str(parsed.lostLabel),
        },
        primer,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof RegisterError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
