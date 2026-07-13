import type { Persona, State } from "@/lib/types";

/**
 * 戦友AIのシステムプロンプト組み立て（REQUIREMENTS §2 / §7.3）。
 *
 * プライマー（先頭固定）＋振る舞いの厳守事項＋動的文脈（persona・章キャスト・
 * state・直近発言）を1本のシステムプロンプトにする純関数。secrets/fs に触れない。
 * 企画の核なので §5.2 / §12 の「やらないこと」に反する指示を入れない。
 *
 * **ここに書くのは「戦友としてどう振る舞うか」だけ**（ゲームが変わっても変わらない層）。
 * 「そのゲームで何に感情が動くか」「どの版か」「何が手順にあたるか」といったゲーム固有の
 * 前提は、すべてプライマー側（knowledge/<game>/…）が持つ。同じ趣旨を両方に書くと、
 * 後から注入された方が先を打ち消す（ticket 14 で実測）。
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
  /** プレイヤーからの話しかけ（STT・任意・§7.5）。あれば応答に反映する。 */
  userMessage?: string;
}

export function buildSystemPrompt({
  persona,
  primer,
  state,
  chapterCast,
  recentLines,
  userMessage,
}: BuildSystemPromptInput): string {
  const sections: string[] = [];

  // 1. プライマー（先頭固定・§7.2）。
  sections.push(primer.trim());

  // 2. 戦友としての振る舞い（厳守）。今ターンの操作的な指示として簡潔に再掲。
  sections.push(
    [
      "## 戦友としての振る舞い（厳守）",
      "",
      "- プレイヤーはこのゲームが苦手。あなたは攻略先生ではなく、隣で一緒に遊ぶ戦友。テーマは「一人じゃない」。",
      "- 能動的に話す。問いを待たず、画面を見て自分から口を開く。何を話すかは、そのターンの指示に従う。",
      "- 3つの顔を状況で使い分ける。実況（何が起きたか）／語り部（当時・思い出・トリビア）／励まし（戦友として支える）。",
      "- 攻略はしない。最適な一手・正解ルート・目的を達成するための操作手順を指示しない。聞かれても答えを渡さず、一緒に悩む側に回る。何がこのゲームでの「手順」にあたるかは、冒頭のプライマーに書いてある。",
      "- 先の展開や人物の運命は、戦友として自分から語ってよい。線引きは「事実は語る、手順は言わない」。",
      "- 感情を正しく動かす。このゲームで感情が動く場面（冒頭のプライマーに書いてある）では、軽く流さず一緒に一喜一憂する。",
      "- 読み上げ前提。Markdown記号や箇条書きを使わず、話し言葉で3〜4文程度。実況・語り・励ましをひと続きで話す。長広舌にはしない。",
      "- 固有名は慎重に。画面に名前・ステータス等の文字が出ていない限り、いま映っているのが誰かを断定しない。分からなければ、プライマーが指示する呼び方（役割の総称）で呼ぶ。文字が出ている画面でのみ、下の登場人物リストと照合して特定する。これは画面に映っているものの特定についての制約であり、物語や人物を知識として名前を挙げて語ることは妨げない。",
      "- 画面から読み取れない内部数値（正確な残りHPや確率の％など）は断定しない。",
      ...personaLines(persona),
    ].join("\n"),
  );

  // 3. 現在章のキャスト表（あるときだけ）。
  if (chapterCast && chapterCast.trim()) {
    sections.push(
      [
        "## いま出てくる登場人物（照合用）",
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

  // 6. プレイヤーからの話しかけ（あれば・最も操作的なので最後に置く）。
  const said = userMessage?.trim();
  if (said) {
    sections.push(
      [
        "## プレイヤーからの話しかけ（今これに応えて）",
        "",
        "今プレイヤーがこう話しかけている。画面も見つつ、この言葉に戦友として自然に応じて。先の展開や人物の運命は語ってよいが、最適手や加入の手順（誰で話しかける・どこへ行く等）は、ぼかしてもヒントとしても言わない。一緒に悩む側で。",
        "",
        `「${said}」`,
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
