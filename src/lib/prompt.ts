import type { Persona, State } from "@/lib/types";

/**
 * 戦友AIのシステムプロンプト組み立て（REQUIREMENTS §2 / §7.3）。
 *
 * プライマー（先頭固定）＋振る舞いの厳守事項＋動的文脈（persona・章キャスト・
 * state・直近発言）を1本のシステムプロンプトにする純関数。secrets/fs に触れない。
 * 企画の核なので §5.2 / §12 の「やらないこと」に反する指示を入れない。
 */

export interface BuildSystemPromptInput {
  /** 戦友のキャラ設定（呼び出し側が Playthrough.persona を必ず渡す）。 */
  persona: Persona;
  /** 全章共通プライマー（loadPrimer の結果）。先頭に固定する。 */
  primer: string;
  /** 軽い継続性の state（任意）。無くても実況は成立する。 */
  state?: State;
  /** 現在章のキャスト表（loadChapterCast の結果・無ければ null）。 */
  chapterCast?: string | null;
  /** 直近のAI発言（繰り返し防止に使う）。 */
  recentLines?: string[];
}

export function buildSystemPrompt({
  persona,
  primer,
  state,
  chapterCast,
  recentLines,
}: BuildSystemPromptInput): string {
  const sections: string[] = [];

  // 1. プライマー（先頭固定・§7.2）。
  sections.push(primer.trim());

  // 2. 戦友としての振る舞い（厳守）。今ターンの操作的な指示として簡潔に再掲。
  sections.push(
    [
      "## 戦友としての振る舞い（厳守）",
      "",
      "- 能動的に話す。問いを待たず、画面を見て今起きていることを自分から実況する。",
      "- 3つの顔を状況で使い分ける。実況（何が起きたか）／語り部（当時・思い出・トリビア）／励まし（戦友として支える）。",
      "- 攻略しない・ネタバレしない。最適な一手や正解ルートを指示しない。聞かれても一緒に悩む側に回る。先の章の展開を先回りして言わない。",
      "- 感情を正しく動かす。仲間が失われたら（永久離脱＝ロスト）軽く流さず重く悼む。命中の当たり外れに一緒に一喜一憂する。",
      "- 版を取り違えない。必ず FC版（1990・暗黒竜と光の剣＝FE1）の前提で語る。後発作品（紋章の謎・聖戦・覚醒 等）の要素を混ぜない。",
      "- 読み上げ前提。Markdown記号や箇条書きを使わず、話し言葉で短く（1〜2文程度）。長広舌にしない。",
      "- 固有名は慎重に。画面に名前・ステータス等の文字が出ていない限り、特定のキャラ名を断定しない。分からなければ「自軍のユニット」「敵」と呼ぶ。文字が出ている画面でのみ、現在章のキャスト表と照合して特定する。",
      "- 画面から読み取れない内部数値（正確なHPや命中率の％など）は断定しない。",
      ...personaLines(persona),
    ].join("\n"),
  );

  // 3. 現在章のキャスト表（あるときだけ）。
  if (chapterCast && chapterCast.trim()) {
    sections.push(
      [
        "## 現在の章の登場人物（照合用）",
        "",
        "画面に名前・数値などの文字が出ているときだけ、以下と照合して特定してよい。出ていなければ断定しない。",
        "",
        chapterCast.trim(),
      ].join("\n"),
    );
  }

  // 4. これまでの状況（state の存在フィールドのみ）。
  const stateLines = buildStateLines(state);
  if (stateLines.length > 0) {
    sections.push(
      ["## これまでの状況（参考・継続性）", "", ...stateLines].join("\n"),
    );
  }

  // 5. 直前のあなたの発言（繰り返さない）。
  const recent = (recentLines ?? []).map((l) => l.trim()).filter(Boolean);
  if (recent.length > 0) {
    sections.push(
      [
        "## 直前のあなたの発言（繰り返さない）",
        "",
        "以下は直前のあなたの発言。同じ内容・同じ言い回しを繰り返さず、新しい視点で話す。",
        "",
        ...recent.map((l) => `- ${l}`),
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

/** persona の name/tone を指示行に反映する（空なら何も足さない）。 */
function personaLines(persona: Persona): string[] {
  const lines: string[] = [];
  const name = persona.name?.trim();
  const tone = persona.tone?.trim();
  if (name) lines.push(`- あなたの呼び名は「${name}」。`);
  if (tone) lines.push(`- 口調・トーン: ${tone}`);
  return lines;
}

/** state の存在するフィールドだけを参考情報の行にする。 */
function buildStateLines(state?: State): string[] {
  if (!state) return [];
  const lines: string[] = [];
  if (state.chapter?.trim()) lines.push(`- 到達章: ${state.chapter.trim()}`);
  if (state.lost_units && state.lost_units.length > 0) {
    lines.push(`- 失った仲間（ロスト）: ${state.lost_units.join("、")}`);
  }
  if (state.progress?.trim()) lines.push(`- 進捗: ${state.progress.trim()}`);
  if (state.last_session_summary?.trim()) {
    lines.push(`- 前回までのあらすじ: ${state.last_session_summary.trim()}`);
  }
  return lines;
}
