/**
 * サーバ専用の環境変数アクセサ。
 *
 * - APIキーはすべてサーバ専用（`NEXT_PUBLIC_` を付けない）。このモジュールを
 *   クライアントコンポーネントから import しない。
 * - 検証は「読み込み時」ではなく「呼び出し時」に行う（遅延評価）。これにより、
 *   実キーが無い CI / ビルド環境でも `next build` がトップレベルで失敗しない。
 */

/**
 * 環境変数を必須として読む。未設定または空文字なら、変数名を含む明確な
 * エラーを投げる（早期検出・明確なメッセージ）。
 */
export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `環境変数 ${name} が未設定です。.env.local に ${name} を設定してください（.env.example を参照）。`,
    );
  }
  return value;
}

/** Gemini 呼び出し用 APIキー（サーバ専用）。 */
export function getGeminiApiKey(): string {
  return requireServerEnv("GEMINI_API_KEY");
}

/** Cloud Text-to-Speech 用 APIキー（サーバ専用）。 */
export function getGoogleTtsApiKey(): string {
  return requireServerEnv("GOOGLE_TTS_API_KEY");
}
