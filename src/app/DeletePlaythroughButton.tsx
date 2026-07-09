"use client";

import { useActionState } from "react";

import {
  type DeletePlaythroughState,
  deletePlaythroughAction,
} from "@/app/actions";

const INITIAL_STATE: DeletePlaythroughState = {};

interface Props {
  id: string;
  title: string;
}

/**
 * 冒険を1件削除する（ticket 17）。取り消せないので確認を挟む。
 * あらすじ・進捗も一緒に消えることを、押す前に伝える。
 */
export default function DeletePlaythroughButton({ id, title }: Props) {
  const [state, formAction, isPending] = useActionState(
    deletePlaythroughAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={isPending}
        onClick={(e) => {
          const ok = window.confirm(
            `「${title}」を削除します。\n前回までのあらすじや進捗も消え、元に戻せません。`,
          );
          if (!ok) e.preventDefault();
        }}
        className="rounded border border-red-600/40 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50 dark:border-red-400/40 dark:text-red-400"
      >
        {isPending ? "削除中…" : "削除"}
      </button>
      {state.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
