/**
 * 調整可能な共通定数の一元管理（REQUIREMENTS §3 / §6.2 / §11）。
 *
 * 自動実況ループのテンポ・コストに直結する値はここでまとめて調整する。
 * ハードコードを各所に散らさず、後でまとめてチューニングできるようにする。
 */

/**
 * 自動実況ループでフレームを評価する間隔（ミリ秒）。数秒テンポが前提。
 * 生成中は次の送信を抑止するため、これを詰めても体感は生成速度で頭打ちになる。
 */
export const AUTO_NARRATE_INTERVAL_MS = 4000;

/**
 * 変化検知のしきい値（0〜1 の正規化ピクセル差分）。
 * 前回送信フレームとの差分がこの値を超えたときだけ Gemini に送る。
 * 小さいほど敏感（送信回数が増える＝コスト増）。
 */
export const FRAME_DIFF_THRESHOLD = 0.02;

/** 送信前ダウンスケールの長辺ピクセル数。FC版の低解像度なら十分読める。 */
export const FRAME_DOWNSCALE_LONG_EDGE_PX = 512;

/** 送信JPEGの品質（0〜1）。下げるほど軽い＝コスト減。 */
export const FRAME_JPEG_QUALITY = 0.7;

/**
 * 変化検知に使う極小グレースケール署名の長辺ピクセル数。
 * 512全画素を比較するより安価で、軽微なノイズにも強い。
 */
export const FRAME_DIFF_SAMPLE_LONG_EDGE_PX = 64;

/** 「直前と同じことを繰り返さない」ためにプロンプトへ渡す直近AI発言の保持件数。 */
export const RECENT_LINES_KEEP = 5;

/** 既定の読み上げボイス（Chirp3-HD・日本語）。調整可能。 */
export const DEFAULT_TTS_VOICE = "ja-JP-Chirp3-HD-Aoede";

/**
 * ボイス選択UI用の候補（Chirp3-HD・ja-JP）。`DEFAULT_TTS_VOICE` を含む。
 * Chirp3-HD は言語をまたいで同じキャラクター名を使う。疎通しない名前が出たら除外する。
 */
export const TTS_VOICES = [
  "ja-JP-Chirp3-HD-Aoede",
  "ja-JP-Chirp3-HD-Kore",
  "ja-JP-Chirp3-HD-Leda",
  "ja-JP-Chirp3-HD-Zephyr",
  "ja-JP-Chirp3-HD-Puck",
  "ja-JP-Chirp3-HD-Charon",
  "ja-JP-Chirp3-HD-Fenrir",
  "ja-JP-Chirp3-HD-Orus",
] as const;

/** 画面実況（Vision・主役）に使う Gemini モデル。 */
export const GEMINI_NARRATE_MODEL = "gemini-2.5-flash";

/** state 更新（任意・要約＋JSON化）に使う Gemini モデル。 */
export const GEMINI_STATE_MODEL = "gemini-2.5-flash-lite";

/** end-session でモデルへ渡す実況ログの最大件数（トークン抑制）。 */
export const END_SESSION_MAX_LINES = 40;

/** 音声認識（STT・Web Speech）の言語。 */
export const STT_LANG = "ja-JP";
