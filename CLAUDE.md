# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**ともに / Tomoni** — 苦手なシミュレーションRPGを、画面を見て実況・昔話・励まし・**問いかけ**をしてくれる「戦友AI」と一緒にクリアを目指す**自分専用ツール**。最終成果物は YouTube 動画で、アプリはその道具。**第一の題材は ファミコン版『ファイアーエムブレム 暗黒竜と光の剣』（1990 / FE1）**だが、**ゲームは差し替え可能**（`knowledge/<slug>/` にファイルを置けば増える・チケット20/21）。認証・公開・デプロイは無く、開発者のローカルPCで完結する。

`REQUIREMENTS.md` が実装の**唯一の信頼できる仕様**。コンセプト・スコープ・データモデル・API設計はすべて `REQUIREMENTS.md` を一次情報として参照すること。**方針転換があったら、コードより先に `REQUIREMENTS.md` を直す**（そうしないと、次にこのリポジトリを触ったとき仕様書を根拠に元へ戻してしまう）。

**いま何が動いているかは `docs/AS-BUILT.md`（実装仕様書）にまとまっている** — モジュール地図・API契約・定数の実値・検証手段・実測で確定した挙動。仕様（何を作るか）は `REQUIREMENTS.md`、実装（何が動いているか）は `AS-BUILT.md`、進捗（どこまで進んだか）は下記のチケット、と役割を分ける。**方針転換は `REQUIREMENTS.md` → コード → `AS-BUILT.md` の順で直す。**

**実装の進捗は `docs/00-index.md` のチケット No. と各チケットの `## Todo` で管理する**。完了チケットの再実装や、未完チケットの先読み実装をしないこと。現状は下記「現在の実装状況」を参照。

**Phase 1（MVP・01〜13）・Phase 2（14〜19）・Phase 3（20〜23）はすべて実装完了。起票済みの未着手チケットは無い。** 新たな要件は新チケットとして `docs/` に追加してから着手する（先読み実装の禁止は継続）。18・19・22 は実プレイでの詰め（発話間隔・返事待ち時間の値）が Todo に残っている。

### 企画の核（14・16・20・22 で方針転換した。古い前提で判断しないこと）

- **ネタバレはしてよい**（14 で禁止を撤廃）。「一緒に初見で驚く」より「誰かと一緒にやっている実感」を優先する。
- **攻略アドバイスはしない**（維持。これだけは一貫して強い制約）。線引きは **「事実は語る、手順は言わない」**。「あの剣士はナバール。実は仲間になる」＝OK ／「シーダで話しかけて」＝NG。
- **参照サイトからの取得はしてよい**（16 で禁止を撤廃）。ただし `/knowledge` での**名簿化のための一度きりの取得**に限る。散文（攻略手順）は捨て、目視確認してから保存する。実況ループからは取得しない。攻略ナレッジの大量注入と RAG は引き続き禁止。
- **ゲームは差し替え可能**（20/21 で「FC版FE専用」を撤廃・**実装済み**）。`knowledge/<slug>/` に `game.json` と `primer.md` を置けばゲームが増える（**`src/` を1行も触らない**）。**その2ファイルは `/knowledge` から生成できる**（23・**実装済み**。タイトル・機種・発売時期＋URL → primer の下書き → 目視確認・手直し → 保存）。**下書きは「確認済み」ではない**——LLM は版を取り違えても静かに間違う。`⚠️要確認` は開発者が一次情報で裏取りする。**FC版FE は引き続き第一の題材**で、汎用化で FE の作り込み（ロストを悼む・命中に一喜一憂）を薄めない——それらはゲーム固有の層（プライマー）に置く。汎用化を口実に攻略ナレッジを積まないこと。
- **AIから質問してよい**（22・**実装済み**）。ターンは **実況／雑談／質問／切り上げ** の4種（`turnKind`）。質問は**答えなくても成立する軽い投げかけ**で、返事が無ければ 90秒で自分から切り上げる（黙り込ませない）。**禁じるのは「質問の形をした手順誘導」**（「シーダで話しかけてみたら?」）と、催促・蒸し返し。あいきょうの「厳格な1問1答」には戻さない。

### 未確認・宿題

