import Link from "next/link";

import DeletePlaythroughButton from "@/app/DeletePlaythroughButton";
import NewPlaythroughForm from "@/app/NewPlaythroughForm";
import { listPlaythroughs } from "@/lib/playthroughs";

// 一覧は常に Supabase の現在値を反映する（プリレンダのキャッシュを避ける）。
export const dynamic = "force-dynamic";

/**
 * トップ画面（ticket 09・REQUIREMENTS §10）。プレイスルー一覧と新規作成。
 *
 * 取得は Server Component（`listPlaythroughs`）、作成フォームだけ Client。
 * 単一ユーザー・認証なし・FC版FE専用（複数ゲーム差し替えUIは作らない）。
 */
export default async function Home() {
  const playthroughs = await listPlaythroughs();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">ともに</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          画面を見て実況・昔話・励ましをしてくれる戦友AIと、一緒にクリアを目指す。
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">新しい冒険を始める</h2>
        <NewPlaythroughForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">これまでの冒険</h2>
        {playthroughs.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            まだプレイスルーがありません。最初の冒険を作成してください。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {playthroughs.map((pt) => (
              <li
                key={pt.id}
                className="flex items-center justify-between gap-4 rounded border border-black/10 p-3 dark:border-white/10"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{pt.title}</span>
                  <span className="text-xs text-black/55 dark:text-white/55">
                    {pt.game_version}
                    {pt.state?.chapter ? ` ・ ${pt.state.chapter}` : ""}
                    {` ・ ${formatDate(pt.created_at)}`}
                  </span>
                </div>
                <div className="flex shrink-0 items-start gap-2">
                  <Link
                    href={`/session/${pt.id}`}
                    className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
                  >
                    セッション開始
                  </Link>
                  <DeletePlaythroughButton id={pt.id} title={pt.title} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** ISO 文字列を読みやすい日本語の日時にする（ロケール非依存の固定整形）。 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
