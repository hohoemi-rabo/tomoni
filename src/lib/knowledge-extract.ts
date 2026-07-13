import type { KnowledgeGroupDef } from "@/lib/types";

/**
 * 参照URLから章キャスト表を作るための純関数群（ticket 16 / 21）。
 *
 * fetch も Gemini も含めない。文字コード判定・タグ除去・章分割・体裁整形だけを持ち、
 * `node --experimental-strip-types` で直接実行して検証できるようにする（**型のみ import**
 * という条件を崩さないこと）。攻略手順（散文）はここでは判別しない。何が表かの判断はLLMに
 * 委ね、このモジュールは「LLMが返した構造化データ」を §8.2 の体裁に落とす側を担う。
 *
 * **ゲーム固有の形（章見出し・グループ・累積の有無）は `game.json` の `knowledgeBuilder`
 * から渡される**（ticket 21）。ここに FE を直書きしない。
 */

/** キャスト表1行ぶん。表に書かれていた事実だけを持つ。 */
export interface CastUnit {
  name: string;
  klass?: string;
  lv?: number;
  hp?: number;
  items?: string[];
  /** 同一ユニットが複数体いるとき（敵の雑兵など）。 */
  count?: number;
  /** そのマップのボスか。 */
  isBoss?: boolean;
}

export interface ChapterCast {
  chapter: number;
  title?: string;
  /** グループキー（`allies` / `enemies` 等）→ そのグループのユニット。 */
  groups: Record<string, CastUnit[]>;
}

/** 章ごとの本文チャンク。 */
export interface ChapterChunk {
  chapter: number;
  text: string;
}

/**
 * 文字コードを決める。`Content-Type` ヘッダ → HTML の `<meta charset>` → utf-8。
 *
 * 判定を誤ると文字化けし、それをLLMに渡すと「もっともらしい嘘」を生成する
 * （実測: Shift-JIS の FC版攻略サイトを UTF-8 で読ませたら「GBA版」と答えた）。
 */
export function detectCharset(
  contentType: string | null,
  head: Uint8Array,
): string {
  const fromHeader = contentType?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();

  // meta charset は ASCII 互換の範囲に現れるので、先頭だけ latin1 で覗く。
  const peek = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  const fromMeta = peek.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  return (fromMeta ?? "utf-8").toLowerCase();
}

/** 未知のラベルは utf-8 にフォールバックする（例外で全体を落とさない）。 */
export function decodeHtml(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * HTML を素朴なテキストに落とす。HTMLパーサは入れない（依存を増やさない）。
 *
 * **セルは `|` で、行は改行で区切る。** セルまで改行にすると表の1行が縦に散らばり、
 * LLM が列を対応づけられずHPや持ち物を落とす（実測でそうなった）。
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|div|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#?\w+;/g, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .split("\n")
    .map((l) =>
      l
        .replace(/[ \t　]+/g, " ")
        .replace(/(\s*\|\s*)+/g, " | ") // 空セルの連続を1つに畳む
        .replace(/^\s*\|\s*|\s*\|\s*$/g, "") // 行頭・行末の区切りを落とす
        .trim(),
    )
    .filter((l) => l !== "")
    .join("\n");
}

/** 全角数字→半角。`chapterToNumber`（knowledge.ts）と同じ前処理。 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 章見出しの正規表現を組む（`game.json` の `sectionHeading`）。
 * キャプチャ群のどれかに章番号が入る前提（どの分岐に当たったかは呼び出し側では区別しない）。
 */
export function chapterHeadingRegExp(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}

