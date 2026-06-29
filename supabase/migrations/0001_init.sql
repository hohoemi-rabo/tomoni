-- ともに / Tomoni 初期スキーマ（REQUIREMENTS §9）
--
-- 適用状況: tomoni プロジェクト（ref: enwzuxfufsnvghivcyut）へ Supabase MCP の
--   apply_migration で適用済み（migration 名: init_playthroughs_messages）。
-- 方針: RLS/認証なし・ローカル単一ユーザー前提。流用元「あいきょう」の構成を踏襲。
--
-- 新しい環境で作り直す場合は、新規 Supabase プロジェクトを作成し、本SQLを
-- SQL Editor もしくは supabase db push 相当で適用する。

create table public.playthroughs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  game_version text not null,
  state jsonb not null default '{}'::jsonb,
  persona jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  playthrough_id uuid not null references public.playthroughs(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_playthrough_id_created_at_idx
  on public.messages (playthrough_id, created_at);
