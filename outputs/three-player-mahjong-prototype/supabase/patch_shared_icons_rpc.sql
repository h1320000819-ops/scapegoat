-- Share account and club icons across pages/accounts.
-- Run this whole file in the Supabase SQL Editor.

alter table public.users add column if not exists icon_url text;
alter table public.clubs add column if not exists icon_url text;
alter table public.users add column if not exists updated_at timestamptz not null default now();
alter table public.clubs add column if not exists updated_at timestamptz not null default now();

drop function if exists public.update_my_icon(text);
drop function if exists public.update_club_icon(uuid, text);
drop function if exists public.repair_my_approved_join_memberships();
drop function if exists public.get_my_clubs_visible();
drop function if exists public.get_my_clubs();
drop function if exists public.list_club_members_for_admin(uuid);

create or replace function public.update_my_icon(p_icon_url text)
returns setof public.users
language sql
security definer
set search_path = public
as '
  update public.users u
  set icon_url = nullif(p_icon_url, ''''),
      updated_at = now()
  where u.user_id = auth.uid()
  returning u.*
';

grant execute on function public.update_my_icon(text) to authenticated;

create or replace function public.update_club_icon(p_club_id uuid, p_icon_url text)
returns setof public.clubs
language sql
security definer
set search_path = public
as '
  update public.clubs c
  set icon_url = nullif(p_icon_url, ''''),
      updated_at = now()
  where c.club_id = p_club_id
    and auth.uid() is not null
    and public.is_club_admin(c.club_id, auth.uid())
  returning c.*
';

grant execute on function public.update_club_icon(uuid, text) to authenticated;

create or replace function public.repair_my_approved_join_memberships()
returns table (
  club_id uuid,
  club_code text,
  name text,
  icon_url text,
  owner_user_id uuid,
  role text,
  point_balance integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as '
  with repaired as (
    insert into public.club_members (club_id, user_id, role, point_balance, joined_at)
    select r.club_id, auth.uid(), ''member'', 0, now()
    from public.club_join_requests r
    where auth.uid() is not null
      and r.user_id = auth.uid()
      and r.status = ''approved''
    on conflict (club_id, user_id) do update
    set role = case
        when public.club_members.role = ''admin'' then ''admin''
        else ''member''
      end
    returning club_id, user_id, role, point_balance
  )
  select distinct on (club_rows.club_id)
    club_rows.club_id,
    club_rows.club_code,
    club_rows.name,
    club_rows.icon_url,
    club_rows.owner_user_id,
    club_rows.role,
    club_rows.point_balance,
    club_rows.created_at,
    club_rows.updated_at
  from (
    select
      c.club_id,
      c.club_code,
      c.name,
      c.icon_url,
      c.owner_user_id,
      case when m.role = ''admin'' then ''admin'' else ''member'' end as role,
      coalesce(m.point_balance, 0) as point_balance,
      c.created_at,
      c.updated_at,
      case when m.role = ''admin'' then 0 else 1 end as role_rank
    from public.club_members m
    join public.clubs c on c.club_id = m.club_id
    where m.user_id = auth.uid()

    union all

    select
      c.club_id,
      c.club_code,
      c.name,
      c.icon_url,
      c.owner_user_id,
      ''admin'' as role,
      0 as point_balance,
      c.created_at,
      c.updated_at,
      0 as role_rank
    from public.clubs c
    where c.owner_user_id = auth.uid()

    union all

    select
      c.club_id,
      c.club_code,
      c.name,
      c.icon_url,
      c.owner_user_id,
      ''member'' as role,
      0 as point_balance,
      c.created_at,
      c.updated_at,
      2 as role_rank
    from public.club_join_requests r
    join public.clubs c on c.club_id = r.club_id
    where r.user_id = auth.uid()
      and r.status = ''approved''
  ) club_rows
  order by club_rows.club_id, club_rows.role_rank asc, club_rows.created_at desc
';

grant execute on function public.repair_my_approved_join_memberships() to authenticated;

create or replace function public.get_my_clubs_visible()
returns table (
  club_id uuid,
  club_code text,
  name text,
  icon_url text,
  owner_user_id uuid,
  role text,
  point_balance integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as '
  select * from public.repair_my_approved_join_memberships()
';

grant execute on function public.get_my_clubs_visible() to authenticated;

create or replace function public.get_my_clubs()
returns table (
  club_id uuid,
  club_code text,
  name text,
  icon_url text,
  owner_user_id uuid,
  role text,
  point_balance integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as '
  select * from public.repair_my_approved_join_memberships()
';

grant execute on function public.get_my_clubs() to authenticated;

create or replace function public.list_club_members_for_admin(p_club_id uuid)
returns table (
  user_id uuid,
  display_name text,
  login_id text,
  icon_url text,
  role text,
  point_balance integer,
  joined_at timestamptz
)
language sql
security definer
set search_path = public
as '
  select
    u.user_id,
    u.display_name,
    u.login_id,
    u.icon_url,
    m.role,
    coalesce(m.point_balance, 0) as point_balance,
    m.joined_at
  from public.club_members m
  join public.users u on u.user_id = m.user_id
  where m.club_id = p_club_id
    and auth.uid() is not null
    and (
      public.is_club_admin(p_club_id, auth.uid())
      or m.user_id = auth.uid()
    )
  order by m.joined_at asc
';

grant execute on function public.list_club_members_for_admin(uuid) to authenticated;

select 'patch_shared_icons_rpc_ok' as result;
