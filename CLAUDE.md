# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**ともに / Tomoni** — 苦手なシミュレーションRPGを、画面を見て実況・昔話・励ましをしてくれる「戦友AI」と一緒にクリアを目指す**自分専用ツール**。最終成果物は YouTube 動画で、アプリはその道具。題材は MVP では **ファミコン版『ファイアーエムブレム 暗黒竜と光の剣』（1990 / FE1）の1本特化**。認証・公開・デプロイは無く、開発者のローカルPCで完結する。

`REQUIREMENTS.md` が **Phase 1（MVP）の実装指示書**であり、実装の唯一の信頼できる仕様。コンセプト・スコープ・データモデル・API設計はすべて `REQUIREMENTS.md` を一次情報として参照すること。

**実装の進捗は `docs/00-index.md` のチケット No.（01〜13）と各チケットの `## Todo` で管理する**。完了チケットの再実装や、未完チケットの先読み実装をしないこと。現状は下記「現在の実装状況」を参照。

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

テストフレームワークはまだ導入されていない。純粋なサーバ側ロジック（`prompt.ts` / `sentence.ts` 等・型のみ import のもの）は `node --experimental-strip-types <file>.mts` で実モジュールを直接実行して検証してきた。API Route（`/api/narrate` / `/api/tts`）は `npm run dev` 起動後に `curl` で疎通・異常系を確認。DB 周りは Supabase MCP（`execute_sql` 等）で実機確認。ブラウザ依存は開発者が手動確認（映像取り込み・自動ループは `/capture-test`、読み上げは `/tts-test`）。

## 技術スタック

- **Next.js 15（App Router）+ React 19 + TypeScript（strict）**、Tailwind CSS v3.4。`@/*` は `src/*` にエイリアス。
- **DB**: Supabase（`@supabase/supabase-js`・RLS/認証なし・ローカル単一ユーザー）。導入済み。専用プロジェクト `tomoni`（ref `enwzuxfufsnvghivcyut`・ap-northeast-1）。スキーマは `supabase/migrations/0001_init.sql`。接続情報は `.env.local`（`SUPABASE_URL` / `SUPABASE_ANON_KEY`・git 管理外）。
- **AI**: Google Gen AI SDK（`@google/genai`）。画面実況（Vision・主役）は `gemini-2.5-flash`、任意の state 更新は `gemini-2.5-flash-lite`。`thinkingConfig.thinkingBudget: 0`（テンポ優先）、`safetySettings` 全カテゴリ `BLOCK_NONE`（戦闘・戦死で空応答にならないため）。一時エラーは `withRetry`（指数バックオフ・最大3回）。
- **音声合成**: Google Cloud Text-to-Speech を REST 直叩き（Chirp3-HD ボイス）。
- **APIキーはすべてサーバ専用**。`GEMINI_API_KEY` / `GOOGLE_TTS_API_KEY` を使い、`NEXT_PUBLIC_` を絶対に付けない。

## アーキテクチャの核（実装時の全体像）

「フレーム取得 → 送信 → 生成 → 読み上げ」のループが本体。

1. **画面取り込み（新規・本体）**: OBSバーチャルカメラを `getUserMedia` で偽カメラとして受け取り `<video>` にプレビュー。映像ソース取り込みは**差し替え可能な1モジュール**として抽象化する（将来 `getDisplayMedia` も足せるように）。
2. **自動実況ループ**: `<video>` の現フレームを canvas → JPEG(base64) 化、**長辺512px程度にダウンスケール**、前回送信フレームとのピクセル差分で**変化があったときだけ** Gemini に送る（SLGはターン制で静止しがち＝同じ発言の繰り返しとコストを同時に防ぐ）。間隔・しきい値は調整可能な定数に。直近のAI発言を数件メモリ保持し「繰り返さない」よう渡す。
3. **実況API `POST /api/narrate`（ストリーミング）**: 入力 `{ playthroughId, imageBase64, recentLines }`。サーバで state(任意)＋persona＋FEプライマー＋直近発言からシステムプロンプトを組み、画像1枚＋指示を Gemini(Vision) へ。`generateContentStream` の `chunk.text` を `ReadableStream` で返す。
4. **TTS `/api/tts`**: Cloud TTS REST → base64 mp3。クライアントは文末確定ごとに逐次再生キュー（`useTts`）へ流す。
5. **録画モードUI**: 会話以外を隠し全幅化・文字サイズ切替（OBS録画前提）。

### 知識ファイル `knowledge/fe-fc/`（攻略データではない）

AIの**感情・反応を正しくする前提**と**今この章に誰がいるか**の最小限。2階建て:
- `knowledge/fe-fc/fe-primer.md` — 全章共通プライマー1枚。システムプロンプト先頭に固定。
- `knowledge/fe-fc/chapters/chapter-XX.md` — 章ごとのキャスト表（ゼロ埋め番号）。`state.chapter` に対応する**1ファイルだけ**注入する（全章一括注入はネタバレ＆トークン肥大）。番号で引くだけの最小リトリーバル。ローダーは `src/lib/knowledge.ts`（`loadPrimer` / `loadChapterCast`）。作り方は `knowledge/fe-fc/README.md`（§8.4 スクショ→名簿化）。

