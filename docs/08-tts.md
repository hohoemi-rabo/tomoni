# 08 TTS `/api/tts` と `useTts`

## 概要

あいきょうから流用。Cloud TTS REST（Chirp3-HD）で base64 mp3 を返し、クライアントは文末確定ごとに逐次再生キューへ流す。

関連: `REQUIREMENTS.md §3, §4, §7.1, §11` / 依存: 01

## Todo

- [×] `POST /api/tts`（`src/app/api/tts/route.ts`）：Cloud TTS REST 直叩き → base64 mp3 を返す
- [×] 既定ボイスを **Chirp3-HD** に（`config.ts` の定数）
- [×] `useTts` フック（`'use client'`）：文単位の逐次再生キュー（再生中は次をキュー）
- [×] ストリーミング受信テキストを**文末確定ごと**にキュー投入する連携
- [×] 読み上げ ON/OFF・ボイス選択 UI
- [×] TTS 失敗時もテキスト表示は継続（読み上げだけ失敗を許容）

## 完了条件

- 実況テキストが文単位で自然に読み上げられる。
- ボイス選択・ON/OFF が効く。

## 注意

- TTS は Cloud TTS 課金で **Gemini とは別系統**。無料枠（各エンジン100万字）を意識。
- Markdown記号は読み上げに乗らない前提（プロンプト側で記号を出さない＝06）。