- 章キャスト表は第1〜25章まで `/knowledge` から生成・目視確認・保存済み（`knowledge/fe-fc/chapters/chapter-01.md` 〜 `chapter-25.md`）。AI は画面に名前が出ていれば、その章の1ファイルと照合して固有名を特定できる。
- **2本目のゲームは未定**（本採用のものは無い）。ただし汎用化は**実ゲームで一度通した**——23 の検証で『スーパーマリオブラザーズ』（FC・1985／章もロストも無い）を `/knowledge` から登録し、そのまま実況が成立することを確認した（検証後に削除済み）。
- **実プレイでの値の詰めが残っている**：発話間隔（30〜60秒）・返事待ち（90秒）・質問確率（0.3）。返事待ちは**そのまま動画の無音**になるので、実際に撮ってみて詰める。
- 実機での通し確認（OBS仮想カメラ→自動実況→読み上げ→録画モード→STT、質問と返事待ち）は開発者の手動確認に委ねる。

## 開発チケットと Todo 運用

`REQUIREMENTS.md` を機能単位に分割したチケットが `docs/` 配下にある（連番付き）。索引は `docs/00-index.md`。実装時は該当チケットを開き、その `## Todo` を進捗管理に使う。

- **Todo の更新ルール**：完了したタスクは `- [ ]` を **`- [×]`** に書き換える（未完は `- [ ]` のまま）。チェックを付けたら、そのチケット自体やコミットで進捗が分かるようにする。
- 1チケットを進めるときは、まず依存チケット（各ファイルの「依存」欄）が満たされているか確認する。
- チケットに無い機能は作らない（先読み実装の禁止＝`REQUIREMENTS.md §5.2 / §12`）。新たな要件が出たら新チケットを `docs/` に追加してから着手する。

## コマンド

```bash
npm run dev     # 開発サーバ（Turbopack）
npm run build   # 本番ビルド（Turbopack）
npm run start   # ビルド済みを起動
npm run lint    # ESLint（next/core-web-vitals + next/typescript）
```

テストフレームワークはまだ導入されていない。純粋なサーバ側ロジック（`prompt.ts` / `sentence.ts` / `knowledge-extract.ts` 等・型のみ import のもの）は `node --experimental-strip-types <file>.mts` で実モジュールを直接実行して検証してきた。API Route（`/api/narrate` / `/api/tts` / `/api/end-session` / `/api/knowledge/*`）は `npm run dev` 起動後に `curl` で疎通・異常系を確認。DB 周りは Supabase MCP（`execute_sql` 等）で実機確認。ブラウザ依存は開発者が手動確認（映像取り込み・自動ループ・自発発話は `/capture-test`、読み上げは `/tts-test`、セッション統合・録画モード・STT は `/session/[id]`、キャスト表生成は `/knowledge`。STT は Web Speech のため Chrome 系のみ）。

- `@google/genai` 等の依存を使う検証スクリプトは、**プロジェクト直下に置いて実行する**（scratchpad からだと `node_modules` を解決できない）。実行後に消すこと。
- 発話の間隔・返事待ちを待たずに確認したいときは `SPEAK_INTERVAL_MIN_MS` / `SPEAK_INTERVAL_MAX_MS` / `QUESTION_ANSWER_TIMEOUT_MS` / `QUESTION_TURN_PROBABILITY` を**一時的に**下げる（22 の検証では 8〜10秒 / 20秒 / 1.0 にした）。`/capture-test` のログには `turnKind` が出る。**確認したら必ず本来の値に戻す。**
- ブラウザ依存（映像取り込み・自動ループ・読み上げ・返事待ち）を**無人で駆動する手順は `.claude/skills/verify/SKILL.md`** にある（Playwright の偽カメラ・観測窓・A/Bの取り方）。タイミング系を触ったら実際に走らせて確かめる。**観測窓は `page.on("request")` で拾う `/api/narrate` の `turnKind` と発火時刻**が一番素直。
- DB を書き換える検証は、ダミー行を作って試し、**必ず消す**。`WHERE` 無しの `UPDATE`/`DELETE` は実行しない。**ダミーのゲーム定義（`knowledge/zz-*/`）を置いたときも同じく必ず消す。**

> **注意**: `npm run dev` 起動中に `npm run build` を実行すると `.next` が壊れて実行中の dev サーバが 500 を返す。build する時は dev を止めてから。検証用の一時 JPEG が要るとき（narrate の curl 等）は Pillow/ImageMagick が無い環境では `curl https://picsum.photos/256.jpg` で取得できる（1x1 の極小 JPEG は Gemini が "Unable to process image" で弾く）。

## 技術スタック

