# 02 Supabase データモデル

## 概要

プレイスルーの永続化。RLS/認証なし・ローカル単一ユーザー前提。

関連: `REQUIREMENTS.md §3, §9` / 依存: 01

## Todo

- [×] Supabase クライアント `src/lib/supabase.ts`（サーバ用）を作成
- [×] `playthroughs` テーブル作成 SQL（`id uuid pk`・`title`・`game_version`・`state jsonb`・`persona jsonb`・`created_at`・`updated_at`）
- [×] `messages` テーブル（任意・動画ログ／ふりかえり用。継続性には使わない）
- [×] マイグレーション/セットアップ手順を `docs` か SQL ファイルに残す（`supabase/migrations/0001_init.sql`・新規 `tomoni` プロジェクト ref `enwzuxfufsnvghivcyut` に MCP で適用済み）
- [×] `state` の緩いスキーマを型化（`chapter`・`lost_units[]`・`progress`・`last_session_summary`）— ticket 01 の `src/lib/types.ts` に定義済み
- [×] CRUD ヘルパー（取得・作成・`state`更新）を `src/lib/playthroughs.ts` に
- [×] 既定 `persona`（戦友のキャラ設定）の初期値を定義（`src/lib/persona.ts`）

## 完了条件

- プレイスルーを作成・取得でき、`state` を部分更新できる。
- 認証・RLSを入れていない（ローカル前提）。

## 注意

- `state` が無くても実況は成立する（現在状況は画面から読む）。継続性は付加価値。
- `messages` は継続性に使わない（あくまでログ）。
