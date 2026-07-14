import Link from "next/link";

import GameRegisterClient from "@/app/knowledge/GameRegisterClient";
import KnowledgeClient from "@/app/knowledge/KnowledgeClient";
import { listGames } from "@/lib/games";

/**
 * 知識ファイルの生成ページ（ticket 16 / 21 / 23・§8.4）。
 *
 * 2つの一度きりの道具を並べる:
 * - **① ゲーム登録**（ticket 23）… タイトル・機種・URL から `game.json` ＋ `primer.md` の下書き。
 * - **② 章キャスト表の生成**（ticket 16 / 21）… 参照URLの表から章ごとの名簿。**`knowledgeBuilder`
 *   を持つゲームだけ**（章構造を持たないゲームまで1つの抽出スキーマで読もうとしない）。
 *
 * どちらも「一度きりの取得 → 目視確認 → ファイル保存」。実況ループからは呼ばない独立ハーネス。
 */
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const games = await listGames();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Link
        href="/"
        className="text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← トップへ戻る
      </Link>
      <h1 className="text-lg font-semibold">知識ファイルの生成</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        参照先の利用規約と robots.txt を確認したうえで、取得は一度きりに留めること。
        LLM は静かに間違えるので、<strong>必ず中身を確認してから保存してください</strong>。
      </p>

      <section className="flex flex-col gap-4 rounded border border-black/10 p-5 dark:border-white/10">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">① ゲーム登録（primer の下書き）</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            新しいゲームを <code>knowledge/&lt;slug&gt;/</code> に登録します。生成するのは
            <strong>プライマーの下書きだけ</strong>——そのゲームの同定・感情が動く場面・基本ルール・
            背景ネタ・何が「手順」にあたるか・画面認識上の注意。攻略手順の散文は捨てます。
            保存すると、<strong>コードを触らずに</strong>そのゲームの冒険を作れます。
          </p>
        </div>
        <GameRegisterClient existingSlugs={games.map((g) => g.slug)} />
      </section>

      <section className="flex flex-col gap-4 rounded border border-black/10 p-5 dark:border-white/10">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">② 章キャスト表の生成</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            参照URL（最大3件）の表から章ごとの名簿を作ります。取り込むのは表の事実だけで、
            攻略手順の散文は捨てます。章・ステージ構造を持つゲーム（<code>game.json</code> に{" "}
            <code>knowledgeBuilder</code> があるもの）でだけ使えます。
          </p>
        </div>
        <KnowledgeClient
          games={games.map((g) => ({
            slug: g.slug,
            title: g.title,
            supported: Boolean(g.knowledgeBuilder),
          }))}
        />
      </section>
    </main>
  );
}
