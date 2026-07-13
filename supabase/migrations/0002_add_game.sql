-- ともに / Tomoni  ゲーム slug の追加（REQUIREMENTS §8.0 / §9・チケット20）
--
-- そのプレイスルーがどのゲームか＝どの知識ディレクトリ（knowledge/<game>/）を読むか。
-- 既存行は既定値 'fe-fc' になる（＝いままでどおり動く）。
--
-- 適用状況: tomoni プロジェクト（ref: enwzuxfufsnvghivcyut）へ Supabase MCP の
--   apply_migration で適用済み（migration 名: add_game_to_playthroughs）。

alter table public.playthroughs
  add column game text not null default 'fe-fc';
