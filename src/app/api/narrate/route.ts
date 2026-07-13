import { GEMINI_NARRATE_MODEL } from "@/lib/config";
import { loadGameDef } from "@/lib/games";
import { getGeminiClient, SAFETY_SETTINGS_BLOCK_NONE } from "@/lib/gemini";
import { loadChapterCast, loadPrimer } from "@/lib/knowledge";
import { getPlaythrough } from "@/lib/playthroughs";
import { buildSystemPrompt } from "@/lib/prompt";
import { withRetry } from "@/lib/retry";
import type { NarrateRequest } from "@/lib/types";

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
 * そのターンで実況させるか雑談させるか（モード選択）は、画像に隣接するこの2文だけが決める。
 * 発話長・読み上げ前提などの常時の制約は systemPrompt 側（prompt.ts）にあるので、
 * ここには書かない。同趣旨の指示を2箇所に置くと、後から注入された方が先を打ち消す（ticket 14）。
 */
const NARRATE_TURN_TEXT =
  "今の画面です。戦友として、今この瞬間に起きていることを能動的に話してください。";
const IDLE_TURN_TEXT =
  "今の画面です。ただ、画面に動きがありません。今は実況をせず、語り部か励ましに回ってください。話題はひとつだけ選び、あれこれ並べないでください。画面の細部は説明しないでください。";

/** 入力 `{ playthroughId, imageBase64, recentLines, userMessage, isIdle }` を検証して正規化する。 */
function parseRequest(body: unknown): NarrateRequest {
  if (typeof body !== "object" || body === null) {
    throw new NarrateError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { playthroughId, imageBase64, recentLines, userMessage, isIdle } =
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
  // isIdle は任意（自発発話）。あれば boolean であること。
  if (isIdle !== undefined && typeof isIdle !== "boolean") {
    throw new NarrateError("isIdle は真偽値で指定してください。", 400);
  }

  const said = (userMessage as string | undefined)?.trim();
  return {
    playthroughId,
    imageBase64,
    recentLines: (recentLines as string[] | undefined) ?? [],
    userMessage: userMessage as string | undefined,
    // 話しかけられていれば、沈黙由来の自発発話より応答を優先する。
    isIdle: said ? false : (isIdle as boolean | undefined),
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
    const { playthroughId, imageBase64, recentLines, userMessage, isIdle } =
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
              { text: isIdle ? IDLE_TURN_TEXT : NARRATE_TURN_TEXT },
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
