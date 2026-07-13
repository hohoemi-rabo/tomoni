---
name: verify
description: ともに（Tomoni）の変更を実際に動かして確かめる。ブラウザ依存（映像取り込み・自動実況ループ・読み上げ）を Playwright の偽カメラで無人駆動する手順と、サーバ側ロジックの確認方法。
---

# ともに / 検証の手順

「フレーム取得 → 送信 → 生成 → 読み上げ」のループが本体なので、**ほとんどの変更の観測面はブラウザ**。
`npm run lint` や型チェックは検証ではない（CI の再実行にすぎない）。実際に画面を動かして観測する。

## 1. dev サーバ

```bash
ss -ltn | grep :3000      # 既に起動していないか必ず確認する
npm run dev               # 3000 が埋まっていると勝手に 3001 へ退避する（ハマる）
```

- **既に 3000 で dev サーバが動いていることが多い**（開発者が起動しっぱなし）。その場合は起動し直さず、そのまま叩く。HMR で変更は反映される。
- **dev 起動中に `npm run build` を実行しない**（`.next` が壊れて実行中の dev が 500 を返す）。

## 2. ブラウザを無人で駆動する（Playwright + 偽カメラ）

リポジトリに Playwright は入っていない（本番依存を増やさない）。**scratchpad 側に入れて使う**。

```bash
npx playwright install chromium                       # 初回のみ（~100MB・グローバルキャッシュ）
cd <scratchpad> && npm init -y && npm i playwright    # プロジェクトには入れない
```

起動オプションがすべて。これが無いと観測できない:

```js
chromium.launch({ args: [
  "--use-fake-device-for-media-stream",   // 常に動くテストパターン映像＝変化検知が毎tick発火する
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required", // これが無いと mp3 の play() が拒否され、
                                               // 読み上げが即終了したように見えて誤判定する
]})
browser.newContext({ permissions: ["camera", "microphone"] })
```

駆動手順（`/session/[id]`）:

1. `getByRole("button", { name: "カメラを開始" }).click()` — 偽カメラが選択済みで開く。
2. `getByLabel("読み上げ").check()` / `getByLabel("自動実況").check()`。
3. 観測する。

## 3. 何を観測窓にするか

- **`/api/narrate` と `/api/tts` のリクエスト発火時刻** — `page.on("request", ...)` で拾う。ループのタイミングはこれが一番素直に出る。
- **「読み上げ中: はい／いいえ」** — `SessionClient` の状態表示。`tts.speaking` をそのまま画面に出しているので、DOM から読める（`page.locator("text=読み上げ中:")`）。
- 偽カメラは**常に映像が変化する**ので、変化検知は毎 tick 発火する＝**割り込み系の不具合が最も出やすい条件**になる。

**タイミング系の変更は A/B を取る。** `git stash push -- src/` で変更前に戻して同じスクリプトを流し、タイムラインを比べる（HMR で反映されるので dev の再起動は不要）。「直ったこと」より「壊れていたことを検出できるハーネスであること」を先に示す。

## 4. ブラウザ以外

- **純粋なサーバ側ロジック**（`prompt.ts` / `sentence.ts` / `knowledge-extract.ts` 等）: `node --experimental-strip-types <file>.mts` で実モジュールを直接実行。ただしこれは単体確認であって、ループの検証にはならない。
- **API Route**: dev 起動中に `curl` で疎通・異常系。検証用の一時 JPEG は `curl https://picsum.photos/256.jpg`（1x1 の極小 JPEG は Gemini が弾く）。
- **DB**: Supabase MCP（`execute_sql`）。プロジェクト ref は `enwzuxfufsnvghivcyut`。**ダミー行は必ず消す。`WHERE` 無しの `UPDATE`/`DELETE` は実行しない。**
- `@google/genai` 等を使う検証スクリプトは**プロジェクト直下**に置いて実行し、**実行後に消す**（scratchpad からは `node_modules` を解決できない）。Playwright だけは例外で scratchpad に置く（HTTP 越しに叩くだけなのでプロジェクトの依存を必要としない）。

## 既知（変更のせいではない）

- `/session/[id]` は**既存のハイドレーション不一致**を1件出す（`Hydration failed because the server rendered HTML didn't match the client`）。dev オーバーレイの「1 Issue」はこれ。変更前のコードでも再現するので、これを新しい変更の失敗と誤認しない。
- 自動実況ループは実 API を叩く（Gemini / Cloud TTS）。**駆動しっぱなしはそのまま課金**になる。走らせる時間は必要最小限に。