/** マッチ結果から最初に見つかった数字のキャプチャを章番号にする。 */
function capturedNumber(m: RegExpMatchArray): number | null {
  for (const g of m.slice(1)) {
    if (typeof g === "string" && g !== "") {
      const n = Number.parseInt(g, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * 本文を章ごとのチャンクに割る。見出しが1つも無ければ空配列。
 * 同じ章見出しが複数回出てもチャンクは1つにまとめる（目次と本文の重複対策）。
 */
export function splitChapters(text: string, heading: RegExp): ChapterChunk[] {
  const lines = toHalfWidthDigits(text).split("\n");
  const byChapter = new Map<number, string[]>();
  let current: number | null = null;

  for (const line of lines) {
    const m = line.match(heading);
    if (m) {
      const n = capturedNumber(m);
      if (n !== null && n >= 1 && n <= 99) {
        current = n;
        if (!byChapter.has(n)) byChapter.set(n, []);
      }
    }
    if (current !== null) byChapter.get(current)!.push(line);
  }

  return [...byChapter.entries()]
    .sort(([a], [b]) => a - b)
    .map(([chapter, ls]) => ({ chapter, text: ls.join("\n") }));
}

/** 複数URL由来のチャンクを、章番号ごとに連結する。 */
export function mergeChapterSources(
  perUrl: ChapterChunk[][],
): ChapterChunk[] {
  const byChapter = new Map<number, string[]>();
  for (const chunks of perUrl) {
    for (const { chapter, text } of chunks) {
      const list = byChapter.get(chapter) ?? [];
      list.push(text);
      byChapter.set(chapter, list);
    }
  }
  return [...byChapter.entries()]
    .sort(([a], [b]) => a - b)
    .map(([chapter, texts]) => ({ chapter, text: texts.join("\n\n") }));
}

/**
 * `accumulate: true` のグループを第1章から累積する。
 *
 * FEの自軍が典型で、取得元の表は「その章で新規加入する人」しか載せないが、キャスト表の目的は
 * 画面の名前との照合なので、その時点でいる全員が要る。敵のように毎章入れ替わるグループは
 * 累積しない。**どのグループを累積するかはゲーム定義が決める**（ticket 21）。
 */
export function accumulateGroups(
  casts: ChapterCast[],
  groups: KnowledgeGroupDef[],
): ChapterCast[] {
  const sorted = [...casts].sort((a, b) => a.chapter - b.chapter);
  const seenByGroup = new Map<string, Map<string, CastUnit>>();

  return sorted.map((cast) => {
    const next: Record<string, CastUnit[]> = {};
    for (const g of groups) {
      const units = cast.groups[g.key] ?? [];
      if (!g.accumulate) {
        next[g.key] = units;
        continue;
      }
      const seen = seenByGroup.get(g.key) ?? new Map<string, CastUnit>();
      for (const unit of units) {
        if (!seen.has(unit.name)) seen.set(unit.name, unit);
      }
      seenByGroup.set(g.key, seen);
      next[g.key] = [...seen.values()];
    }
    return { ...cast, groups: next };
  });
}

/** `マルス／ロード／Lv1 HP18／持ち物: レイピア` の1行を組み立てる（§8.2）。 */
function unitLine(u: CastUnit): string {
  const head = u.count && u.count > 1 ? `${u.name}（×${u.count}）` : u.name;
  const parts = [head];
  if (u.klass) parts.push(u.klass);

  const stats = [
    u.lv !== undefined ? `Lv${u.lv}` : null,
    u.hp !== undefined ? `HP${u.hp}` : null,
  ].filter(Boolean);
  if (stats.length > 0) parts.push(stats.join(" "));

  if (u.items && u.items.length > 0) parts.push(`持ち物: ${u.items.join("・")}`);

  const line = `- ${parts.join("／")}`;
  return u.isBoss ? `${line}（このマップのボス）` : line;
}

const EMPTY = "- （表から読み取れませんでした）";

/** `第{n}章` のような章ラベルを組む。 */
export function sectionTitle(label: string, chapter: number): string {
  return label.replace("{n}", String(chapter));
}

/**
 * §8.2 の体裁に整形する。整形をLLMに任せると体裁がブレるので、ここで固定する。
 * 見出し・グループの並びは `game.json`（`sectionLabel` / `groups`）が決める（ticket 21）。
 */
export function renderChapterMarkdown(
  cast: ChapterCast,
  groups: KnowledgeGroupDef[],
  sectionLabel: string,
): string {
  const title = cast.title?.trim();
  const label = sectionTitle(sectionLabel, cast.chapter);
  const heading = title ? `# ${label} ${title}` : `# ${label}`;

  const sections = groups.flatMap((g) => {
    // ボスを先に出す（画面で最初に照合したくなるのはボス）。
    const units = [...(cast.groups[g.key] ?? [])].sort(
      (a, b) => Number(b.isBoss ?? false) - Number(a.isBoss ?? false),
    );
    return [
      `## ${g.heading}`,
      units.length > 0 ? units.map(unitLine).join("\n") : EMPTY,
      "",
    ];
  });

  return [
    heading,
    "",
    ...sections,
    "> 参照URLの表から自動生成し、目視確認して保存したもの（§8.4 / ticket 16・21）。",
    "> 加入・攻略の手順（誰で話しかける等）は書かない（§5.2）。",
    "",
  ].join("\n");
}
