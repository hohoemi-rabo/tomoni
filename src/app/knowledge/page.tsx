import Link from "next/link";

import KnowledgeClient from "@/app/knowledge/KnowledgeClient";

/**
 * 章キャスト表の生成ページ（ticket 16・§8.4）。
 *
 * 参照URLから名簿の下書きを作り、目視確認して `knowledge/fe-fc/chapters/` に保存する
 * 一度きりの道具。実況ループからは呼ばない独立ハーネス（`/capture-test` と同じ位置づけ）。
 */
export default function KnowledgePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Link
        href="/"
        className="text-sm text-black/60 hover:underline dark:text-white/60"
      >
        ← トップへ戻る
      </Link>
      <h1 className="text-lg font-semibold">章キャスト表の生成</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        参照URL（最大3件）の表から章ごとの名簿を作ります。取り込むのは表の事実だけで、
        攻略手順の散文は捨てます。LLM は表を読み違えても静かに間違うので、
        <strong>必ず中身を確認してから保存してください</strong>。
        参照先の利用規約と robots.txt を確認したうえで、取得は一度きりに留めること。
      </p>
      <KnowledgeClient />
    </main>
  );
}
