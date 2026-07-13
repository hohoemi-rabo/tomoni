# AS-BUILT — 実装仕様書（2026-07-14 時点・チケット20/21/22 まで）

**この文書の位置づけ**：`REQUIREMENTS.md` が「**何を作るか**」（意図・スコープ・強い制約の一次情報）であるのに対し、これは「**いま何が動いているか**」のスナップショット。実装済みのモジュール・API 契約・定数の実値・実測で確定した挙動をまとめる。

- **仕様の判断は `REQUIREMENTS.md` を正とする**。この文書はコードの写像なので、両者が食い違ったら **コードとこの文書のほうが間違っている**（あるいは仕様書の更新漏れ）。方針転換のときは `REQUIREMENTS.md` → コード → この文書 の順で直す。
- 進捗管理は `docs/00-index.md` のチケットと各 `## Todo`。この文書は進捗表ではない。
- 対象範囲：**チケット 01〜22＝実装完了ぶん**。23（ゲーム登録）は未着手なので「未実装」として §11 に記す。

---

## 1. 全体像

「**フレーム取得 → 送信 → 生成 → 読み上げ**」の1本のループがアプリの本体。人間はゲームを遊ぶだけで、AI が勝手に喋り続ける。

```
OBS（エミュレータ画面）
   └─ 仮想カメラ ──► getUserMedia ──► <video>  ［ブラウザ／クライアント］
                                        │
              4秒ごとに評価 ────────────┤ canvas → 長辺512px JPEG(base64)
                                        │        ＋ 64px グレースケール署名（差分用）
                                        ▼
      ①生成中でない → ②読み上げ中でない → ④返事待ちでない → ③前回発話から乱数間隔(30〜60秒)経過
                                        │  4つ抜けたら必ず送る
                                        ▼
        POST /api/narrate ─► システムプロンプト（primer＋振る舞い＋章キャスト＋state＋直近発言）
                             ＋ 画像1枚 ＋ ターン指示（実況／雑談／質問／切り上げ）
                             └─► Gemini 2.5 Flash（Vision・ストリーミング）
                                        │ chunk.text を ReadableStream で返す
                                        ▼
                     逐次表示 ＋ 文末が確定するたび POST /api/tts
                                        └─► Cloud TTS（Chirp3-HD）→ base64 mp3 → 再生キュー
```

**ゲーム側への出力は一切無い**（アプリはゲームを操作しない・読むだけ）。録画は OBS 本体が行い、アプリは「録画モード」で画面を差し出すだけ。

---

## 2. 実行環境

- Next.js 15.5（App Router）+ React 19 + TypeScript(strict)、Tailwind CSS 3.4。`@/*` → `src/*`。
- ローカル専用。**認証・RLS・デプロイ無し**。単一ユーザー前提。
- `npm run dev` / `npm run build` / `npm run start` / `npm run lint`。
- **APIキーはすべてサーバ専用**（`GEMINI_API_KEY` / `GOOGLE_TTS_API_KEY`・`.env.local`）。`env.ts` / `supabase.ts` / `gemini.ts` は `server-only` 付きで、クライアントから import するとビルドが落ちる＝**キーの露出は型と依存で防いでいる**（規約ではなく機構で）。
- テストフレームワークは未導入。検証手段は §10。

外部サービス：
| 用途 | サービス | モデル/ボイス |
|------|----------|---------------|
| 画面実況（主役・Vision） | Google Gen AI (`@google/genai`) | `gemini-2.5-flash` |
| state 要約・章キャスト抽出 | 同上 | `gemini-2.5-flash-lite` |
| 音声合成 | Cloud Text-to-Speech（REST 直叩き） | `ja-JP-Chirp3-HD-*`（既定 Aoede） |
| 音声認識（任意） | Web Speech API（ブラウザ内蔵） | Chrome 系のみ |
| DB | Supabase（`tomoni` / ap-northeast-1） | — |