- **Next.js 15（App Router）+ React 19 + TypeScript（strict）**、Tailwind CSS v3.4。`@/*` は `src/*` にエイリアス。
- **DB**: Supabase（`@supabase/supabase-js`・RLS/認証なし・ローカル単一ユーザー）。導入済み。専用プロジェクト `tomoni`（ref `enwzuxfufsnvghivcyut`・ap-northeast-1）。スキーマは `supabase/migrations/0001_init.sql` と `0002_add_game.sql`（`playthroughs.game` = 知識ディレクトリの slug・既定 `'fe-fc'`）。接続情報は `.env.local`（`SUPABASE_URL` / `SUPABASE_ANON_KEY`・git 管理外）。
- **AI**: Google Gen AI SDK（`@google/genai`）。画面実況（Vision・主役）は `gemini-2.5-flash`、state 更新と章キャスト表の抽出は `gemini-2.5-flash-lite`。`thinkingConfig.thinkingBudget: 0`（テンポ優先）、`safetySettings` 全カテゴリ `BLOCK_NONE`（戦闘・戦死で空応答にならないため）。一時エラーは `withRetry`（指数バックオフ・既定3回／500ms 起点）。**既定は 503 の高負荷スパイクに耐えられない**ので、章抽出だけ 5回／2秒起点に上げてある（`KNOWLEDGE_EXTRACT_RETRIES`）。
- **音声合成**: Google Cloud Text-to-Speech を REST 直叩き（Chirp3-HD ボイス）。
- **APIキーはすべてサーバ専用**。`GEMINI_API_KEY` / `GOOGLE_TTS_API_KEY` を使い、`NEXT_PUBLIC_` を絶対に付けない。キーを読む `src/lib/env.ts`（および `supabase.ts` / `gemini.ts`）は `server-only` 付きで、クライアントコンポーネントから import するとビルドで失敗する。

## アーキテクチャの核（実装時の全体像）

「フレーム取得 → 送信 → 生成 → 読み上げ」のループが本体。

1. **画面取り込み（新規・本体）**: OBSバーチャルカメラを `getUserMedia` で偽カメラとして受け取り `<video>` にプレビュー。映像ソース取り込みは**差し替え可能な1モジュール**として抽象化する（将来 `getDisplayMedia` も足せるように）。
2. **自動実況ループ**: `<video>` の現フレームを canvas → JPEG(base64) 化、**長辺512px程度にダウンスケール**して Gemini に送る。**送るかどうかは時間だけで決まる**（19）。前回の発話開始から `SPEAK_INTERVAL_MIN_MS`〜`SPEAK_INTERVAL_MAX_MS` の**乱数間隔**が経ったら喋る。ピクセル差分は**「実況させるか雑談させるか」の出し分け専用**で、テンポには効かない。**質問したあとは返事を待って黙る**（22・関門④）。間隔・しきい値は調整可能な定数に。直近のAI発言を数件メモリ保持し「繰り返さない」よう渡す。
3. **実況API `POST /api/narrate`（ストリーミング）**: 入力 `{ playthroughId, imageBase64, recentLines, userMessage?, turnKind? }`。サーバで state(任意)＋persona＋**そのゲームのプライマー**＋直近発言からシステムプロンプトを組み、画像1枚＋ターン指示を Gemini(Vision) へ。`generateContentStream` の `chunk.text` を `ReadableStream` で返す。
4. **TTS `/api/tts`**: Cloud TTS REST → base64 mp3。クライアントは文末確定ごとに逐次再生キュー（`useTts`）へ流す。
5. **録画モードUI**: 会話以外を隠し全幅化・文字サイズ切替（OBS録画前提）。

### 知識ファイル `knowledge/<slug>/`（攻略データではない・ゲーム1本＝ディレクトリ1つ）

AIの**感情・反応を正しくする前提**と**今この章に誰がいるか**の最小限。**ゲームを足すためにコードを書かない**（20/21）:
- `knowledge/<slug>/game.json` — ゲーム定義。**呼び方だけ**（`title` / `version` / `progressLabel` /`progressPlaceholder` / `lostLabel`）＋任意の `knowledgeBuilder`（`/knowledge` の抽出設定・21）。**AIの振る舞いも、ゲームの前提も書かない。**
- `knowledge/<slug>/primer.md` — プライマー1枚。システムプロンプト先頭に固定。**そのゲームの前提だけ**。
- `knowledge/<slug>/chapters/chapter-XX.md` — 章ごとのキャスト表（ゼロ埋め番号・任意）。`state.chapter` に対応する**1ファイルだけ**注入する（全章一括注入はトークン肥大）。番号で引くだけの最小リトリーバル。ローダーは `src/lib/games.ts`（`loadGameDef` / `listGames` / `gameDir`）と `src/lib/knowledge.ts`（`loadPrimer(game)` / `loadChapterCast(game, chapter)`）。作り方は `knowledge/fe-fc/README.md`。**FE は第1〜25章を生成・保存済み**。
  - 自軍は第1章からの**累積**（その時点で画面にいる全員が要るため）。敵はその章だけ。**どのグループを累積するかは `game.json` が決める**（21）。
  - 章という単位を持たないゲームは `chapters/` を作らなくてよい（未注入で続行する）。**`state` のキーは `chapter` のまま**で、差し替えるのは呼び方だけ（jsonb の移行を避けるため）。
  - **中身が空のテンプレを置かない。** `buildSystemPrompt` は非空なら注入するので、プレースホルダがそのままキャスト表としてAIに渡る（実際にそうなっていたので削除した）。ファイルが無ければ丸ごとスキップされる＝無いほうが正しい。
  - **パスの組み立ては `gameDir(slug)` を必ず通す**（`[a-z0-9-]+` を検証する唯一の入口）。

