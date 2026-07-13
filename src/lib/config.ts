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
 *
 * **これはテンポを決めない**（ticket 19）。発話するかどうかは時間だけで決まり、
 * この値は「そのとき実況させるか雑談させるか」の出し分けにしか使わない。
 * 実映像は取り込みノイズ・JPEG圧縮で常時わずかに揺れており、カーソル点滅でも
 * 0.02 を超える（実測）。テンポの門番に使うと点滅で喋り出す。
 */
export const FRAME_DIFF_THRESHOLD = 0.02;

/**
 * 発話の間隔（ミリ秒・前回の発話を**始めてから**の経過）。この範囲の一様乱数を
 * 1回ごとに引き直すので、等間隔の機械的なテンポにならない。
 *
 * 実際にはこの上に「読み上げが鳴り終わるまで待つ」（ticket 18）が乗り、発火粒度は
 * AUTO_NARRATE_INTERVAL_MS 刻みになる。読み上げは実測20秒前後なので、体感の沈黙は
 * だいたい (この値 − 20秒) 〜。
 *
 * 喋るほど課金される（画像送信＋TTS）。長めから詰める。
 */
export const SPEAK_INTERVAL_MIN_MS = 30000;
export const SPEAK_INTERVAL_MAX_MS = 60000;

/** 送信前ダウンスケールの長辺ピクセル数。FC版の低解像度なら十分読める。 */
export const FRAME_DOWNSCALE_LONG_EDGE_PX = 512;

/** 送信JPEGの品質（0〜1）。下げるほど軽い＝コスト減。 */
export const FRAME_JPEG_QUALITY = 0.7;

/**
 * 変化検知に使う極小グレースケール署名の長辺ピクセル数。
 * 512全画素を比較するより安価で、軽微なノイズにも強い。
 */
export const FRAME_DIFF_SAMPLE_LONG_EDGE_PX = 64;

/**
 * 「直前と同じことを繰り返さない」ためにプロンプトへ渡す直近AI発言の保持件数。
 * 雑談が続くと話題が一巡するため、数分ぶん（＝発話数件）を覚えておく。
 */
export const RECENT_LINES_KEEP = 8;

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

/** 章キャスト表の生成（/knowledge・ticket 16）で受け取る参照URLの上限。 */
export const KNOWLEDGE_MAX_URLS = 3;

/** 参照URLの取得タイムアウト（ミリ秒）。 */
export const KNOWLEDGE_FETCH_TIMEOUT_MS = 15000;

/** 参照URL1件から取り込む本文の上限文字数（トークンと事故の上限）。 */
export const KNOWLEDGE_MAX_TEXT_CHARS = 300000;

/**
 * 章ごとのLLM抽出を何件まで同時に走らせるか。
 * 混雑時に自分で圧をかけないよう控えめにする（1章の失敗が名簿の欠落に直結するため、
 * 速さより完走を優先する）。
 */
export const KNOWLEDGE_EXTRACT_CONCURRENCY = 2;

/**
 * 章ごとの抽出リトライ。`withRetry` の既定（3回・500ms 起点＝合計1.5秒）では、
 * Gemini の 503（数十秒続く高負荷スパイク）を吸収できず章が欠ける（実測）。
 * 5回・2秒起点なら 2+4+8+16 で30秒ほど粘る。
 */
export const KNOWLEDGE_EXTRACT_RETRIES = 5;
export const KNOWLEDGE_EXTRACT_BASE_DELAY_MS = 2000;
