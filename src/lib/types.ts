/**
 * プロジェクト共通の最小型定義（REQUIREMENTS §7.1 / §9）。
 *
 * Supabase / Gemini の SDK 型には依存させない（基盤を SDK 非依存に保つ）。
 * データモデルの詳細は ticket 02 で具体化する。
 */

/**
 * 軽い継続性の state（緩いスキーマ）。すべて optional——state が無くても
 * 画面実況自体は成立する（現在状況は画面から読むため・§7.4）。
 */
export interface State {
  /** 到達章（例: "第3章"）。章キャスト表の選択にも使う（§7.2）。 */
  chapter?: string;
  /** 失った仲間（ロスト）の名前。 */
  lost_units?: string[];
  /** 進捗の短い日本語メモ。 */
  progress?: string;
  /** 前回までのあらすじ（3〜6文）。再開時に渡す。 */
  last_session_summary?: string;
}

/** 戦友AIのキャラ設定（最小・緩い形）。詳細はプロンプト組み立て側で扱う。 */
export interface Persona {
  /** 戦友の呼び名。 */
  name?: string;
  /** 口調・トーンの指定。 */
  tone?: string;
}

/** プレイスルー1件（Supabase `playthroughs` に対応・§9）。 */
export interface Playthrough {
  id: string;
  title: string;
  game_version: string;
  state: State;
  persona: Persona;
  created_at: string;
  updated_at: string;
}

/** 実況API `POST /api/narrate` の入力（§7.1）。 */
export interface NarrateRequest {
  playthroughId: string;
  imageBase64: string;
  recentLines: string[];
  /** プレイヤーからの話しかけ（STT・任意・§7.5）。あれば応答に反映する。 */
  userMessage?: string;
  /** 沈黙が続いたための自発発話か（任意・ticket 15）。実況ではなく雑談させる。 */
  isIdle?: boolean;
}

/**
 * 会話ログ1件（Supabase `messages` に対応・§9）。
 * 動画用ログ／ふりかえり表示のためだけに保存し、継続性には使わない。
 */
export interface Message {
  id: string;
  playthrough_id: string;
  role: string;
  content: string;
  created_at: string;
}
