import { Type } from "@google/genai";

import { END_SESSION_MAX_LINES, GEMINI_STATE_MODEL } from "@/lib/config";
import { getGeminiClient, SAFETY_SETTINGS_BLOCK_NONE } from "@/lib/gemini";
import { updatePlaythroughState } from "@/lib/playthroughs";
import { withRetry } from "@/lib/retry";
import type { State } from "@/lib/types";

/**
 * セッション終了・state更新API `POST /api/end-session`（REQUIREMENTS §7.4・ticket 12）。
 *
 * 今回の実況ログを gemini-2.5-flash-lite で軽く要約し、`playthroughs.state` に
 * 書き戻す。次回の実況で「前回までのあらすじ」として使われる（配線は prompt.ts の
 * buildStateLines に既にある）。任意機能なので簡素でよい。
 *
 * - 要約中心: last_session_summary（3〜6文）＋progress を生成。chapter/lost_units は
 *   自動では触らない（誤抽出で正しい state を壊さないため）。chapter は手入力で確実に。
 * - APIキーはこの Route Handler 内（サーバ）でのみ使う。
 */

/** 要約プロンプト。攻略手順を禁じ、継続性のためのあらすじに絞る。 */
const END_SESSION_SYSTEM = [
  "あなたは、プレイヤーの隣で一緒に戦う戦友AIです。",
  "以下は今回のセッションであなたが話した実況ログです。これを踏まえ、次回再開時に",
  "『前回までのあらすじ』として渡すための短い振り返りを日本語でまとめてください。",
  "",
  "- last_session_summary: 今回の流れ・気持ちを戦友視点で3〜6文。話し言葉でよい。",
  "- progress: 現在の進捗の短いメモ（1文程度・分かる範囲で。無理なら省略可）。",
  "",
  "厳守: 攻略手順・最適手・正解ルートは書かない。",
  "画面から読み取れない断定（正確な数値や、文字が出ていないキャラ名の断定）はしない。",
].join("\n");

/** ストリーム開始前のエラーを画面表示できる JSON で返すための型付き例外。 */
class EndSessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface EndSessionRequest {
  playthroughId: string;
  lines: string[];
  chapter?: string;
}

/** 入力 `{ playthroughId, lines, chapter? }` を検証して正規化する。 */
function parseRequest(body: unknown): EndSessionRequest {
  if (typeof body !== "object" || body === null) {
    throw new EndSessionError(
      "リクエスト本文が不正です（JSON オブジェクトが必要）。",
      400,
    );
  }
  const { playthroughId, lines, chapter } = body as Record<string, unknown>;

  if (typeof playthroughId !== "string" || playthroughId.trim() === "") {
    throw new EndSessionError("playthroughId（非空の文字列）が必要です。", 400);
  }
  if (
    !Array.isArray(lines) ||
    !lines.every((l) => typeof l === "string")
  ) {
    throw new EndSessionError("lines は文字列の配列で指定してください。", 400);
  }
  if (chapter !== undefined && typeof chapter !== "string") {
    throw new EndSessionError("chapter は文字列で指定してください。", 400);
  }

  return {
    playthroughId,
    lines: lines as string[],
    chapter: chapter as string | undefined,
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new EndSessionError(
        "リクエスト本文を JSON として解釈できません。",
        400,
      );
    });
    const { playthroughId, lines, chapter } = parseRequest(body);

    // トークン抑制のため末尾 N 件だけ使う。空白のみの行は除く。
    const recent = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-END_SESSION_MAX_LINES);

    const partial: Partial<State> = {};

    // 実況ログがあれば lite モデルで要約（構造化JSON）。無ければ要約は作らない。
    if (recent.length > 0) {
      const result = await withRetry(() =>
        getGeminiClient().models.generateContent({
          model: GEMINI_STATE_MODEL,
          contents: recent.join("\n"),
          config: {
            systemInstruction: END_SESSION_SYSTEM,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                last_session_summary: {
                  type: Type.STRING,
                  description:
                    "戦友視点で今回の流れを3〜6文。攻略手順は書かない。",
                },
                progress: {
                  type: Type.STRING,
                  description: "現在の進捗の短い日本語メモ（1文・任意）。",
                },
              },
              required: ["last_session_summary"],
            },
            thinkingConfig: { thinkingBudget: 0 },
            safetySettings: SAFETY_SETTINGS_BLOCK_NONE,
          },
        }),
      );

      const parsed = JSON.parse(result.text ?? "{}") as {
        last_session_summary?: string;
        progress?: string;
      };
      if (parsed.last_session_summary?.trim()) {
        partial.last_session_summary = parsed.last_session_summary.trim();
      }
      if (parsed.progress?.trim()) partial.progress = parsed.progress.trim();
    }

    // 到達章は手入力を確実に反映（あれば）。
    if (chapter?.trim()) partial.chapter = chapter.trim();

    const updated = await updatePlaythroughState(playthroughId, partial);
    return Response.json(
      { ok: true, state: updated.state },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof EndSessionError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
