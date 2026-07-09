"use server";

import { revalidatePath } from "next/cache";

import { createPlaythrough, deletePlaythrough } from "@/lib/playthroughs";

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

export interface DeletePlaythroughState {
  error?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * プレイスルー削除 Server Action（ticket 17）。取り消せない。
 * 確認は呼び出し元のUIが行う。ここは id の形式だけを検証して削除する。
 */
export async function deletePlaythroughAction(
  _prev: DeletePlaythroughState,
  formData: FormData,
): Promise<DeletePlaythroughState> {
  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "削除対象の指定が不正です。" };

  try {
    await deletePlaythrough(id);
    revalidatePath("/");
    return {};
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "プレイスルーの削除に失敗しました。",
    };
  }
}
