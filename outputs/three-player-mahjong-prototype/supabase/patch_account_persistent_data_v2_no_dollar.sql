-- Account persistent data patch v2.
-- This file intentionally does NOT use dollar-quoted strings like $name$.
-- If an error mentions "$anmika_get_my_club_point_history$", you are still
-- running the old SQL, not this file.

select 'patch_account_persistent_data_v2_no_dollar_start' as check_point;

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

drop function if exists public.get_my_clubs();
drop function if exists public.get_my_club_point_history(uuid);
drop function if exists public.get_my_club_replays(uuid);

create or replace function public.get_my_clubs()
returns table (
  club_id uuid,
  club_code text,
  name text,
  owner_user_id uuid,
  role text,
  point_balance integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as '
begin
  if auth.uid() is null then
    raise exception ''login required'';
  end if;

  insert into public.club_members (club_id, user_id, role)
  select c.club_id, auth.uid(), ''admin''
  from public.clubs c
  where c.owner_user_id = auth.uid()
  on conflict (club_id, user_id) do update
  set role = case
    when public.club_members.role = ''admin'' then ''admin''
    else excluded.role
  end;

  return query
  select
    c.club_id,
    c.club_code,
    c.name,
    c.owner_user_id,
    cm.role,
    coalesce(cm.point_balance, 0) as point_balance,
    c.created_at,
    c.updated_at
  from public.club_members cm
  join public.clubs c on c.club_id = cm.club_id
  where cm.user_id = auth.uid()
  order by c.created_at desc;
end;
';

grant execute on function public.get_my_clubs() to authenticated;

create or replace function public.get_my_club_point_history(p_club_id uuid)
returns table (
  point_log_id uuid,
  club_id uuid,
  user_id uuid,
  amount integer,
  reason text,
  game_id uuid,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as '
  select
    cp.point_log_id,
    cp.club_id,
    cp.user_id,
    cp.amount,
    cp.reason,
    cp.game_id,
    cp.created_at
  from public.club_points cp
  where cp.club_id = p_club_id
    and public.is_club_member(cp.club_id, auth.uid())
    and (
      public.is_club_admin(cp.club_id, auth.uid())
      or cp.user_id = auth.uid()
    )
  order by cp.created_at desc;
';

grant execute on function public.get_my_club_point_history(uuid) to authenticated;

create or replace function public.get_my_club_replays(p_club_id uuid)
returns table (
  replay_id uuid,
  club_id uuid,
  table_id uuid,
  game_id uuid,
  summary jsonb,
  initial_state jsonb,
  events jsonb,
  snapshots jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as '
  select
    r.replay_id,
    r.club_id,
    r.table_id,
    r.game_id,
    r.summary,
    r.initial_state,
    r.events,
    r.snapshots,
    r.created_at
  from public.replays r
  where r.club_id = p_club_id
    and public.is_club_member(r.club_id, auth.uid())
  order by r.created_at desc
  limit 300;
';

grant execute on function public.get_my_club_replays(uuid) to authenticated;

select 'patch_account_persistent_data_v2_no_dollar_ok' as result;