Gemini 呼び出しは全て `thinkingConfig.thinkingBudget: 0`（テンポ優先）、`safetySettings` 全カテゴリ `BLOCK_NONE`（戦闘・戦死の描写で空応答にならないため）。

---

## 3. データモデル（実装どおり）

`supabase/migrations/0001_init.sql`。RLS 無し。

```sql
playthroughs(
  id uuid pk, game text not null default 'fe-fc',   -- 0002: 知識ディレクトリの slug
  title text, game_version text,
  state jsonb default '{}', persona jsonb default '{}',
  created_at, updated_at)

messages(
  id uuid pk, playthrough_id uuid references playthroughs on delete cascade,
  role text, content text, created_at)
-- index: (playthrough_id, created_at)
```

- **`game` がそのプレイスルーの知識ディレクトリを決める**（`knowledge/<game>/`・§4）。既定 `'fe-fc'`。
- **`state` は緩い jsonb**（全キー任意）：`chapter` / `lost_units[]` / `progress` / `last_session_summary`。**キーはゲームが変わっても `chapter` のまま**で、プレイヤーに見せる呼び方（「到達章」「現在のエリア」）だけを `game.json` から差す（jsonb の移行を避けるため）。**state が空でも実況は成立する**（現在状況は画面から読むため）。実装上、自動で書かれるのは `last_session_summary` と `progress` の2つだけで、`chapter` は手入力、`lost_units` は誰も書かない（誤抽出で正しい state を壊さないための判断）。
- **`persona` は作成時に DB へコピーされる**（`DEFAULT_PERSONA` を後から直しても既存プレイスルーには届かない）。
- プレイスルー削除で `messages` は cascade で消える（アプリ側では消さない）。
- `messages` テーブルは**現状ほぼ使っていない**（動画用ログ用に確保してある）。セッション中の発言はクライアントの `sessionLinesRef` に持ち、終了時に `/api/end-session` へ渡す。

---

## 4. 知識ファイル `knowledge/<game>/`（攻略データではない・ゲーム1本＝ディレクトリ1つ）

AI の**感情・反応を正しくする前提**と、**今この章に誰がいるか**だけ。**ファイルを置くだけでゲームが増える**（チケット20）——ゲームを足すためにコードを書かない。

```
knowledge/<slug>/          slug は [a-z0-9-]+（gameDir が検証する）
├── game.json              呼び方（title / version / progressLabel / progressPlaceholder / lostLabel）
│                          ＋ 任意の knowledgeBuilder（/knowledge の抽出設定・ticket 21）
├── primer.md              そのゲームの前提だけ（システムプロンプト先頭に固定注入）
└── chapters/chapter-XX.md 章キャスト表（任意・章構造を持つゲームだけ）
```

`knowledgeBuilder`（任意・**無ければ `/knowledge` の章抽出はそのゲームで無効**）：`sectionHeading`（章見出しの正規表現）／`sectionLabel`（`第{n}章`）／`subject`（版の同定）／`groups`（`key` / `heading` / `description` / `accumulate`）／`fields`（`klass` `lv` `hp` `items` `isBoss` `count` から選ぶ）／`extra`。**「どんなゲームの表も読める1つの賢いスキーマ」は作らない**——宣言できるゲームだけ宣言し、書かないゲームは知識ファイルを手書きする（§8.4 その2）。

- `fe-fc/primer.md` — 中身は「このゲームの同定（FC版1990・後発作品を混ぜない・何が禁じられた"手順"か）」「感情が動くポイント（ロスト＝永久離脱・命中率・クリティカル・章クリア）」「基本ルール」「当時の背景ネタ」「画面認識上の固有事情（ドット絵では個人を判別できない）」。
- `fe-fc/chapters/chapter-01.md` 〜 `chapter-25.md` — **`state.chapter` に対応する1ファイルだけ**注入する（全章一括はトークン肥大）。第1〜25章は生成・目視確認・保存済み。
  - 自軍は第1章からの**累積**（その時点で画面にいる全員が要る）、敵はその章のみ。
  - 体裁は `- マルス／ロード／Lv1 HP18／持ち物: レイピア` の1行形式。**加入・攻略の手順は書かない**。
