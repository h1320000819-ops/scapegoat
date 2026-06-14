-- Minimal persistent account data patch.
-- This file creates/repairs tables only. It defines NO functions, so it cannot
-- fail with "no function body specified".

create table if not exists public.club_points (
  point_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  amount integer not null,
  reason text not null,
  game_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.replays (
  replay_id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(club_id) on delete set null,
  table_id uuid,
  game_id uuid,
  summary jsonb not null default '{}',
  initial_state jsonb not null default '{}',
  events jsonb not null default '[]',
  snapshots jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists replays_club_created_idx
on public.replays(club_id, created_at desc);

alter table public.club_points enable row level security;
alter table public.replays enable row level security;

-- Make every club owner an admin member of their own club.
insert into public.club_members (club_id, user_id, role)
select c.club_id, c.owner_user_id, 'admin'
from public.clubs c
where c.owner_user_id is not null
on conflict (club_id, user_id) do update
set role = case
  when public.club_members.role = 'admin' then 'admin'
  else excluded.role
end;

select 'patch_account_persistent_data_minimal_no_functions_ok' as result;
