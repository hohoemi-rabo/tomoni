/**
 * 一時エラー向けの指数バックオフ付きリトライ（REQUIREMENTS §3 / §11）。
 *
 * 外部API（Gemini・Cloud TTS）は失敗しうる前提で、最大3回まで自動再試行する。
 * 全試行が失敗したら最後のエラーを再送出する（握りつぶさない）。
 */

export interface RetryOptions {
  /** 最大試行回数（既定 3）。 */
  retries?: number;
  /** 初回バックオフのベース遅延（ミリ秒・既定 500）。試行ごとに倍化する。 */
  baseDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fn` を最大 `retries` 回まで試行する。失敗するたびに指数バックオフで待機する
 * （例: baseDelayMs=500 → 500ms, 1000ms, ...）。最終試行も失敗したら throw。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 500 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  throw lastError;
}
