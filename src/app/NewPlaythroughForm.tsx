"use client";

import { useActionState, useState } from "react";

import {
  type CreatePlaythroughState,
  createPlaythroughAction,
} from "@/app/actions";
import type { GameDef } from "@/lib/types";

/**
 * プレイスルー新規作成フォーム（ticket 09 / 20）。対話部分だけ Client Component に閉じる。
 *
 * ゲームは `knowledge/<slug>/game.json` の一覧から選ぶ（ticket 20）。1本しか無ければ
 * 選択肢は1つで、実質いままでどおり。タイトル・バージョンは選んだゲームの既定値が
 * 入るが、**上書きできる**（同じゲームの2周目に別名を付けられるように）。
 *
 * 送信は Server Action（`createPlaythroughAction`）。検証エラーは画面に表示する。
 */

const INITIAL_STATE: CreatePlaythroughState = {};

export default function NewPlaythroughForm({ games }: { games: GameDef[] }) {
  const [state, formAction, isPending] = useActionState(
    createPlaythroughAction,
    INITIAL_STATE,
  );
  const [slug, setSlug] = useState(games[0]?.slug ?? "");

  if (games.length === 0) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        ゲーム定義がありません。`knowledge/&lt;slug&gt;/game.json` を置いてください。
      </p>
    );
  }

  const selected = games.find((g) => g.slug === slug) ?? games[0];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        ゲーム
        <select
          name="game"
          value={selected.slug}
          onChange={(e) => setSlug(e.target.value)}
          className="rounded border border-black/15 bg-background px-3 py-2 text-foreground dark:border-white/15"
        >
          {games.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        タイトル
        <input
          // key を変えて、ゲームを切り替えたときに既定値を入れ直す
          // （defaultValue は再レンダーでは反映されないため）。
          key={`title-${selected.slug}`}
          name="title"
          defaultValue={selected.title}
          className="rounded border border-black/15 bg-background px-3 py-2 text-foreground dark:border-white/15"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        バージョン
        <input
          key={`version-${selected.slug}`}
          name="game_version"
          defaultValue={selected.version ?? ""}
          className="rounded border border-black/15 bg-background px-3 py-2 text-foreground dark:border-white/15"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {isPending ? "作成中…" : "新しい冒険を作成"}
        </button>
        {state.ok && (
          <span className="text-sm text-green-600 dark:text-green-400">
            作成しました。
          </span>
        )}
      </div>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
