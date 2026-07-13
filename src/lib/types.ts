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

/**
 * ゲーム定義（`knowledge/<slug>/game.json`・§8.0・ticket 20）。
 *
 * 「そのゲームをどう呼ぶか」だけを持つ。**AIの振る舞いは書かない**（prompt.ts）。
 * **そのゲームの前提も書かない**（primer.md）。
 */
/**
 * 章キャスト表の抽出設定（`game.json` の任意フィールド・§8.4・ticket 21）。
 *
 * **無いゲームでは `/knowledge` の章抽出を使えない**（＝知識ファイルは手書き、または
 * スクショから Claude Code に起こさせる）。「どんなゲームの表も読める1つの賢いスキーマ」は
 * 存在しないので、汎用の抽出器を作ろうとしないこと。宣言できるものだけ宣言する。
 */
export interface KnowledgeBuilderDef {
  /** 章見出しの正規表現（1つ目のキャプチャ群が章番号）。行頭に当てる。 */
  sectionHeading: string;
  /** 章の呼び方。`{n}` が章番号に置き換わる（例: "第{n}章"）。 */
  sectionLabel: string;
  /** 抽出対象の同定（版の取り違え防止）。プロンプト冒頭に置く。 */
  subject: string;
  /** ユニットの分類。表の見出しと、章をまたいで累積するかを持つ。 */
  groups: KnowledgeGroupDef[];
  /** LLM に埋めさせる列（`CastUnit` の任意フィールドから選ぶ）。 */
  fields: KnowledgeField[];
  /** そのゲーム固有の抽出上の注意（任意）。 */
  extra?: string;
}

export interface KnowledgeGroupDef {
  /** 内部キー（`allies` 等）。 */
  key: string;
  /** 生成する Markdown の見出し（`## 自軍（仲間）` 等）。 */
  heading: string;
  /** 何をこのグループに入れるかの説明（LLM への指示になる）。 */
  description: string;
  /** 第1章から累積するか（FEの自軍のように「その章で新規加入した人しか表に載らない」場合）。 */
  accumulate?: boolean;
}

export type KnowledgeField = "klass" | "lv" | "hp" | "items" | "isBoss" | "count";

export interface GameDef {
  /** ディレクトリ名（`[a-z0-9-]+`）。ファイル名から復元するので JSON には書かない。 */
  slug: string;
  /** 表示名。新規作成フォームの既定タイトル。 */
  title: string;
  /** 版・機種（例: "ファミコン版（1990）"）。 */
  version?: string;
  /** 進捗（`state.chapter`）の呼び方（例: "到達章" / "現在のエリア"）。 */
  progressLabel?: string;
  /** 進捗入力欄のプレースホルダ（例: "例: 第2章"）。 */
  progressPlaceholder?: string;
  /** 失った仲間（`state.lost_units`）の呼び方。**省略＝その概念が無い＝出さない**。 */
  lostLabel?: string;
  /** 章キャスト表の抽出設定（任意・ticket 21）。**無ければ `/knowledge` の章抽出は使えない**。 */
  knowledgeBuilder?: KnowledgeBuilderDef;
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
  /** 知識ディレクトリの slug（`knowledge/<game>/`・既定 `'fe-fc'`・ticket 20）。 */
  game: string;
  title: string;
  game_version: string;
  state: State;
  persona: Persona;
  created_at: string;
  updated_at: string;
}

/**
 * そのターンでAIに何をさせるか（§7.1・ticket 22）。**旧 `isIdle` を置き換える**。
 *
 * - `narrate` … 画面が変化した。今この瞬間を実況する。
 * - `chat` … 画面が止まっている。昔話・雑談・励ましに回る（旧 `isIdle: true`）。
 * - `question` … プレイヤーへの軽い問いかけ。**答えなくても成立する**もの。
 * - `giveup` … 返事待ちのタイムアウト。冒頭で軽く切り上げ、そのまま実況・雑談へ続ける。
 *
 * 実際の指示文は `/api/narrate` の4定数だけが持つ（システムプロンプトに書かない）。
 */
export type TurnKind = "narrate" | "chat" | "question" | "giveup";

export const TURN_KINDS: readonly TurnKind[] = [
  "narrate",
  "chat",
  "question",
  "giveup",
];

/** 実況API `POST /api/narrate` の入力（§7.1）。 */
export interface NarrateRequest {
  playthroughId: string;
  imageBase64: string;
  recentLines: string[];
  /** プレイヤーからの話しかけ（STT・任意・§7.5）。あれば応答に反映する。 */
  userMessage?: string;
  /** そのターンの種類（任意・ticket 22）。省略時は `'narrate'`。 */
  turnKind?: TurnKind;
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