データモデル（Supabase `playthroughs` / 緩い `state` jsonb / 任意の `messages`）は `REQUIREMENTS.md §9` 参照。

### 現在の実装状況（モジュール地図）

完了チケット 01〜22（残るは 23 のみ）。各モジュールは他チケットから `@/lib/*` 等で再利用する（再発明しない）。

- **基盤（01）**: `src/lib/env.ts`（サーバ専用キーの遅延検証アクセサ）・`src/lib/config.ts`（調整可能な定数を一元管理）・`src/lib/retry.ts`（`withRetry`・指数バックオフ）・`src/lib/types.ts`（`State`/`Persona`/`Playthrough`/`Message`/`NarrateRequest`/`TurnKind`/`GameDef`/`KnowledgeBuilderDef`）。
- **データ層（02）**: `src/lib/supabase.ts`（`server-only` クライアント）・`src/lib/playthroughs.ts`（CRUD＋`state` 部分更新）・`src/lib/persona.ts`（`DEFAULT_PERSONA`）。
- **映像取り込み（03）**: `src/lib/video/types.ts`（`VideoSource` 抽象）・`src/lib/video/userMediaSource.ts`（`getUserMedia` 実装）・`src/components/VideoPreview.tsx`（`'use client'` プレビュー・`onVideoElement`/`onStreamChange` で親へ受け渡し）。**コールバック props は親が `useCallback` の安定参照で渡す**（インライン関数だと、ストリーミング中のチャンク毎再レンダーで `<video>` の callback ref が付け外しされ続ける）。
- **自動実況ループ（04・15・18・19・22）**: `src/lib/video/frame.ts`（`captureFrame`／`signatureDiff`）・`src/lib/turn.ts`（`pickTurnKind`／`looksLikeQuestion`・**純関数**。乱数は引数で注入するのでブラウザ抜きで検証できる）・`src/hooks/useAutoNarration.ts`（間隔ループ・多重送信抑止・手動トリガー・`recentLines` 保持。送信は `onSend: (p: SendPayload) => Promise<string | void>` で注入。**確定した発言を返す**＝質問で終わったかの判定に使う。`SendPayload` は `{ imageBase64, recentLines, userMessage?, turnKind }`）。tick の関門は**4つ**で、順に **①生成中(`busyRef`) → ②`canSpeak()`（読み上げ中でない・18） → ④返事待ちでない（22） → ③時間（前回発話から `gapRef` の乱数間隔が経過・19）**。抜けたら必ず送る。**何を喋るかは `pickTurnKind` が決める**（話しかけ優先／確率0.3で質問・ただし直前の発言が `?` で終わっていたら抽選しない／外れたら差分で実況・雑談。差分はここにしか効かない。テンポの門番にすると取り込みノイズとカーソル点滅で喋り出す＝実測）。乱数間隔は `send()` 内の `rollGap()` で毎回引き直す（唯一の送信集約点なので手動・STT の直後もループが被せてこない）。`canSpeak` は SessionClient が `!tts.speaking && tts.queueLength === 0` を渡す。**`triggerNow`（手動・STT）には②③④を掛けず、返事待ちも解除する**（自分で押したのに黙るのは故障に見える）。**返事待ちの計測は「質問の読み上げが終わってから」**（読み上げ中から計ると長い質問ほど待ちが短くなる）。タイムアウトで `turnKind: 'giveup'` を1回だけ送り通常ループへ戻る＝**黙り込ませない**。
- **知識／ゲーム定義（05・20・21）**: 上記 `knowledge/<slug>/` と `src/lib/games.ts`（`loadGameDef` / `listGames` / `gameDir` / `isValidGameSlug`）・`src/lib/knowledge.ts`（`loadPrimer(game)` / `loadChapterCast(game, chapter)` / `chapterToNumber`）。
- **プロンプト（06・14）**: `src/lib/prompt.ts`（`buildSystemPrompt`・純関数。プライマー先頭固定＋厳守事項＋動的文脈）。**システムプロンプトは2層**——`prompt.ts` は**「戦友としてどう振る舞うか」だけ**（ゲームが変わっても変わらない層）、`knowledge/<game>/primer.md` は**「そのゲームは何か」だけ**（版の同定・何に感情が動くか・何が「手順」にあたるか・画面認識上の固有事情）。**ゲーム固有の指示を `prompt.ts` に書かない／振る舞いの指示をプライマーに書かない。** 重複させると後から注入された方が先を打ち消す。**発話長の指示は `prompt.ts` の1行だけに置く**（`persona.tone`・Route に重複させない）。**そのターンで何をするか（実況／雑談／質問／切り上げ）のモード選択はここに書かない**（`route.ts` の4定数が持つ）。進捗・ロストの**ラベルは `game.json` から差す**（`gameDef` 引数。FE語彙を直書きしない）。**`prompt.ts` は値を import しない**（型のみ）——`node --experimental-strip-types` で直接実行して検証できる状態を保つため。
- **実況API（07・20・22）**: `src/lib/gemini.ts`（`server-only` の遅延クライアント `getGeminiClient`＋全カテゴリ `BLOCK_NONE` の `SAFETY_SETTINGS_BLOCK_NONE`。07/12 で共有）・`src/app/api/narrate/route.ts`（入力検証→playthrough取得→**その `game`** の知識読込→06でプロンプト→`gemini-2.5-flash` の `generateContentStream` を `ReadableStream` で返す。確立のみ `withRetry`、開始前エラーは `{ error }` JSON）。**そのターンで何をさせるかは、画像に隣接する `TURN_TEXT` の4定数だけが決める**（`turnKind` で出し分け。未知の値は 400。`userMessage` があれば `turnKind` を無視して応答を優先）。`@google/genai` 導入済み。
- **TTS（08・22）**: `src/lib/sentence.ts`（`takeSentences`・純関数の文末分割）・`src/app/api/tts/route.ts`（Cloud TTS REST 直叩き→`{ audioBase64 }`・`withRetry`・`{ error }` JSON）・`src/hooks/useTts.ts`（`'use client'`・`feed`/`flush`/`reset`＋1文先読みパイプライン再生キュー・ON/OFF・ボイス選択）。**`stopAndClear` は再生中の Promise を明示解決し、世代番号を進める**（22 で直したバグ。下記「落とし穴」参照）。ボイス候補は `config.ts` の `TTS_VOICES`。
- **トップ（09・17・20）**: `src/app/page.tsx`（`force-dynamic` の Server Component・`listPlaythroughs` と `listGames` で一覧・各項目から `/session/[id]` へ・末尾に `/knowledge` への導線）・`src/app/NewPlaythroughForm.tsx`（`'use client'`・`useActionState`・**ゲーム選択**＝選ぶとタイトル/バージョンの既定値が入る。Server Action は `game.json` の無い slug を弾く）・`src/app/DeletePlaythroughButton.tsx`（`'use client'`・`window.confirm` で確認）・`src/app/actions.ts`（`'use server'` の `createPlaythroughAction` / `deletePlaythroughAction`・入力検証＋`revalidatePath('/')`）。削除時 `messages` は DB の `on delete cascade` で消える（アプリ側で消さない）。
- **セッション画面（10）+ 録画モード（11）**: `src/app/session/[id]/page.tsx`（Server Component・`params` を `await`・`getPlaythrough`→無ければ `notFound()`）・`src/app/session/[id]/SessionClient.tsx`（`'use client'` 統合本体。VideoPreview＋useAutoNarration＋useTts を配線。`onSend` で `/api/narrate` をストリーム fetch→逐次表示＋`useTts.feed`、直近発言を保持・表示。onSend↔addRecentLine の循環は ref で解消）。**MVP完成条件（取り込み→自動実況→読み上げ）がこの画面で通る。** 録画モードは同ファイル内の `fixed inset-0` 全画面オーバーレイ（単色背景に AI発言＝`currentText` だけ中央大表示・文字サイズ段階 `RECORDING_FONT_STEPS`・Esc/終了で解除・ループは止めない）。
- **state更新／継続性（12）**: `src/app/api/end-session/route.ts`（`POST`・実況ログを `gemini-2.5-flash-lite` で構造化JSON要約→`last_session_summary`/`progress` を生成、`chapter` は手入力を反映、`updatePlaythroughState` で jsonb マージ）。SessionClient に「セッション終了して保存」UI（到達章入力＋保存・`sessionLinesRef` で全発言保持）。再開時は `buildStateLines` が `last_session_summary` を「前回までのあらすじ」として注入（配線済み）。
- **STT／音声で話しかける（13・任意）**: `src/hooks/useSpeechRecognition.ts`（`'use client'`・Web Speech の最小ラッパ・非対応時 `supported=false`）。SessionClient で「押して話す」→認識テキストを `useAutoNarration.triggerNow(userMessage)` 経由で送信。`/api/narrate` は `userMessage`（任意）を受け、`buildSystemPrompt` が「プレイヤーからの話しかけ」セクションとして注入する。
- **ゲーム登録（23）**: `src/lib/primer-render.ts`（純関数のみ・`renderPrimerMarkdown`。構造化JSON → §8.1 の体裁。**`⚠️要確認` を付けるのもここ**＝LLM に記号も Markdown も書かせない。**型のみ import** を崩さないこと）・`src/app/api/knowledge/register/route.ts`（`{ title, platform, releasedAt, urls }` → 取得（文字コード判定は 16 と共通・本文は `KNOWLEDGE_PRIMER_MAX_TEXT_CHARS`）→ **`gemini-2.5-flash`・思考ON**で構造化JSON → 整形して返す。**ファイルは書かない**。**思考を切らないのはここだけ**——一度きりの生成で、外すと版の取り違えが動画に出る）・`src/app/knowledge/GameRegisterClient.tsx`（2段入力 → 下書き → 編集 → 保存）。`/api/knowledge/save` は `kind` で `chapters` / `game` を分ける。**存在チェックの向きが逆**なのが要点——章保存は「実在するゲームにしか書かない」（404）、ゲーム登録は「既にあれば止める」（409・`overwrite` で明示解除＝`fe-fc` を事故で潰さない）。**`game.json` はサーバ側で組み立てる**（クライアントに生JSONを書かせない）。`knowledgeBuilder` は生成しない（必要なゲームだけ後から手で足す）。
- **章キャスト表の生成（16・21）**: `src/lib/knowledge-extract.ts`（純関数のみ・`detectCharset`/`decodeHtml`/`htmlToText`/`splitChapters(text, heading)`/`accumulateGroups`/`renderChapterMarkdown`。`node --experimental-strip-types` で直接検証できる＝**型のみ import** を崩さないこと）・`src/app/api/knowledge/extract/route.ts`（`{ game, urls }` → URL取得→章分割→章ごとに `gemini-2.5-flash-lite` で**構造化JSONだけ**抽出。整形は純関数。**ファイルは書かない**）・`src/app/api/knowledge/save/route.ts`（目視確認後に書き出す。**リポジトリ内で唯一の `writeFile`**。slug は `gameDir` が検証し、ゲーム定義が実在しなければ 404。ファイル名は章番号からサーバ側で組み立てる）・`src/app/knowledge/`（`/knowledge` ページ・ゲーム選択つき）。**抽出の形（章見出し・グループ・累積・列・同定文）は `game.json` の `knowledgeBuilder` が決める**（21）。持たないゲームは 422＋UIで無効化＝**汎用の抽出器を作らない**（「どんなゲームの表も読める1つの賢いスキーマ」は存在しない）。落とし穴は `docs/16-knowledge-builder.md` の「実装時に分かったこと」を読むこと（セル区切り・`required`/`propertyOrdering`・職業で敵味方を判断させない・1章の失敗で全滅させない）。
- **暫定確認ページ**: `/capture-test`（`src/app/capture-test/`）は 03/04、`/tts-test`（`src/app/tts-test/`）は 08 の手動確認用ハーネス。`/knowledge`（`src/app/knowledge/`）は一度きりの道具2つ（**① ゲーム登録**＝23、**② 章キャスト表**＝16/21）。いずれも実況ループから独立した切り分けツールとして**残す**。

