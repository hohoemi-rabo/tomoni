import Link from "next/link";
import { notFound } from "next/navigation";

import SessionClient from "@/app/session/[id]/SessionClient";
import { getPlaythrough } from "@/lib/playthroughs";

/**
 * セッション画面（ticket 10・REQUIREMENTS §5.1 / §10）。
 *
 * 取得は Server Component、対話部分は SessionClient（'use client'）に閉じる。
 * 03（プレビュー）・04（自動実況）・07（実況API）・08（読み上げ）をここで統合する。
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 15: params は非同期。
  const playthrough = await getPlaythrough(id);
  if (!playthrough) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold">{playthrough.title}</h1>
          <span className="text-xs text-black/55 dark:text-white/55">
            {playthrough.game_version}
            {playthrough.state?.chapter ? ` ・ ${playthrough.state.chapter}` : ""}
          </span>
        </div>
        <Link
          href="/"
          className="shrink-0 text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← 一覧へ
        </Link>
      </header>

      <SessionClient
        playthroughId={playthrough.id}
        initialChapter={playthrough.state?.chapter ?? ""}
      />
    </main>
  );
}