- ローダー：
  - `src/lib/games.ts`（`server-only`）：`loadGameDef(slug)` / `listGames()` / `gameDir(slug)` / `isValidGameSlug`。**`gameDir` が `path.join` の唯一の入口で、ここが slug を検証する**（パストラバーサル封じ）。`game.json` の無いディレクトリは `listGames` が無視する。
  - `src/lib/knowledge.ts`（`server-only`）：`loadPrimer(game)` / `loadChapterCast(game, chapter)` / `chapterFileName(n)`。`chapterToNumber` が「第１０章」等の全角も吸収し、**数字が無ければ null＝章キャスト表を引かない**（章という単位を持たないゲームは、ここが常に null になるだけで実況は成立する）。**章ファイルが無ければ丸ごとスキップ**。

> **中身が空のテンプレを置かない。** `buildSystemPrompt` は非空なら注入するので、プレースホルダがそのままキャスト表として AI に渡る。ファイルが無いほうが正しい。

---

## 5. システムプロンプト（2層構造）

`src/lib/prompt.ts` の `buildSystemPrompt`（純関数・secrets/fs に触れない）が1本に組む。**同じ趣旨を2層に書かない**——後から注入された方が先を打ち消す（実測）。

| 層 | 置き場所 | 持つもの |
|----|----------|----------|
| **ゲームの層** | `knowledge/<game>/primer.md`（先頭固定） | そのゲームは何か・何に感情が動くか・何が「手順」か・画面認識上の固有事情 |
| **振る舞いの層** | `prompt.ts`（ゲーム非依存） | 戦友としてどう振る舞うか（下記） |
| **呼び方** | `knowledge/<game>/game.json` | 進捗・ロストのラベルだけ（AIの振る舞いも、ゲームの前提も書かない） |

> **`prompt.ts` は値を import しない**（型のみ）。`node --experimental-strip-types src/lib/prompt.ts` で直接実行して検証できる状態を保つため（`@/` エイリアスは node が解決できない）。`DEFAULT_PROGRESS_LABEL` を `prompt.ts` に置いているのはこの理由。

組み上がる順序：

1. **プライマー**（先頭固定）
2. **戦友としての振る舞い（厳守）** — 能動的に話す／3つの顔（実況・語り部・励まし）／**攻略はしない**（最適手・正解ルート・操作手順を出さない）／**ネタバレはしてよい**（線引き＝「事実は語る、手順は言わない」）／感情を正しく動かす（何にかはプライマー）／**読み上げ前提・話し言葉で3〜4文**（← **発話長の指示はこの1行だけ**）／**固有名は慎重に**（画面に文字が出ていない限り断定しない）／画面から読めない内部数値を断定しない／`persona.name`・`persona.tone`
3. **いま出てくる登場人物（照合用）** — 章キャスト表（あるときだけ）
4. **これまでの状況** — `state` の存在するフィールドだけ。**呼び方は `game.json` から差す**（`progressLabel` ／ `lostLabel`。`progressLabel` が無ければ `DEFAULT_PROGRESS_LABEL = "進行状況"`、**`lostLabel` が無ければロスト行そのものを出さない**＝その概念を持たないゲーム）
5. **直前のあなたの発言（繰り返さない）** — 直近8件
6. **プレイヤーからの話しかけ** — STT のテキスト（あるときだけ・最も操作的なので最後）

**「そのターンで実況させるか雑談させるか」はここに書かない**。それは `/api/narrate` 内の画像に隣接する2定数（`NARRATE_TURN_TEXT` / `IDLE_TURN_TEXT`）だけが決める。

