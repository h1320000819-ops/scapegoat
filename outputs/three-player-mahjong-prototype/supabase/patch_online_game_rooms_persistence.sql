-- Persistent Socket.IO room state for reconnect / Render restart recovery.
-- Supabase stores accounts, clubs, points, rake, replays, and this recovery copy.
-- The authoritative live game is still the Node.js Socket.IO server memory.

create table if not exists public.online_game_rooms (
  table_id text primary key,
  game_id text,
  version integer not null default 0,
  state jsonb not null,
  events jsonb not null default '[]',
  processed_request_ids jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create index if not exists online_game_rooms_updated_idx
on public.online_game_rooms(updated_at desc);

alter table public.online_game_rooms enable row level security;

drop policy if exists "online game rooms no client direct read" on public.online_game_rooms;
drop policy if exists "online game rooms no client direct write" on public.online_game_rooms;

create policy "online game rooms no client direct read"
on public.online_game_rooms for select
using (false);

create policy "online game rooms no client direct write"
on public.online_game_rooms for all
using (false)
with check (false);

select 'patch_online_game_rooms_persistence_ok' as result;