### 落とし穴（実測で踏んだ。同じ穴を掘らないこと）

- **同じ趣旨の指示を2箇所に書かない。** 発話長が `prompt.ts` / プライマー / `persona.tone` / `narrate route` の4箇所に散っており、**後から注入された方が先を打ち消していた**（`persona.tone` は厳守リストの末尾に入る）。1箇所に集約する。
- **`primer.md` はシステムプロンプトの先頭に固定注入される。** ここに禁止指示が残っていると、`prompt.ts` を何度書き換えても挙動は変わらない。
- **ターン指示は具体的に書かないと独り言になる（22 で実測）。** 「プレイヤーに問いかけて」だけでは「どんな戦いが待っているんだろう？」という修辞疑問が返る。**「プレイヤー本人に向けて聞く／独り言にしない」と明示する。**
- **`persona` は作成時に DB へコピーされる**（`playthroughs.ts`）。`DEFAULT_PERSONA` を直しても既存プレイスルーには届かない。SQL で更新する。
- **`responseSchema` の任意フィールドはモデルが黙って省略する。** 指示文で「埋めろ」と書いても無駄。`required` と `propertyOrdering` を明示する（`hp` / `items` が丸ごと落ちた）。読めなかったぶんは 0 / 空配列で返させ、整形側で落とす。
- **HTML の `</td>` を改行にすると表が壊れる。** 1行が縦に散らばり、LLM が列を対応づけられない。セルは `|`、行は改行。
- **多数の LLM 呼び出しを `Promise.all` で束ねない。** 1件の 503 で全滅する。失敗は個別に握って呼び出し側へ返す。
- **`withRetry` の既定（3回・500ms 起点＝1.5秒）は 503 に耐えられない。** 数十秒の高負荷スパイクには 5回・2秒起点で粘る。
- **LLM に Markdown を書かせない。** 構造化JSONだけ返させ、体裁は純関数で組む（体裁ブレとプロンプト注入の余地を消す）。
- **ピクセル差分をテンポの門番にしない（19）。** 実映像は OBS の取り込み・スケーリング・JPEG圧縮で常時揺れており、**カーソルの点滅だけで `FRAME_DIFF_THRESHOLD` を超える**。机上では「1マス移動＝画面の0.45%＝届かない」はずだったが、ノイズが底上げしていた。しきい値を上げても、ノイズと小さな本物の変化は同じ大きさなので分離できない。**「いつ喋るか」は時間で決め、差分は「実況か雑談か」の出し分けにだけ使う。**
- **`pause()` では `ended` も `error` も発火しない（22 で実測）。** `useTts` の `stopAndClear` が再生を止めても、`playBase64` の Promise を待っているポンプが抜けられず、**`speaking` が真のまま張り付いて関門②が二度と開かない**＝AIが黙り込む。読み上げ中に手動トリガー／STT で割り込むと踏む（22 の返事待ちは、この割り込みを通常の流れにする）。中断時は**再生 Promise を明示的に解決する**こと。あわせて世代番号を進め、reset 前に先読みしていた音声が新しい発言のあとから鳴り出すのも防ぐ。
- **新しい発言を始めると前の発言が死ぬ（18）。** `onSend` 冒頭の `tts.reset()` が再生中の音声とキューを破棄する。読み上げ中は自動ループの発話を始めない（`canSpeak`）。「発話を開始してよいか」の判断は、読み上げキューを持つ側（SessionClient）にしか下せない。
- **ブラウザ依存の変更は実際に走らせて確かめる。** `.claude/skills/verify/SKILL.md` に無人駆動の手順がある。タイミング系は **`git stash` で変更前と A/B を取る**（「直った」より先に「壊れていたことを検出できるハーネスだ」と示す）。`--autoplay-policy=no-user-gesture-required` を忘れると mp3 が再生されず、**読み上げが一瞬で終わったように見えて誤判定する**。