---

## 6. API 契約（4本）

すべて Route Handler（Node.js ランタイム）。POST は本質的に非キャッシュ。エラーは握りつぶさず `{ error: string }` JSON ＋ 適切な status で返す。

### `POST /api/narrate` — 実況（主役・ストリーミング）
- 入力 `{ playthroughId, imageBase64, recentLines[], userMessage?, turnKind? }`
  - `turnKind`（ticket 22）：`'narrate' | 'chat' | 'question' | 'giveup'`。省略時 `'narrate'`。**未知の値は 400**（黙って narrate に落とさない）。旧 `isIdle` は**廃止**（同義の入力を2つ残すと、どちらが勝つかで必ず事故る）。
- 処理：入力検証 → `playthrough`（DB）→ **その `game` で** primer・`game.json`・章キャスト表を fs から並列取得 → `buildSystemPrompt` → `gemini-2.5-flash` の `generateContentStream`
- 出力：`text/plain; charset=utf-8` の `ReadableStream`（`chunk.text` をそのまま流す）
- **`withRetry` は「確立まで」だけ**。ストリーム開始後の失敗は `controller.error` で伝える（再試行するとテキストが重複するため）。
- ターン指示は**画像に隣接する4定数**（`TURN_TEXT`）だけが持つ。**`userMessage` があれば `turnKind` を無視**して応答を優先する。`question` は「**プレイヤー本人に**向けて聞く（独り言・修辞疑問にしない）」と明示している——書かないと「どんな戦いが待っているんだろう」のような独り言になった（実測）。`giveup` は「冒頭で軽く切り上げ、**そのまま今の画面の話に続ける**」（切り上げの一言だけで終わらせない）。

### `POST /api/tts` — 読み上げ
- 入力 `{ text, voice? }` → 出力 `{ audioBase64 }`（mp3）。Cloud TTS REST を直叩き（SDK 無し）。`languageCode` はボイス名から導出（`ja-JP-Chirp3-HD-Aoede` → `ja-JP`）。`withRetry` あり。

### `POST /api/end-session` — 継続性（任意）
- 入力 `{ playthroughId, lines[], chapter? }` → 出力 `{ ok, state }`
- 実況ログ末尾40件を `gemini-2.5-flash-lite` で**構造化JSON**（`last_session_summary` 必須／`progress` 任意）に要約し、`updatePlaythroughState` で jsonb マージ。**`chapter` は手入力をそのまま反映**、`lost_units` は触らない。

### `POST /api/knowledge/extract` と `/api/knowledge/save` — 章キャスト表の生成（一度きりの道具）
- 入力はどちらも `{ game, ... }`。**ゲーム定義の `knowledgeBuilder` が抽出スキーマ・グループ・章見出し・同定文を決める**（ticket 21）。持たないゲームは extract が **422** を返し、UI 側も選択肢に「未対応」と出して実行を止める。
- extract：URL（最大3件）取得 → **文字コード判定**（誤ると LLM が幻覚を返す。実測で Shift-JIS を UTF-8 で読んで「GBA版」と答えた）→ タグ除去 → 章分割 → 章ごとに `flash-lite` で**構造化JSONだけ**抽出（同時実行2・リトライ5回/2秒起点）。**整形は純関数**（`renderChapterMarkdown` がグループ定義から見出しを組む）。**ファイルは書かない**。
- save：**目視確認後**に書き出す。**リポジトリ内で唯一の `writeFile`**。slug は `gameDir` が `[a-z0-9-]+` で検証し、**実在するゲーム定義が無ければ 404**（`knowledge/` にゴミのディレクトリを作らせない）。ファイル名は章番号からサーバ側で組み立てる（クライアントの文字列を使わない）。

---

## 7. クライアント側モジュール

### `useAutoNarration`（自動実況ループの心臓）
4秒ごと（`AUTO_NARRATE_INTERVAL_MS`）に tick し、**関門は4つ**（この順で評価する）。

