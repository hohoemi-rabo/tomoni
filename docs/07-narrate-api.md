# 07 実況API `/api/narrate`（Gemini ストリーミング）

## 概要

画像1枚＋システムプロンプトを Gemini(Vision) に渡し、`generateContentStream` を `ReadableStream` で返す。本プロジェクトの主役API。

関連: `REQUIREMENTS.md §3, §7.1` / 依存: 02,05,06

## Todo

- [ ] `POST /api/narrate`（`src/app/api/narrate/route.ts`）を作成（毎回動的・キャッシュしない）
- [ ] 入力 `{ playthroughId, imageBase64, recentLines }` を検証
- [ ] `playthroughId` から `state`/`persona` を取得、プライマー＋現在章キャストを読み 06 でプロンプト組み立て
- [ ] `@google/genai` で `gemini-2.5-flash` を呼ぶ（Vision・画像1枚＋指示）
- [ ] `thinkingConfig.thinkingBudget: 0`、`safetySettings` 全カテゴリ `BLOCK_NONE`
- [ ] `generateContentStream` の `chunk.text` を `ReadableStream` で返す
- [ ] `withRetry`（指数バックオフ・最大3回）で一時エラーをリトライ
- [ ] エラーはクライアントに伝え画面表示できる形で返す

## 完了条件

- 画像を送るとストリーミングで実況テキストが返る。
- 一時エラーが自動再試行され、恒久エラーは画面に出る。

## 注意

- APIキーはサーバ専用。Route Handler 内でのみ使用。
- 画像はダウンスケール済み前提（04）。送信回数を絞ることがコスト対策。
