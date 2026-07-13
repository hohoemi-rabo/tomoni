# 21 `/knowledge` をゲームごとに差せるようにする

## 概要

`/knowledge`（参照URL → 章キャスト表の下書き → 目視確認 → 保存）は、いまや **FE の形そのもの**をしている。

- 本文を **章（`Map.N` / `第N章` / `Chapter N`）** で割る
- **自軍／敵**、`klass` / `lv` / `hp` / `items` / `isBoss` という **SRPG の responseSchema** で抽出する
- 自軍を**第1章から累積**する（FE の「新規加入した人しか表に載らない」という事情への対処）
- 「自軍（仲間）／敵」という見出しで整形する

これは FE では正しいが、他ジャンルには当たらない。20 でゲームが差し替え可能になったら、この道具も**ゲームごとに設定を差せる**ようにする（`game.json` に抽出設定を置く）。

**汎用の抽出器を作ろうとしないこと。** 「どんなゲームでも表を読める1つの賢いスキーマ」は存在しない。ゲームごとに「何を抽出し、どう整形するか」を宣言できればよく、宣言が無いゲームでは `/knowledge` を**使えないままにしておく**（知識ファイルは手書き・またはスクショから Claude Code に起こさせる＝`REQUIREMENTS.md §8.4 その2`）。これは劣化ではなく、`/knowledge` が**一度きりの道具**である以上、妥当な線。

## 設計

`game.json`（§8.0）に任意の `knowledgeBuilder` を足す。**無ければ `/knowledge` はそのゲームを選べない**（UI で無効化し、理由を出す）。

```jsonc
{
  "title": "…",
  "knowledgeBuilder": {
    "sectionHeading": "^(?:Map[.．]?\\s*(\\d{1,2})|第\\s*(\\d{1,2})\\s*章|Chapter\\s+(\\d{1,2}))",
    "groups": [
      { "key": "allies",  "heading": "自軍（仲間）", "accumulate": true  },
      { "key": "enemies", "heading": "敵",          "accumulate": false }
    ],
    "fields": ["klass", "lv", "hp", "items", "count", "isBoss"],
    "extra": "後発作品（紋章の謎・新暗黒竜 等）の知識を混ぜない。テキストに書いてあることだけ。"
  }
}
```

- `groups[].accumulate` が FE の「自軍は第1章から累積」を宣言で表す。
- `fields` から `responseSchema` を組む。**`required` と `propertyOrdering` は必ず明示する**（16 の教訓：任意フィールドはモデルが黙って省略する）。
- `extra` はそのゲーム固有の抽出上の注意（版の取り違え防止など）。
- **整形は引き続き純関数**（`renderChapterMarkdown`）。LLM に Markdown を書かせない（16 の教訓）。

`knowledge-extract.ts` の純関数群は、固定の `allies` / `enemies` ではなく **`groups` を回す**形に一般化する。`splitChapters` の見出し正規表現は設定から受け取る。

## Todo

- [×] `game.json` に `knowledgeBuilder`（任意）を追加。型を `src/lib/types.ts` の `GameDef` に足す
- [×] `knowledge/fe-fc/game.json` に FE の現行設定をそのまま書き下ろす（挙動が変わらないことが確認の基準）
- [×] `src/lib/knowledge-extract.ts`：`splitChapters(text, headingPattern)` に一般化。`ChapterCast` を `{ chapter, title, groups: Record<string, CastUnit[]> }` に。`accumulateAllies` → `accumulateGroups`（`accumulate: true` のグループだけ累積）。`renderChapterMarkdown` は `groups[].heading` で見出しを出す
- [×] `src/app/api/knowledge/extract/route.ts`：`game` を受け取り、`knowledgeBuilder` から `responseSchema` と抽出指示を組む。**`required` / `propertyOrdering` を明示**
- [×] `src/app/api/knowledge/save/route.ts`：保存先を `knowledge/<game>/chapters/` に。**slug は検証してから `path.join`**（リポジトリで唯一の `writeFile` なので特に慎重に）
- [×] `src/app/knowledge/KnowledgeClient.tsx`：ゲーム選択を足す。`knowledgeBuilder` が無いゲームは選べない（「このゲームは URL からの生成に対応していません。知識ファイルは手書きしてください」と出す）
- [×] 検証：`node --experimental-strip-types` で純関数（`splitChapters` / `accumulateGroups` / `renderChapterMarkdown`）を直接実行し、**FE 設定で既存の `chapter-01.md`〜`chapter-25.md` と同じ体裁が出る**こと
- [×] 検証：`/knowledge` で FE の章を1つ再生成し、保存済みファイルと差分が出ない（または説明できる差分だけ）こと。**ダミー行を作ったら必ず消す**
- [×] `docs/16-knowledge-builder.md` に「21 で `game.json` 駆動に一般化した」と追記
- [×] `knowledge/fe-fc/README.md` を更新

## 完了条件

- FE の章キャスト表を `/knowledge` で**これまでと同じ体裁で**生成・保存できる（回帰していない）。
- `knowledgeBuilder` を書いた別のゲームでも、**コードを触らずに** `/knowledge` が使える。
- `knowledgeBuilder` の無いゲームでは `/knowledge` が安全に無効化される（クラッシュしない・手書きへ誘導する）。

## 注意

- **16 の教訓は全部そのまま生きる**（`docs/16-knowledge-builder.md` の「実装時に分かったこと」を必ず読む）。特に:
  - `required` / `propertyOrdering` を明示しないと `hp` / `items` が丸ごと落ちる。
  - HTML の `</td>` を改行にすると表が壊れる（セルは `|`、行は改行）。
  - 多数の LLM 呼び出しを `Promise.all` で束ねない（1件の 503 で全滅する）。
  - `withRetry` の既定（3回・500ms 起点）では 503 に耐えられない（`KNOWLEDGE_EXTRACT_RETRIES`）。
  - 文字コード判定を誤ると LLM が「もっともらしい嘘」を返す（Shift-JIS を UTF-8 で読んで「GBA版」と答えた）。
- **中身が空のテンプレを置かない。** `buildSystemPrompt` は非空なら注入するので、プレースホルダがそのまま AI に渡る。ファイルが無いほうが正しい。
- 参照サイトからの取得は**名簿化のための一度きり**（`§5.2`）。実況ループからは取得しない。この線引きは 21 でも変わらない。