1. **生成中でないか**（`busyRef`）
2. **`canSpeak()`** — 読み上げ中でない（`!tts.speaking && tts.queueLength === 0`）
3. **返事待ちでないか**（`awaitingRef`・ticket 22）— **②の後に置く**。待ち時間は**質問の読み上げが終わってから**計り始めるため（読み上げ中から計ると、長い質問ほど待ち時間が短くなる）。期限（`answerDeadlineRef`）が `null` の間は「まだ計り始めていない」。過ぎたら `turnKind: 'giveup'` を1回だけ送って通常ループへ戻る（**黙り込ませない**）。
4. **時間** — 前回**発話開始**から `gapRef`（30〜60秒の乱数・毎回引き直し）が経過したか

**4つ抜けたら必ず送る。何を喋るかは `pickTurnKind`（`src/lib/turn.ts`・純関数）が決める**：話しかけがあれば実況（応答優先）／`QUESTION_TURN_PROBABILITY`（0.3）で質問を抽選（**直前の発言が問いかけで終わっていたら抽選しない**＝連続質問の禁止）／外れたら `diff > 0.02` で実況・以下で雑談。**乱数は引数で注入する**ので、確率も分岐もブラウザ抜きで検証できる。

- **ピクセル差分はテンポの門番ではない**（ここが本プロジェクト最大の学び）。実映像は OBS の取り込み・スケーリング・JPEG圧縮で常時揺れており、**カーソルの点滅だけでしきい値を超える**。差分は「実況か雑談か」の出し分けにしか効かない。
- 乱数間隔は `send()` 内の `rollGap()` で引き直す。`send()` が**唯一の送信集約点**なので、手動トリガー／STT の直後もループが被せてこない。
- **`triggerNow`（手動・STT）には関門2・3・4を掛けない**（自分で押したのに黙るのは故障に見える）。**返事待ちも解除する**——話しかけ＝質問への回答、手動トリガー＝「先へ進みたい」の意思表示。
- ON にした直後は `gap = 0`（最初の1回をすぐ喋る）。
- `onSend` は**確定した発言を返す**。hook はそれを `looksLikeQuestion`（末尾が `?` / `？`）にかけて「次のターンで質問を続けない」ための記録にする。**送ったターン種別ではなく実際の発言を見る**——実況ターンでも問いかけで締めることがあり、聞かれた側の体感は「また質問された」になるから。

### `useTts`（読み上げキュー）
- `feed(chunk)` → `takeSentences` で**文末が確定した文だけ**キューへ → `flush()` で残りを確定。
- **1文先読みパイプライン**（現在の文を再生しながら次の文の音声を先取得）で文間の間を詰める。
- `reset()` は再生とキューを破棄する。**新しい発言を始めると前の発言が死ぬ**のはこれが理由で、だから関門2（`canSpeak`）が要る。
- **中断（`stopAndClear`）は、再生中の Promise を明示的に解決し、世代番号を進める**（ticket 22 で判明したバグの修正）。`pause()` では `ended` も `error` も発火しないので、それを待っている `playBase64` の Promise が永久に解決されず、**`speaking` が真のまま張り付いて関門2が二度と開かない**＝AIが黙り込む。世代番号は「reset 前に先読みしていた音声が、新しい発言のあとから鳴り出す」のも防ぐ。
- TTS の失敗はその文を飛ばすだけでキュー全体は止めない。

### その他
- `video/types.ts` の `VideoSource` 抽象 ＋ `userMediaSource.ts`（`getUserMedia` 実装）。**映像ソースは差し替え可能な1モジュール**（将来 `getDisplayMedia` も足せる）。
- `frame.ts`：`captureFrame`（送信用JPEG ＋ 64px グレースケール署名を同時生成・canvas は使い回す）／`signatureDiff`（平均絶対差 ÷ 255）。
- `useSpeechRecognition`：Web Speech の最小ラッパ（押して話す・`continuous: false`）。非対応なら `supported: false` で UI ごと無効化。
- `VideoPreview`：**コールバック props は親が `useCallback` で安定参照にする**（インライン関数だと、ストリーミング中のチャンク毎再レンダーで `<video>` の callback ref が付け外しされ続ける）。

