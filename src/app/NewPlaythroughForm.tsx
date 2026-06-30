"use client";

import { useActionState } from "react";

import {
  type CreatePlaythroughState,
  createPlaythroughAction,
} from "@/app/actions";

/**
 * プレイスルー新規作成フォーム（ticket 09）。対話部分だけ Client Component に閉じる。
 *
 * 既定値は FC版FE固定の文言（複数ゲーム差し替えUIではなく、上書き可能な初期値）。
 * 送信は Server Action（`createPlaythroughAction`）。検証エラーは画面に表示する。
 */

const DEFAULT_TITLE = "ファイアーエムブレム 暗黒竜と光の剣";
const DEFAULT_GAME_VERSION = "ファミコン版（1990）";

const INITIAL_STATE: CreatePlaythroughState = {};

export default function NewPlaythroughForm() {
  const [state, formAction, isPending] = useActionState(
    createPlaythroughAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        タイトル
        <input
          name="title"
          defaultValue={DEFAULT_TITLE}
          className="rounded border border-black/15 bg-background px-3 py-2 text-foreground dark:border-white/15"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        バージョン
        <input
          name="game_version"
          defaultValue={DEFAULT_GAME_VERSION}
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
