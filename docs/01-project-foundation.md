# 01 プロジェクト基盤・環境変数

## 概要

後続チケットの土台。環境変数の読み込み、`src/` のディレクトリ構成、調整可能な共通定数、共通ユーティリティ（`withRetry`）を整える。

関連: `REQUIREMENTS.md §3, §6.2, §11` / `CLAUDE.md`

## Todo

- [ ] `.env.local` の雛形（`.env.example`）を用意（`GEMINI_API_KEY`・`GOOGLE_TTS_API_KEY`、Supabase接続情報）
- [ ] サーバ専用キーを型安全に読む `src/lib/env.ts`（`NEXT_PUBLIC_` を付けない／未設定時に明示エラー）
- [ ] ディレクトリ構成を作成（`src/lib`・`src/components`・`src/app/api`・`knowledge/fe-fc`）
- [ ] 調整可能な定数を `src/lib/config.ts` に集約（自動間隔・変化しきい値・ダウンスケール長辺px・直近発言保持件数・既定ボイス）
- [ ] `withRetry`（指数バックオフ・最大3回）を `src/lib/retry.ts` に実装
- [ ] 共通の型定義 `src/lib/types.ts`（`Playthrough`・`State`・`Persona`・`NarrateRequest` など最小）
- [ ] `npm run lint` / `npm run build` が通ることを確認

## 完了条件

- 環境変数がサーバ側からのみ読め、未設定時に分かりやすく失敗する。
- 共通定数・`withRetry`・型が他チケットから import できる。

## 注意

- APIキーは必ずサーバ専用。クライアントに渡さない。
- 定数はハードコードせず `config.ts` 経由にする（後で調整するため）。