---

## 8. 定数（`src/lib/config.ts` の実値・調整はここだけ）

| 定数 | 値 | 意味 |
|------|-----|------|
| `AUTO_NARRATE_INTERVAL_MS` | 4000 | tick の粒度（送信間隔ではない） |
| `SPEAK_INTERVAL_MIN_MS` / `MAX_MS` | 30000 / 60000 | **発話間隔の乱数レンジ**（テンポを変えたいならここ） |
| `FRAME_DIFF_THRESHOLD` | 0.02 | 実況／雑談の出し分けのみ。**テンポには効かない** |
| `QUESTION_TURN_PROBABILITY` | 0.3 | 質問ターンを引く確率（話しかけが無いときだけ抽選） |
| `QUESTION_ANSWER_TIMEOUT_MS` | 90000 | 返事待ちの上限。**読み上げ完了から**計る。この待ちは動画の無音そのもの——実プレイで詰める前提の値 |
| `FRAME_DOWNSCALE_LONG_EDGE_PX` | 512 | 送信画像の長辺（コストの主因は画像） |
| `FRAME_JPEG_QUALITY` | 0.7 | |
| `FRAME_DIFF_SAMPLE_LONG_EDGE_PX` | 64 | 差分署名の長辺 |
| `RECENT_LINES_KEEP` | 8 | 「繰り返さない」ために渡す直近発言 |
| `DEFAULT_TTS_VOICE` | `ja-JP-Chirp3-HD-Aoede` | 候補は `TTS_VOICES` に8種 |
| `END_SESSION_MAX_LINES` | 40 | 要約に渡すログ件数 |
| `KNOWLEDGE_EXTRACT_CONCURRENCY` | 2 | 章抽出の同時実行 |
| `KNOWLEDGE_EXTRACT_RETRIES` / `BASE_DELAY_MS` | 5 / 2000 | **既定（3回・500ms）では 503 に耐えられない**（実測） |
| `withRetry` の既定 | 3回 / 500ms 起点 | 指数バックオフ |

---

## 9. 画面

| ルート | 種別 | 役割 |
|--------|------|------|
| `/` | Server Component（`force-dynamic`） | プレイスルー一覧・新規作成（Server Action・**`listGames()` からゲームを選ぶ**。選ぶとタイトル/バージョンの既定値が入る＝上書き可）・削除（確認あり・cascade）・`/knowledge` への導線 |
| `/session/[id]` | Server + `SessionClient`（`'use client'`） | **本体**。映像プレビュー＋カメラ選択／自動実況 ON・OFF／手動「今の場面について話して」／ストリーミング表示／読み上げ ON・OFF・ボイス選択／「押して話す」（STT）／セッション終了して保存（進捗入力・**ラベルは `game.json` から**） |
| `/session/[id]`（録画モード） | 同ファイル内オーバーレイ | `fixed inset-0` の全画面。単色背景に**AI発言だけ**を中央大表示。文字サイズ段階切替・Esc で解除。**ループは止めない**（OBS で撮る前提） |
| `/knowledge` | 一度きりの道具 | 参照URL → 章キャスト表の下書き → **目視確認** → 保存 |
| `/capture-test` / `/tts-test` | 切り分け用ハーネス | 03/04 と 08 の手動確認用。実況ループから独立 |

---

## 10. 検証手段（テストフレームワークが無いので、何で確かめたかを残す）