データモデル（Supabase `playthroughs` / 緩い `state` jsonb / 任意の `messages`）は `REQUIREMENTS.md §9` 参照。

### 現在の実装状況（モジュール地図）

完了チケット 01〜09。各モジュールは他チケットから `@/lib/*` 等で再利用する（再発明しない）。

- **基盤（01）**: `src/lib/env.ts`（サーバ専用キーの遅延検証アクセサ）・`src/lib/config.ts`（調整可能な定数を一元管理）・`src/lib/retry.ts`（`withRetry`・指数バックオフ）・`src/lib/types.ts`（`State`/`Persona`/`Playthrough`/`Message`/`NarrateRequest`）。
- **データ層（02）**: `src/lib/supabase.ts`（`server-only` クライアント）・`src/lib/playthroughs.ts`（CRUD＋`state` 部分更新）・`src/lib/persona.ts`（`DEFAULT_PERSONA`）。
- **映像取り込み（03）**: `src/lib/video/types.ts`（`VideoSource` 抽象）・`src/lib/video/userMediaSource.ts`（`getUserMedia` 実装）・`src/components/VideoPreview.tsx`（`'use client'` プレビュー・`onVideoElement`/`onStreamChange` で親へ受け渡し）。
- **自動実況ループ（04）**: `src/lib/video/frame.ts`（`captureFrame`／`signatureDiff`）・`src/hooks/useAutoNarration.ts`（間隔ループ・変化検知ゲート・多重送信抑止・手動トリガー・`recentLines` 保持。送信は `onSend` で注入）。
- **知識（05）**: 上記 `knowledge/fe-fc/` と `src/lib/knowledge.ts`。
- **プロンプト（06）**: `src/lib/prompt.ts`（`buildSystemPrompt`・純関数。プライマー先頭固定＋厳守事項＋動的文脈）。
- **実況API（07）**: `src/lib/gemini.ts`（`server-only` の遅延クライアント `getGeminiClient`＋全カテゴリ `BLOCK_NONE` の `SAFETY_SETTINGS_BLOCK_NONE`。07/12 で共有）・`src/app/api/narrate/route.ts`（入力検証→state/persona取得→知識読込→06でプロンプト→`gemini-2.5-flash` の `generateContentStream` を `ReadableStream` で返す。確立のみ `withRetry`、開始前エラーは `{ error }` JSON）。`@google/genai` 導入済み。
- **TTS（08）**: `src/lib/sentence.ts`（`takeSentences`・純関数の文末分割）・`src/app/api/tts/route.ts`（Cloud TTS REST 直叩き→`{ audioBase64 }`・`withRetry`・`{ error }` JSON）・`src/hooks/useTts.ts`（`'use client'`・`feed`/`flush`/`reset`＋1文先読みパイプライン再生キュー・ON/OFF・ボイス選択）。ボイス候補は `config.ts` の `TTS_VOICES`。
- **トップ（09）**: `src/app/page.tsx`（`force-dynamic` の Server Component・`listPlaythroughs` で一覧・各項目から `/session/[id]` へ）・`src/app/NewPlaythroughForm.tsx`（`'use client'`・`useActionState`）・`src/app/actions.ts`（`'use server'` の `createPlaythroughAction`・入力検証＋`revalidatePath('/')`）。
- **暫定確認ページ**: `/capture-test`（`src/app/capture-test/`）は 03/04、`/tts-test`（`src/app/tts-test/`）は 08 の手動確認用ハーネス。**ticket 10/11 で本セッション画面に折り込む前提**の暫定物。
- 未着手: 10（セッション画面）・11（録画モード）・12/13（任意）。

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

- ❌ **攻略アドバイス／最適手の指示**をしない（聞かれても一緒に悩む側）。
- ❌ **ネタバレしない**（先の章の展開を先回りしない。キャスト表も「この後死ぬ/裏切る」等は書かない）。
- ❌ 攻略サイトのスクレイピング・攻略ナレッジ大量注入・RAG/埋め込み検索をしない。
- ❌ 複数ゲーム対応・ゲーム差し替えUI（FC版FE専用）。
- ❌ 認証・マルチユーザー・デプロイ・公開。
- ❌ 秒単位の高速実況（技術的に不可。数秒のラグ前提で「場面が変わったら語る」程度）。
- ❌ **先読み実装をしない**。`REQUIREMENTS.md` に書いていない機能は作らない。MVPが動いてから別途要件を切る。

### AI挙動の固有名ルール（重要）

FC版のドット絵では見た目で個人を判別できない。**画面に名前・ステータス等の文字が出ていない限り、特定のキャラ名を断定させない**（「自軍のユニット」「敵」と呼ぶ）。文字が出ている画面でのみキャスト表と照合して特定する。版は必ず **FC版（1990・暗黒竜と光の剣）**の前提で語らせ、後発作品（紋章の謎/聖戦/覚醒 等）の要素を混ぜない。