## Next.js 15（App Router）ベストプラクティス

本プロジェクトは Next.js 15.5.x の App Router。15 系の挙動変更を踏まえて実装する（出典: context7 `/vercel/next.js` v15.x ドキュメント）。

### Server / Client コンポーネントの分離

- **既定は Server Component**。データ取得・APIキーを使う処理・重い依存はサーバ側に置き、クライアントバンドルとAPIキー露出を減らす。`GEMINI_API_KEY` / `GOOGLE_TTS_API_KEY` を読むコードは必ずサーバ（Route Handler / Server Component / Server Action）に置く。
- `'use client'` は**末端の対話的UIに限定**する（カメラ選択・録画モード切替・ストリーミング表示・TTS再生キューなど Web API/状態を使う部分）。ページ全体を Client にしない。`getUserMedia`・`canvas`・`Web Speech` はクライアント専用。
- Server Component は `async` 関数にして `await` でデータ取得してよい。Client Component に渡す props はシリアライズ可能な値のみ。

### 非同期リクエストAPI（15 の破壊的変更・必ず `await`）

`cookies()` / `headers()` / `draftMode()`、および `page.js`/`layout.js`/`route.js` の `params`・`searchParams` は **15 で非同期化**された。必ず `await` する。

```tsx
// Route Handler / Page
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}
```

