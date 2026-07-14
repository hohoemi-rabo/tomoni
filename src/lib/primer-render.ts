import type { PrimerDraft, PrimerItem } from "@/lib/types";

/**
 * primer 下書きの整形（ticket 23・§8.1）。**純関数だけ**。
 *
 * LLM には構造化JSON（`PrimerDraft`）だけを返させ、Markdown はここで組む。
 * `⚠️要確認` を付けるのもここ——モデルに記号を書かせると付け忘れる／付けすぎる
 * （16 の教訓: 体裁は純関数、判断だけ LLM）。
 *
 * **値を import しない**（型のみ）。`node --experimental-strip-types` で直接実行して
 * 体裁を確かめられる状態を保つため。
 */

const UNCERTAIN_MARK = "⚠️要確認";

/** 1項目を箇条書き1行に。不確かなものは行末で自己申告させる（開発者が裏取りする目印）。 */
function line(item: PrimerItem, prefix = ""): string {
  const text = item.text.trim();
  return `- ${prefix}${text}${item.uncertain ? UNCERTAIN_MARK : ""}`;
}

/**
 * 見出し＋箇条書き。**中身が無ければセクションごと落とす**——
 * 空の見出しはそのままプロンプトに流れ込む（空テンプレを置かないのと同じ理由）。
 */
function section(heading: string, items: PrimerItem[], lead?: string): string[] {
  const lines = items.filter((i) => i.text.trim() !== "").map((i) => line(i));
  if (lines.length === 0) return [];
  return ["---", "", `## ★ ${heading}`, "", ...(lead ? [lead, ""] : []), ...lines, ""];
}

export interface PrimerMeta {
  title: string;
  version?: string;
}

/**
 * `knowledge/<slug>/primer.md` の下書きを組む（`knowledge/fe-fc/primer.md` と同じ体裁）。
 *
 * ここに書くのは**そのゲームの前提だけ**。戦友としての振る舞い（能動的に話す・攻略は
 * しない・固有名は慎重に）は `src/lib/prompt.ts` が持つ層で、重複させると後から注入された
 * 方が先を打ち消す（ticket 14 で実測）。
 */
export function renderPrimerMarkdown(draft: PrimerDraft, meta: PrimerMeta): string {
  // version 自体が「ファミコン版（1990）」のように括弧を含むので、括弧で括らない。
  const version = meta.version?.trim();
  const title = `# ${meta.title.trim()}${version ? `／${version}` : ""} — 戦友AI 共通プライマー`;

  const about = [
    "> **このファイルについて**",
    "> - **このゲーム固有の前提だけ**を書く。戦友としての振る舞い（能動的に話す・攻略はしない・ネタバレはよい・読み上げ前提・固有名は慎重に）は**ゲームが変わっても変わらない層**なので `src/lib/prompt.ts` が持っている。**ここに重複させない**——同じ趣旨を2箇所に書くと、後から注入された方が先を打ち消す。",
    "> - これは **AI（戦友）に読ませる前提**の、感情・反応を正しくするための最小限の前提知識。**攻略手順書ではない**。",
    `> - **この下書きは LLM が生成したもの。そのまま信じない。** \`${UNCERTAIN_MARK}\` が付いた項目は、この版の仕様か開発者が一次情報で裏取りしてから確定すること（版の取り違えは動画の信頼性に直結する）。`,
    "",
  ];

  const body = [
    ...section("このゲームの同定（厳守）", draft.identity),
    ...section(
      "このゲームで「感情が動く」ポイント（最重要）",
      draft.emotions,
      "戦友として、ここで一緒に一喜一憂する。",
    ),
    ...section("知っておくべき基本ルール（断定は控えめに）", draft.rules),
    ...section("当時・背景の語りネタ（語り部として）", draft.background),
    ...renderProcedures(draft),
    ...section("画面認識についての注意（このゲーム固有の事情）", draft.screenNotes),
  ];

  return [title, "", ...about, ...body].join("\n");
}

/**
 * 「事実は語る、手順は言わない」の線引きを、このゲームの言葉で示すセクション（§5.2）。
 * ❌と✅を並べて置く——抽象的な禁止だけでは、AIはどこが境界か分からない。
 */
function renderProcedures(draft: PrimerDraft): string[] {
  const forbidden = draft.forbidden.filter((i) => i.text.trim() !== "");
  const allowed = draft.allowed.filter((i) => i.text.trim() !== "");
  if (forbidden.length === 0 && allowed.length === 0) return [];

  return [
    "---",
    "",
    "## ★ 何が「手順」にあたるか（言わないこと）",
    "",
    "このゲームで**言ってはいけない「手順」**と、**語ってよい「事実」**の線引き。",
    "",
    ...(forbidden.length > 0
      ? ["**手順（言わない）**", "", ...forbidden.map((i) => line(i, "❌ ")), ""]
      : []),
    ...(allowed.length > 0
      ? ["**事実（語ってよい・ネタバレも可）**", "", ...allowed.map((i) => line(i, "✅ ")), ""]
      : []),
  ];
}
