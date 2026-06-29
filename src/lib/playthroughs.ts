import "server-only";

import { getSupabaseClient } from "@/lib/supabase";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { withRetry } from "@/lib/retry";
import type { Persona, Playthrough, State } from "@/lib/types";

/**
 * プレイスルーの CRUD ヘルパー（サーバ専用・REQUIREMENTS §9）。
 *
 * 外部呼び出しは withRetry で包む。エラーは握りつぶさず throw し、呼び出し側
 * （Route Handler / Server Component）で画面に出す方針。
 */

/** 全プレイスルーを新しい順で取得。 */
export async function listPlaythroughs(): Promise<Playthrough[]> {
  return withRetry(async () => {
    const { data, error } = await getSupabaseClient()
      .from("playthroughs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`プレイスルー一覧の取得に失敗: ${error.message}`);
    return (data ?? []) as Playthrough[];
  });
}

/** id で1件取得。存在しなければ null。 */
export async function getPlaythrough(id: string): Promise<Playthrough | null> {
  return withRetry(async () => {
    const { data, error } = await getSupabaseClient()
      .from("playthroughs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`プレイスルーの取得に失敗: ${error.message}`);
    return (data as Playthrough | null) ?? null;
  });
}

export interface CreatePlaythroughInput {
  title: string;
  game_version: string;
  persona?: Persona;
  state?: State;
}

/** プレイスルーを新規作成。persona 未指定なら既定値を入れる。 */
export async function createPlaythrough(
  input: CreatePlaythroughInput,
): Promise<Playthrough> {
  return withRetry(async () => {
    const { data, error } = await getSupabaseClient()
      .from("playthroughs")
      .insert({
        title: input.title,
        game_version: input.game_version,
        persona: input.persona ?? DEFAULT_PERSONA,
        state: input.state ?? {},
      })
      .select("*")
      .single();
    if (error) throw new Error(`プレイスルーの作成に失敗: ${error.message}`);
    return data as Playthrough;
  });
}

/**
 * state を部分更新する（jsonb のマージ）。
 * 現在の state を読み、partial を上書きマージして書き戻す。updated_at も更新。
 */
export async function updatePlaythroughState(
  id: string,
  partial: Partial<State>,
): Promise<Playthrough> {
  const current = await getPlaythrough(id);
  if (!current) throw new Error(`プレイスルーが見つかりません: ${id}`);

  const merged: State = { ...current.state, ...partial };

  return withRetry(async () => {
    const { data, error } = await getSupabaseClient()
      .from("playthroughs")
      .update({ state: merged, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(`state の更新に失敗: ${error.message}`);
    return data as Playthrough;
  });
}