### キャッシュ（15 の既定変更）

15 では「既定でキャッシュしない」方向に変わった。本プロジェクトは画面・状態が常に動的なので、この既定がそのまま望ましい。

- **`fetch` は既定でキャッシュされない**（≒ `cache: 'no-store'`）。キャッシュしたいものだけ `{ cache: 'force-cache' }` か `{ next: { revalidate: N } }` で明示的にオプトインする。
- **Route Handler の `GET` も既定で非キャッシュ**。静的化したい場合のみ `export const dynamic = 'force-static'`。`/api/narrate`・`/api/tts` は毎回動的でよいので何もしない。

### Route Handlers / Server Actions

- 画像→Gemini、テキスト→TTS のような**外部API呼び出しは Route Handler**（`src/app/api/*/route.ts`）に置き、ストリーミングは `ReadableStream` を返す（`/api/narrate`）。
- フォーム送信・state更新など mutation は **Server Action** も選択肢。利用する場合は**呼び出し元の認可・入力検証を必ず行う**（Server Action は公開エンドポイントとして扱う）。本プロジェクトはローカル単一ユーザーだが、入力検証はする。

### ストリーミングと Suspense

- 動的データに依存する部分は `<Suspense fallback={...}>` で囲み、シェルを先に表示する。`cookies()`/`headers()` を使うコンポーネントは Suspense 境界の内側に置く（プリレンダリング時のエラー回避）。

