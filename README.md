# ともに / Tomoni — 実況・語り・戦友AI

苦手なシミュレーションRPGを、画面を見て**実況・昔話・励まし**をしてくれる「戦友AI」と一緒にクリアを目指す、**自分専用のローカルツール**。コンセプトは「**一人じゃない**」。最終成果物は YouTube 動画で、アプリはその道具。

題材（MVP）は **ファミコン版『ファイアーエムブレム 暗黒竜と光の剣』（1990 / FE1）の1本特化**。

> 上手い人の華麗な攻略動画ではなく、「苦手な人が、戦友AIに励まされ、昔話で和みながら、なんとかクリアを目指す」共感型コンテンツを狙う。AIは攻略先生ではなく、**隣で一緒に体験して感情を共有する戦友**。

## 仕組み

OBSバーチャルカメラ経由でゲーム画面を取り込み、「**フレーム取得 → 送信 → 生成 → 読み上げ**」のループで AI が自分から語る。

1. OBSの仮想カメラを `getUserMedia` で受け取りプレビュー表示。
2. 一定間隔でフレームを切り出し、**画面が変化したときだけ** Gemini(Vision) に送る（ターン制SLG向けにコストと繰り返しを抑制）。
3. AI が画面を見て実況・語り・励ましをストリーミングで返す。
4. その発言を Google Cloud TTS（Chirp3-HD）で読み上げる。
5. 録画モードで OBS に映して動画化する。

詳細な仕様・スコープ・データモデルは [`REQUIREMENTS.md`](./REQUIREMENTS.md) を参照。AIに読ませる前提知識は [`fe-primer.md`](./fe-primer.md)（全章共通プライマー）にある。

## 技術スタック

- Next.js 15（App Router）+ React 19 + TypeScript（strict）+ Tailwind CSS
- Supabase（`@supabase/supabase-js`・RLS/認証なし・ローカル単一ユーザー）
- Google Gen AI SDK（`@google/genai`）— `gemini-2.5-flash`（Vision）
- Google Cloud Text-to-Speech（REST・Chirp3-HD）

## セットアップ

```bash
npm install
npm run dev   # http://localhost:3000
```

### 環境変数

サーバ専用キーを `.env.local` に設定する（**`NEXT_PUBLIC_` を付けない**）。

```bash
GEMINI_API_KEY=...        # Gemini 呼び出し
GOOGLE_TTS_API_KEY=...    # 読み上げ（/api/tts）
```

Supabase 等の接続情報も `REQUIREMENTS.md §9` のデータモデルに合わせて設定する。

### OBS 側

エミュレーターをソースにしたシーンを組み、**仮想カメラを ON** にする。アプリ側のデバイス一覧から "OBS Virtual Camera" を選択してプレビューに映す。録画は OBS 本体で行う。

## コマンド

```bash
npm run dev     # 開発サーバ（Turbopack）
npm run build   # 本番ビルド
npm run start   # ビルド済みを起動
npm run lint    # ESLint
```

## 前提・注意

- **ローカル専用**（認証・公開・デプロイなし）。開発者のミニPCで動けばよい。
- ゲームは**自分が所有するFC版カートリッジから吸い出したROM**を合法な範囲で使用する前提。配布ROMは使わない。
- 動画公開前に、必要なら発行元の動画・配信ガイドラインを確認する。
