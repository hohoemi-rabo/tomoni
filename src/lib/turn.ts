import type { TurnKind } from "@/lib/types";

/**
 * そのターンの種類を決める純関数（REQUIREMENTS §6.2・ticket 22）。
 *
 * **テンポ（いつ喋るか）はここでは決めない**（19 のとおり時間だけが決める）。ここが決めるのは
 * 「喋ると決まったターンで、何を喋るか」だけ。
 *
 * 乱数は引数（`roll`）で受け取る——呼び出し側が `Math.random()` を注入する。こうしておくと
 * 確率も分岐もブラウザ抜きで検証できる（`node --experimental-strip-types`）。値を import しない
 * （型のみ）ことも、直接実行の条件なので崩さないこと。
 */
export interface PickTurnKindInput {
  /** プレイヤーからの話しかけ（STT・手動）があるか。 */
  hasUserMessage: boolean;
  /** 直前のAI発言が質問だったか（連続質問を避けるため）。 */
  lastWasQuestion: boolean;
  /** 前回送信フレームからの変化量（0〜1）。 */
  diff: number;
  /** 実況／雑談の出し分けのしきい値。 */
  threshold: number;
  /** 質問ターンを引く確率（0〜1）。 */
  questionProbability: number;
  /** 一様乱数 [0,1)。呼び出し側が注入する。 */
  roll: number;
}

export function pickTurnKind({
  hasUserMessage,
  lastWasQuestion,
  diff,
  threshold,
  questionProbability,
  roll,
}: PickTurnKindInput): TurnKind {
  // 1. 話しかけられていれば応答が最優先。Route 側も userMessage があれば turnKind を
  //    無視するが、ここでも実況扱いにしておく（画面の話に自然に混ぜて返せるように）。
  if (hasUserMessage) return "narrate";

  // 2. 質問の抽選。ただし直前が質問なら引かない（連続質問は尋問に聞こえる）。
  if (!lastWasQuestion && roll < questionProbability) return "question";

  // 3. 外れたら従来どおり、画面が変わっていれば実況・止まっていれば雑談。
  return diff > threshold ? "narrate" : "chat";
}

/**
 * 発言が質問だったかを判定する（次のターンで連続質問を避けるため）。
 *
 * `turnKind === 'question'` で送ったターンは当然そうだが、**モデルは実況ターンでも
 * 問いかけで締めることがある**。ここでは「送ったターン種別」ではなく**実際の発言**を見る
 * ——連続質問を避けたいのは、聞かれた側の体感が「また質問された」になるときだから。
 */
export function looksLikeQuestion(line: string): boolean {
  return /[?？]\s*$/.test(line.trim());
}