- **純粋なサーバ側ロジック**（`prompt.ts` / `sentence.ts` / `knowledge-extract.ts` など型のみ import のもの）：`node --experimental-strip-types <file>.mts` で実モジュールを直接実行。**依存を使う検証スクリプトはプロジェクト直下に置いて実行し、終わったら消す**（scratchpad からだと `node_modules` を解決できない）。
- **API Route**：`npm run dev` 後に `curl` で疎通・異常系。検証用 JPEG は `curl https://picsum.photos/256.jpg`（1x1 の極小 JPEG は Gemini が弾く）。
- **DB**：Supabase MCP（`execute_sql`）。**ダミー行は必ず消す。`WHERE` 無しの `UPDATE`/`DELETE` は実行しない。**
- **ブラウザ依存（映像取り込み・自動ループ・読み上げ）**：`.claude/skills/verify/SKILL.md` の手順で Playwright の偽カメラを使い**無人で駆動**できる。タイミング系を触ったら `git stash` で**変更前と A/B を取る**（「直った」より先に「壊れていたことを検出できるハーネスだ」と示す）。`--autoplay-policy=no-user-gesture-required` を忘れると mp3 が鳴らず、**読み上げが一瞬で終わったように見えて誤判定する**。
- **プロンプトの回帰**：`buildSystemPrompt` を組んで Gemini に投げ、①版の同定（FC版1990・三すくみ否定）②ロストを重く悼むか ③加入手順を断りつつ固有名（事実）は語るか、の3点を確認する。

> `npm run dev` 起動中に `npm run build` すると `.next` が壊れて dev サーバが 500 を返す。build するときは dev を止める。

---

## 11. 実装で確定した強い制約と、未実装

### コードで守っている制約（`REQUIREMENTS.md §5.2 / §12`）
- ❌ **攻略アドバイス／最適手／操作手順**（聞かれても一緒に悩む側）— プロンプトの厳守事項＋プライマーの「手順」定義＋章キャスト表に手順を書かないこと、の3点で守る。
- ❌ 攻略ナレッジの大量注入・RAG／埋め込み検索 — 注入は「プライマー1枚 ＋ 現在章のキャスト表1枚」だけ。
- ❌ 認証・マルチユーザー・デプロイ・公開。
- ❌ 秒単位の高速実況（技術的に不可・数秒のラグ前提）。
- ✅ **ネタバレはしてよい**（14 で撤廃）。線引きは「事実は語る、手順は言わない」。
- ✅ **参照サイトからの取得はしてよい**（16 で撤廃）。`/knowledge` での名簿化のための一度きりに限る。実況ループからは取得しない。
- ✅ **AIから質問してよい**（22・**実装済み**）。禁じるのは**質問の形をした手順誘導**（「シーダで話しかけてみたら?」）と、返事を強要する振る舞い（催促・蒸し返し）。質問は答えなくても成立する軽い投げかけで、90秒で自分から切り上げる。
- ✅ **ゲームの差し替えはしてよい**（20 で撤廃・**実装済み**）。`knowledge/<slug>/` に `game.json` と `primer.md` を置けば、**`src/` を1行も触らずに**そのゲームのプレイスルーを作れる（ダミーゲームで A/B 検証済み：同じコード・同じ画像で、プレイスルーの `game` を変えると注入されるプライマーが切り替わる）。

### 未実装（＝いま無いもの。先読みで作らないこと）
- **チケット23（ゲーム登録）**：`/knowledge` からタイトル・機種・URL を入れて `game.json` ＋ `primer.md` の下書きを作る流れ。**現状 primer は手書き**（`/knowledge` にあるのは章キャスト表の生成だけ）。
- テストフレームワーク（未導入）。`messages` テーブルへの書き込み（テーブルはあるが使っていない）。
- 実機での通し確認（OBS仮想カメラ→自動実況→読み上げ→録画モード→STT）と、発話間隔 30〜60秒が実プレイで適切かの詰め（18・19 の Todo に残っている）。
