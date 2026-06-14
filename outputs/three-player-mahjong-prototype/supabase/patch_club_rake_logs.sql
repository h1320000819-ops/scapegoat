-- Anmika Rocket: club rake logs patch
-- Run this whole file in the Supabase SQL Editor if the app shows:
-- "Could not find the table 'public.club_rake_logs' in the schema cache".

create table if not exists public.club_rake_logs (
  rake_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid references public.users(user_id) on delete set null,
  user_name text,
  table_id uuid references public.tables(table_id) on delete set null,
  -- Plain UUID for the same reason as replay_id: this patch should not depend
  -- on the full game/replay migration order.
  game_id uuid,
  -- Keep this as a plain UUID in the patch so it can run even before the
  -- replay table migration has been applied.
  replay_id uuid,
  win_type text check (win_type in ('ron', 'tsumo')),
  original_gain integer,
  rake_percent numeric(4, 1),
  rake_amount integer,
  amount integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.club_rake_logs add column if not exists user_id uuid references public.users(user_id) on delete set null;
alter table public.club_rake_logs add column if not exists user_name text;
alter table public.club_rake_logs add column if not exists table_id uuid references public.tables(table_id) on delete set null;
alter table public.club_rake_logs add column if not exists game_id uuid;
alter table public.club_rake_logs add column if not exists replay_id uuid;
alter table public.club_rake_logs add column if not exists win_type text check (win_type in ('ron', 'tsumo'));
alter table public.club_rake_logs add column if not exists original_gain integer;
alter table public.club_rake_logs add column if not exists rake_percent numeric(4, 1);
alter table public.club_rake_logs add column if not exists rake_amount integer;
alter table public.club_rake_logs add column if not exists amount integer not null default 0;
alter table public.club_rake_logs add column if not exists created_at timestamptz not null default now();

alter table public.club_rake_logs enable row level security;

drop policy if exists "rake club admins read" on public.club_rake_logs;
drop policy if exists "rake club members insert" on public.club_rake_logs;

create policy "rake club admins read"
on public.club_rake_logs for select
to authenticated
using (public.is_club_admin(club_id, auth.uid()));

create policy "rake club members insert"
on public.club_rake_logs for insert
to authenticated
with check (public.is_club_member(club_id, auth.uid()));

select 'patch_club_rake_logs_ok' as result;
