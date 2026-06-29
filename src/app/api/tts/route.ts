import { DEFAULT_TTS_VOICE } from "@/lib/config";
import { getGoogleTtsApiKey } from "@/lib/env";
import { withRetry } from "@/lib/retry";

/**
 * 読み上げAPI `POST /api/tts`（REQUIREMENTS §4 / §7.1・ticket 08）。
 *
 * Google Cloud Text-to-Speech REST を直叩きして base64 mp3 を返す。クライアント
 * （`useTts`）は文末確定ごとにこれを呼び、音声を逐次再生する。
 *
 * - `GOOGLE_TTS_API_KEY` はこの Route Handler 内（サーバ）でのみ使う。
 * - TTS は Gemini と別系統の課金（各エンジン無料枠100万字）。送る文字数に注意。
 */

const TTS_ENDPOINT =
  "https://texttospeech.googleapis.com/v1/text:synthesize";

/** ストリーム開始前のエラーを画面表示できる JSON で返すための型付き例外。 */
class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface TtsRequest {
  text: string;
  voice: string;
}

/** 入力 `{ text, voice? }` を検証して正規化する。 */
function parseRequest(body: unknown): TtsRequest {
  if (typeof body !== "object" || body === null) {
    throw new TtsError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { text, voice } = body as Record<string, unknown>;

  if (typeof text !== "string" || text.trim() === "") {
    throw new TtsError("text（非空の文字列）が必要です。", 400);
  }
  if (voice !== undefined && (typeof voice !== "string" || voice.trim() === "")) {
    throw new TtsError("voice は非空の文字列で指定してください。", 400);
  }

  return { text, voice: (voice as string | undefined) ?? DEFAULT_TTS_VOICE };
}

/** ボイス名（例 ja-JP-Chirp3-HD-Aoede）から languageCode（ja-JP）を導出する。 */
function languageCodeOf(voice: string): string {
  return voice.split("-").slice(0, 2).join("-");
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new TtsError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const { text, voice } = parseRequest(body);

    // 一時エラー（ネットワーク・5xx）を withRetry で再試行する。
    const audioBase64 = await withRetry(async () => {
      const res = await fetch(`${TTS_ENDPOINT}?key=${getGoogleTtsApiKey()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: languageCodeOf(voice), name: voice },
          audioConfig: { audioEncoding: "MP3" }, // Chirp3-HD は最小設定で。
        }),
      });
      if (!res.ok) {
        throw new Error(`Cloud TTS 失敗(${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { audioContent?: string };
      if (!data.audioContent) {
        throw new Error("Cloud TTS の応答に audioContent がありません。");
      }
      return data.audioContent;
    });

    return Response.json(
      { audioBase64 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof TtsError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
