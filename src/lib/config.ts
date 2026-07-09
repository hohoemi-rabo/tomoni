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

/**
 * 最後に喋ってからこの時間だけ沈黙が続いたら、変化検知を迂回して自発発話する。
 * 発火粒度は AUTO_NARRATE_INTERVAL_MS 刻みなので、実際は 20〜24 秒。
 * 静止しているほど喋る＝放置時間がそのまま課金になる。大きめから詰める。
 */
export const IDLE_CHATTER_MS = 20000;

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
 * 自発発話が IDLE_CHATTER_MS ごとに続くと話題が一巡するため、数分ぶんを覚えておく。
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
