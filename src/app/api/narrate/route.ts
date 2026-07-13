import { GEMINI_NARRATE_MODEL } from "@/lib/config";
import { loadGameDef } from "@/lib/games";
import { getGeminiClient, SAFETY_SETTINGS_BLOCK_NONE } from "@/lib/gemini";
import { loadChapterCast, loadPrimer } from "@/lib/knowledge";
import { getPlaythrough } from "@/lib/playthroughs";
import { buildSystemPrompt } from "@/lib/prompt";
import { withRetry } from "@/lib/retry";
import { TURN_KINDS, type NarrateRequest, type TurnKind } from "@/lib/types";

/**
 * 実況API `POST /api/narrate`（REQUIREMENTS §7.1）。本プロジェクトの主役API。
 *
 * 画面フレーム1枚＋システムプロンプトを Gemini(Vision) に渡し、
 * `generateContentStream` の `chunk.text` を `ReadableStream` で返す。
 *
 * - APIキーはこの Route Handler 内（サーバ）でのみ使う（`getGeminiClient` 経由）。
 * - POST は本質的に非キャッシュ。`node:fs`（knowledge）/`server-only`（supabase）を
 *   使うため Node.js ランタイム（既定）で動く。
 */

/** ストリーム開始前のエラーを画面表示できる JSON で返すための型付き例外。 */
class NarrateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * そのターンで何をさせるか（モード選択）は、画像に隣接するこの4文だけが決める（ticket 22）。
 * 発話長・読み上げ前提などの常時の制約は systemPrompt 側（prompt.ts）にあるので、
 * ここには書かない。同趣旨の指示を2箇所に置くと、後から注入された方が先を打ち消す（ticket 14）。
 */
const TURN_TEXT: Record<TurnKind, string> = {
  narrate:
    "今の画面です。戦友として、今この瞬間に起きていることを能動的に話してください。",
  chat: "今の画面です。ただ、画面に動きがありません。今は実況をせず、語り部か励ましに回ってください。話題はひとつだけ選び、あれこれ並べないでください。画面の細部は説明しないでください。",
  question:
    "今の画面です。今回は、戦友として**プレイヤー本人に**軽く問いかけてください。「きみは」「〜してる?」のように相手に向けて聞くこと。『どんな戦いが待っているんだろう』のような独り言・修辞疑問にはしないでください。聞いてよいのは、プレイヤーの感想・思い出・気持ち・プレイヤー自身の選択（好きなユニット、当時の思い出、今の気分など）。答えなくても場が持つ、気軽な問いかけにしてください。問いはひとつだけ。攻略の手順を聞き出す形（「次はどこへ行く?」等、答えが最適手の指示になる問い）にはしないでください。",
  giveup:
    "今の画面です。さっきの問いかけに返事がありませんでした。冒頭で軽く切り上げて（「ま、いっか」程度の一言）、そのまま今の画面の実況か雑談に自然に続けてください。催促しないこと。さっきの質問を蒸し返さないこと。切り上げの一言だけで終わらせず、必ず今の話に続けること。",
};

/** 入力 `{ playthroughId, imageBase64, recentLines, userMessage, turnKind }` を検証して正規化する。 */
function parseRequest(body: unknown): NarrateRequest {
  if (typeof body !== "object" || body === null) {
    throw new NarrateError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { playthroughId, imageBase64, recentLines, userMessage, turnKind } =
    body as Record<string, unknown>;

  if (typeof playthroughId !== "string" || playthroughId.trim() === "") {
    throw new NarrateError("playthroughId（非空の文字列）が必要です。", 400);
  }
  if (typeof imageBase64 !== "string" || imageBase64.trim() === "") {
    throw new NarrateError("imageBase64（非空の文字列）が必要です。", 400);
  }
  // recentLines は任意。あれば string[] であること。
  if (recentLines !== undefined) {
    if (
      !Array.isArray(recentLines) ||
      !recentLines.every((l) => typeof l === "string")
    ) {
      throw new NarrateError("recentLines は文字列の配列で指定してください。", 400);
    }
  }
  // userMessage は任意（STT）。あれば string であること。
  if (userMessage !== undefined && typeof userMessage !== "string") {
    throw new NarrateError("userMessage は文字列で指定してください。", 400);
  }
  // turnKind は任意。あれば既知の4種であること（未知の値は黙って narrate に落とさない）。
  if (
    turnKind !== undefined &&
    !TURN_KINDS.includes(turnKind as TurnKind)
  ) {
    throw new NarrateError(
      `turnKind は ${TURN_KINDS.join(" / ")} のいずれかで指定してください。`,
      400,
    );
  }

  const said = (userMessage as string | undefined)?.trim();
  return {
    playthroughId,
    imageBase64,
    recentLines: (recentLines as string[] | undefined) ?? [],
    userMessage: userMessage as string | undefined,
    // 話しかけられていれば、そのターンの種別より応答を優先する（§7.1）。
    turnKind: said ? "narrate" : ((turnKind as TurnKind | undefined) ?? "narrate"),
  };
}

export async function POST(req: Request): Promise<Response> {
  // ストリーム開始前のエラー（検証・未検出・確立失敗）はここで JSON にして返す。
  // 確立に成功したら ReadableStream を返す。反復中の失敗は controller.error で
  // 伝える（= ストリーム開始後は再試行しない＝テキスト重複を防ぐ）。
  try {
    const body = await req.json().catch(() => {
      throw new NarrateError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const { playthroughId, imageBase64, recentLines, userMessage, turnKind } =
      parseRequest(body);

    // どの知識を読むかはプレイスルーのゲームで決まる（§7.2・ticket 20）ので、
    // まず DB を読む。プライマー・ゲーム定義・章キャスト表は fs から並列に読む。
    const playthrough = await getPlaythrough(playthroughId);
    if (!playthrough) {
      throw new NarrateError(
        `プレイスルーが見つかりません: ${playthroughId}`,
        404,
      );
    }

    const [primer, gameDef, chapterCast] = await Promise.all([
      loadPrimer(playthrough.game),
      loadGameDef(playthrough.game),
      loadChapterCast(playthrough.game, playthrough.state.chapter),
    ]);

    const systemPrompt = buildSystemPrompt({
      persona: playthrough.persona,
      primer,
      gameDef: gameDef ?? undefined,
      state: playthrough.state,
      chapterCast,
      recentLines,
      userMessage,
    });

    // 確立（最初のチャンク送信前）のみ withRetry で再試行する。
    const stream = await withRetry(() =>
      getGeminiClient().models.generateContentStream({
        model: GEMINI_NARRATE_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
              { text: TURN_TEXT[turnKind ?? "narrate"] },
            ],
          },
        ],
        config: {
          systemInstruction: systemPrompt,
          thinkingConfig: { thinkingBudget: 0 },
          safetySettings: SAFETY_SETTINGS_BLOCK_NONE,
        },
      }),
    );

    // 確立成功。以降はストリーミング。反復中の失敗は controller.error で伝える。
    const encoder = new TextEncoder();
    const responseBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.text;
            if (text) controller.enqueue(encoder.encode(text));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(responseBody, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof NarrateError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
