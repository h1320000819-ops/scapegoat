-- 01: Online authority tables and helper functions.
-- Run this whole file in Supabase SQL Editor.

create table if not exists public.player_connections (
  table_id uuid not null references public.tables(table_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  status text not null default 'online' check (status in ('online', 'reconnecting', 'offline')),
  last_seen_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

create table if not exists public.pending_actions (
  pending_action_id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(game_id) on delete cascade,
  table_id uuid not null references public.tables(table_id) on delete cascade,
  player_id uuid not null references public.users(user_id) on delete cascade,
  turn_version integer not null,
  options jsonb not null default '[]',
  selected_action_id uuid references public.game_events(event_id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_actions_game_open_idx
on public.pending_actions(game_id, player_id, selected_action_id);

alter table public.player_connections enable row level security;
alter table public.pending_actions enable row level security;

create or replace function public.is_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_members
    where club_id = p_club_id
      and user_id = p_user_id
  );
$$;

create or replace function public.is_club_admin(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_members
    where club_id = p_club_id
      and user_id = p_user_id
      and role = 'admin'
  );
$$;

grant execute on function public.is_club_member(uuid, uuid) to anon, authenticated;
grant execute on function public.is_club_admin(uuid, uuid) to anon, authenticated;

select 'online_authority_01_ok' as result;
