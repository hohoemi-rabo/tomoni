# 17 冒険（プレイスルー）の削除

## 概要

トップの「これまでの冒険」に削除手段が無い。試し撮りや失敗したセッションが一覧に残り続ける。各項目から削除できるようにする。

**取り消せない操作**なので、確認を挟む。`state.last_session_summary`（前回までのあらすじ）と `state.progress` も一緒に消える＝そのプレイスルーの継続性は戻らない。

関連: `REQUIREMENTS.md §9, §10` / 依存: 02, 09

## Todo

- [×] `src/lib/playthroughs.ts` に `deletePlaythrough(id)` を追加（`withRetry`・エラーは throw）
- [×] `src/app/actions.ts` に `deletePlaythroughAction`（`'use server'`）。**id を UUID として検証**してから削除し、`revalidatePath('/')`
- [×] トップの各項目に削除ボタン（`src/app/DeletePlaythroughButton.tsx`）。押すと**確認ダイアログ**にタイトルを出し、承諾したときだけ送信する
- [×] 失敗時はエラーを画面に出す（握りつぶさない）
- [×] `REQUIREMENTS.md §10` の「トップ」に削除を追記

## 完了条件

- [×] 紐づく `messages` も残らない（ダミー1件で cascade を実測）。
- [×] 一覧から冒険を削除でき、再読み込みしても消えている（開発者がブラウザで実機確認済み）。
- [×] 確認せずに消えることがない（`window.confirm`）。

## 注意

- `messages.playthrough_id` は `on delete cascade`（`supabase/migrations/0001_init.sql:22`）。プレイスルーを消せば発言も消える。**アプリ側で messages を先に消す処理は要らない。**
- Server Action は公開エンドポイントとして扱う。ローカル単一ユーザーでも入力検証はする（`CLAUDE.md` / Next.js 15 方針）。
- 論理削除（アーカイブ）はしない。要件に無い（先読み実装の禁止）。