### その他

- 画像は `next/image` を使う（プレビューの `<video>` は対象外）。
- 設定値（自動間隔・変化しきい値・ダウンスケールサイズ）は定数に切り出し、`src/` 配下で一元管理する。

## 強い制約（必読・これらに反する実装をしない）

これは「戦友であって攻略先生ではない」という企画の核であり、`REQUIREMENTS.md §5.2 / §12` の「やらないこと」は**強い制約**:

- ❌ **攻略アドバイス／最適手の指示**をしない（聞かれても一緒に悩む側）。**加入条件を満たす操作手順**（誰で話しかける等）も含む。
- ✅ **ネタバレはしてよい**（チケット14で解禁）。先の展開・人物の運命を自分から語ってよい。線引きは **「事実は語る、手順は言わない」**。「あの剣士はナバール。実は仲間になる」＝OK／「シーダで話しかけて」＝NG。
- ❌ 攻略ナレッジの大量注入・RAG/埋め込み検索をしない。（参照サイトからの取得はチケット16で解禁。ただし `/knowledge` での**名簿化のための一度きりの取得**に限り、散文＝攻略手順は捨て、目視確認してから保存する。実況ループからは取得しない。）
- ✅ **ゲームの差し替えはしてよい**（チケット20/21で「FC版FE専用」を撤廃）。ただし**ゲームを足すためにコードを書かない**（`knowledge/<slug>/` にファイルを置くだけ）。ゲーム固有の分岐を `src/` に散らかさない。「どんなゲームの表も読める1つの賢い抽出器」も作らない（宣言できるゲームだけ `knowledgeBuilder` を書く）。
- ✅ **AIから質問してよい**（チケット22）。ただし**答えを強要しない**（催促・蒸し返しをしない・タイムアウトで自分から切り上げる）。**質問の形をした手順誘導は攻略アドバイスとして引き続き禁止**（「シーダで話しかけてみたら?」）。聞いてよいのは感想・思い出・気持ち・プレイヤー自身の選択。
- ❌ 認証・マルチユーザー・デプロイ・公開。
- ❌ 秒単位の高速実況（技術的に不可。数秒のラグ前提で「場面が変わったら語る」程度）。
- ❌ **先読み実装をしない**。`REQUIREMENTS.md` に書いていない機能は作らない。MVPが動いてから別途要件を切る。

### AI挙動の固有名ルール（重要）

レトロゲームのドット絵では見た目で個人を判別できない（FC版FEはその典型）。**画面に名前・ステータス等の文字が出ていない限り、特定のキャラ名を断定させない**（「自軍のユニット」「敵」と呼ぶ）。文字が出ている画面でのみキャスト表と照合して特定する。**これは「いま画面に映っているユニットが誰か」の制約であり、物語を語るときに人物名を挙げること（＝ネタバレ）は妨げない。**

この原則は**ゲーム非依存なので `prompt.ts`**（振る舞いの層）にある。「FC版（1990・暗黒竜と光の剣）の前提で語り、後発作品の要素を混ぜない」といった**版の同定はゲーム固有なので `primer.md`**（ゲームの層）にある。**どちらか片方にだけ書く**（両方に書くと打ち消し合う）。
