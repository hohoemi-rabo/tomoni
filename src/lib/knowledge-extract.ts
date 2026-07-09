/**
 * 参照URLから章キャスト表を作るための純関数群（ticket 16）。
 *
 * fetch も Gemini も含めない。文字コード判定・タグ除去・章分割・体裁整形だけを持ち、
 * `node --experimental-strip-types` で直接実行して検証できるようにする。
 * 攻略手順（散文）はここでは判別しない。何が表かの判断はLLMに委ね、
 * このモジュールは「LLMが返した構造化データ」を §8.2 の体裁に落とす側を担う。
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
  /** そのマップのボスか（敵のみ）。 */
  isBoss?: boolean;
}

export interface ChapterCast {
  chapter: number;
  title?: string;
  allies: CastUnit[];
  enemies: CastUnit[];
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

/** 行頭の `Map.1` / `第1章` / `Chapter 1` を章見出しとみなす。 */
const CHAPTER_HEADING =
  /^(?:Map[.．]?\s*(\d{1,2})\b|第\s*(\d{1,2})\s*章|Chapter\s+(\d{1,2})\b)/i;

/** 全角数字→半角。`chapterToNumber`（knowledge.ts）と同じ前処理。 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 本文を章ごとのチャンクに割る。見出しが1つも無ければ空配列。
 * 同じ章見出しが複数回出てもチャンクは1つにまとめる（目次と本文の重複対策）。
 */
export function splitChapters(text: string): ChapterChunk[] {
  const lines = toHalfWidthDigits(text).split("\n");
  const byChapter = new Map<number, string[]>();
  let current: number | null = null;

  for (const line of lines) {
    const m = line.match(CHAPTER_HEADING);
    if (m) {
      const n = Number.parseInt(m[1] ?? m[2] ?? m[3], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 99) {
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
 * 自軍を第1章から累積する。取得元の表は「その章で新規加入する人」しか載せないが、
 * キャスト表の目的は画面の名前との照合なので、その時点でいる全員が要る。
 * 敵はその章のものだけ（累積しない）。
 */
export function accumulateAllies(casts: ChapterCast[]): ChapterCast[] {
  const sorted = [...casts].sort((a, b) => a.chapter - b.chapter);
  const seen = new Map<string, CastUnit>();
  return sorted.map((cast) => {
    for (const unit of cast.allies) {
      if (!seen.has(unit.name)) seen.set(unit.name, unit);
    }
    return { ...cast, allies: [...seen.values()] };
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

/** §8.2 の体裁に整形する。整形をLLMに任せると体裁がブレるので、ここで固定する。 */
export function renderChapterMarkdown(cast: ChapterCast): string {
  const title = cast.title?.trim();
  const heading = title ? `# 第${cast.chapter}章 ${title}` : `# 第${cast.chapter}章`;

  // ボスを先に出す（画面で最初に照合したくなるのはボス）。
  const enemies = [...cast.enemies].sort(
    (a, b) => Number(b.isBoss ?? false) - Number(a.isBoss ?? false),
  );

  return [
    heading,
    "",
    "## 自軍（仲間）",
    cast.allies.length > 0 ? cast.allies.map(unitLine).join("\n") : EMPTY,
    "",
    "## 敵",
    enemies.length > 0 ? enemies.map(unitLine).join("\n") : EMPTY,
    "",
    "> 参照URLの表から自動生成し、目視確認して保存したもの（§8.4 / ticket 16）。",
    "> 加入・攻略の手順（誰で話しかける等）は書かない（§5.2）。",
    "",
  ].join("\n");
}
