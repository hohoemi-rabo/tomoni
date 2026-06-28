# 12 state更新 `/api/end-session`（任意）

## 概要

任意・継続性のため。セッション終了時に軽い state（到達章・失った仲間・要約）を更新し、再開時に「前回までのあらすじ」として渡す＝動画のオープニングにもなる。あいきょうの仕組みを流用。

関連: `REQUIREMENTS.md §7.4` / 依存: 02,07

## Todo

- [ ] `POST /api/end-session`：今回の流れから軽い state を生成し `playthroughs.state` を更新
- [ ] 要約生成に `gemini-2.5-flash-lite`（要約＋JSON化・安価）を使用
- [ ] `state`：`chapter`・`lost_units[]`・`progress`・`last_session_summary`（3〜6文）
- [ ] 再開時に `last_session_summary` を「前回までのあらすじ」としてプロンプトへ
- [ ] セッション画面に「セッション終了して保存」操作を追加

## 完了条件

- 終了時に state が更新され、次回の実況に前回あらすじが反映される。

## 注意

- MVPでは簡素でよい。state が無くても実況自体は成立する（07 は画面から状況を読む）。
