-- Club points patch 01: table and RLS policies.

create table if not exists public.club_points (
  point_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  amount integer not null,
  reason text not null,
  game_id uuid,
  created_at timestamptz not null default now()
);

alter table public.club_points enable row level security;

drop policy if exists "points club members read" on public.club_points;
drop policy if exists "points club members insert" on public.club_points;

create policy "points club members read"
on public.club_points
for select
to authenticated
using (public.is_club_member(club_id, auth.uid()));

create policy "points club members insert"
on public.club_points
for insert
to authenticated
with check (public.is_club_member(club_id, auth.uid()));

select 'patch_club_points_01_table_ok' as result;
