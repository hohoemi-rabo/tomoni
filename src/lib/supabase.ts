import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

/**
 * サーバ専用の Supabase クライアント。
 *
 * - RLS/認証なし・ローカル単一ユーザー前提（REQUIREMENTS §3 / §9）。
 * - env を読むのはクライアント初回生成時のみ（遅延生成）。トップレベルで
 *   `getSupabaseClient()` を呼ばないこと——ビルド時に env 検証を走らせないため。
 * - `server-only` import によりクライアントコンポーネントからの誤用を防ぐ。
 */
let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false },
    });
  }
  return client;
}
