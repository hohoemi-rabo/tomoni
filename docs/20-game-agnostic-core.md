# 20 ゲームを差し替え可能にする（知識ディレクトリとゲーム定義）

## 概要

**FC版FE専用**という制約を撤廃する（`REQUIREMENTS.md §5.2 / §12`・方針転換）。撤廃するのは「複数ゲーム対応の禁止」だけで、**他の強い制約（攻略アドバイス禁止・大量注入禁止・RAG禁止・認証/公開の禁止）は維持する**。

実装を読んで分かったのは、**ループ本体には FE 依存が1文字も無い**ということ。`video/*`・`useAutoNarration`・`useTts`・`useSpeechRecognition`・`sentence.ts`・`/api/tts`・録画モード・`gemini.ts`・`retry` は、ゲームが変わってもそのまま動く。FE に縛られているのは次の3箇所だけだった。

1. **知識ファイルの場所**（`knowledge.ts` の `KNOWLEDGE_DIR` が `knowledge/fe-fc` 固定、プライマー名が `fe-primer.md` 固定）
2. **プロンプトのゲーム固有行**（ロスト・命中率・FC版の同定・「加入条件」という語彙）
3. **state のラベル**（「到達章」「失った仲間（ロスト）」が UI とプロンプトに直書き）

このうち **2 は先に片付けた**（`prompt.ts` は「戦友としてどう振る舞うか」だけ、primer は「このゲームは何か」だけ、というコミット済みの分離）。本チケットは 1 と 3 を片付け、**`knowledge/<slug>/` にファイルを置けばゲームが増える**状態にする。

**ゲームを足すためにコードを書かない**——これが受け入れ条件。ゲーム固有の分岐を `src/` に散らかしたら失敗。

## 設計

### ディレクトリ（ゲーム1本＝ディレクトリ1つ）

```
knowledge/
├── fe-fc/
│   ├── game.json          # 新規: 表示名・進捗の呼び方・抽出設定（§8.0）
│   ├── primer.md          # fe-primer.md からリネーム（名前をゲーム非依存に）
│   ├── README.md
│   └── chapters/chapter-01.md … chapter-25.md
└── <新ゲーム>/
    ├── game.json
    ├── primer.md
    └── chapters/…
```

`game.json`（`REQUIREMENTS.md §8.0`）:

```jsonc
{
  "title": "ファイアーエムブレム 暗黒竜と光の剣",
  "version": "ファミコン版（1990）",
  "progressLabel": "到達章",
  "progressPlaceholder": "例: 第2章",
  "lostLabel": "失った仲間（ロスト）"
}
```

- **AIの振る舞いは書かない**（それは `prompt.ts`）。**ゲームの前提も書かない**（それは `primer.md`）。ここは「呼び方」と「引き方」だけ。
- `lostLabel` が無いゲームでは省略する。省略＝プロンプトにも UI にも出さない。

### state のキーは変えない

`state.chapter` / `state.lost_units` という**キーはそのまま**にする（jsonb の移行を避ける）。差し替えるのは `game.json` から来る**呼び方だけ**。「章」を持たないゲームでは `chapter` に「西の森」などが入るだけで、ローダーは番号が引ければ章ファイルを読み、引けなければ読まない（今の `chapterToNumber` の挙動そのまま）。

### DB

```sql
alter table public.playthroughs add column game text not null default 'fe-fc';
```

既存行は既定値で `fe-fc` になる（＝いままでどおり動く）。

## Todo

- [ ] `supabase/migrations/0002_add_game.sql`：`playthroughs.game` を追加（既定 `'fe-fc'`）。Supabase MCP の `apply_migration` で適用
- [ ] `knowledge/fe-fc/fe-primer.md` → `primer.md` にリネーム
- [ ] `knowledge/fe-fc/game.json` を作成（上記）
- [ ] `src/lib/games.ts`（新規・`server-only`）：`loadGameDef(slug)` / `listGames()`。`knowledge/*/game.json` を読むだけ。**slug は `[a-z0-9-]+` に制限し、`path.join` の前に検証する**（パストラバーサル封じ。`/knowledge` の save が同じ理由で章番号をサーバ側で組み立てている）
- [ ] `src/lib/knowledge.ts`：`KNOWLEDGE_DIR` 定数を捨て、`loadPrimer(game)` / `loadChapterCast(game, chapter)` に引数を足す。ファイル名は `primer.md`
- [ ] `src/lib/types.ts`：`Playthrough.game: string` と `GameDef` を追加
- [ ] `src/lib/playthroughs.ts`：`createPlaythrough` が `game` を受け取り保存する
- [ ] `src/lib/prompt.ts`：`gameDef` を受け取り、state セクションの見出しを `progressLabel` / `lostLabel` から組む（「到達章」「失った仲間（ロスト）」の直書きを消す）
- [ ] `src/app/api/narrate/route.ts`：`playthrough.game` でプライマーと章ファイルを引く
- [ ] `src/app/api/end-session/route.ts`：`chapter` 手入力のラベルをゲーム定義から。プロンプト内の「章」語彙も差す
- [ ] `src/app/NewPlaythroughForm.tsx`：ゲーム選択（`listGames()` の一覧）。**1本しか無ければ選択肢1つ**で従来どおり。選ぶとタイトル・バージョンの既定値が入る
- [ ] `src/app/session/[id]/SessionClient.tsx` / `page.tsx`：「到達章」の表示・入力ラベルを `progressLabel` / `progressPlaceholder` から
- [ ] `knowledge/fe-fc/README.md` を新しい構成に合わせて更新
- [ ] 検証：FE のプレイスルーが**従来どおり**動く（プライマー・章キャスト表が注入され、版・ロスト・手順拒否が保たれる）
- [ ] 検証：ダミーのゲーム定義（`knowledge/_dummy/`）を1つ足し、**コードを触らずに**新規作成でそれを選べて、そのプライマーが注入されること。確認したら消す
- [ ] `REQUIREMENTS.md` の §5.2 / §7.2 / §7.3 / §8 / §9 / §10 / §12 を改訂（**このチケットに着手する前に済ませた**）

## 完了条件

- `knowledge/<slug>/`（`game.json` ＋ `primer.md`）を置くだけで、**`src/` を1行も触らずに**新しいゲームのプレイスルーを作れる。
- FE のプレイスルーは、これまでとまったく同じように動く（版の同定・ロストの重み・手順の拒否）。
- 「到達章」「失った仲間」という FE 語彙が `src/` に残っていない（`grep` で確認できる）。

## 注意

- **汎用化で FE を薄めない。** ロストを重く悼む・命中に一喜一憂するという作り込みは、消すのではなく**プライマー側へ移す**。実況の質はゲーム固有の層の出来で決まる。
- **ゲーム固有の分岐を `src/` に入れない。** 「このゲームのときだけ〜」を書きたくなったら、それは `game.json` か `primer.md` に置けるはず。置けないなら設計を見直す。
- **知識は「感情を正しくする最小限」のまま。** 汎用化を口実に攻略ナレッジを積まない（`§5.2` は維持）。
- 実際に汎用かどうかは**2本目を通すまで分からない**。本チケットの受け入れはダミー定義までとし、実ゲームでの検証は題材が決まってから。
