"use server";

import { revalidatePath } from "next/cache";

import { createPlaythrough } from "@/lib/playthroughs";

/**
 * トップ画面のプレイスルー作成 Server Action（REQUIREMENTS §10・ticket 09）。
 *
 * Server Action は公開エンドポイント扱い。ローカル単一ユーザーでも入力検証は必ず行う
 * （CLAUDE.md / Next.js 15 方針）。作成後は一覧を再検証してトップに反映する。
 */

export interface CreatePlaythroughState {
  error?: string;
  ok?: boolean;
}

export async function createPlaythroughAction(
  _prev: CreatePlaythroughState,
  formData: FormData,
): Promise<CreatePlaythroughState> {
  const title = String(formData.get("title") ?? "").trim();
  const game_version = String(formData.get("game_version") ?? "").trim();

  if (!title) return { error: "タイトルを入力してください。" };
  if (!game_version) return { error: "バージョンを入力してください。" };

  try {
    await createPlaythrough({ title, game_version });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "プレイスルーの作成に失敗しました。",
    };
  }
}
