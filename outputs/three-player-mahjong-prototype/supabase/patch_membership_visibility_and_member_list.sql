-- Fix approved club membership visibility and admin member listing.
-- Copy and run this whole file in Supabase SQL Editor.
-- This file intentionally uses SQL-language functions with single-quoted bodies.
-- It avoids PL/pgSQL variables and dollar-quoted bodies to reduce paste errors
-- in the Supabase Dashboard SQL Editor.

drop function if exists public.repair_my_approved_join_memberships();
drop function if exists public.get_my_clubs_visible();
drop function if exists public.list_club_members_for_admin(uuid);
drop function if exists public.list_my_join_requests();

alter table public.club_join_requests
  add column if not exists request_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists applicant_display_name text,
  add column if not exists applicant_login_id text,
  add column if not exists club_name text;

update public.club_join_requests r
set request_id = (
  substr(md5(r.club_id::text || ':' || r.user_id::text), 1, 8) || '-' ||
  substr(md5(r.club_id::text || ':' || r.user_id::text), 9, 4) || '-' ||
  substr(md5(r.club_id::text || ':' || r.user_id::text), 13, 4) || '-' ||
  substr(md5(r.club_id::text || ':' || r.user_id::text), 17, 4) || '-' ||
  substr(md5(r.club_id::text || ':' || r.user_id::text), 21, 12)
)::uuid
where r.request_id is null;

create unique index if not exists club_join_requests_request_id_idx
on public.club_join_requests(request_id);

create index if not exists club_join_requests_user_status_idx
on public.club_join_requests(user_id, status, created_at);

create index if not exists club_join_requests_club_status_idx
on public.club_join_requests(club_id, status, created_at);

create or replace function public.repair_my_approved_join_memberships()
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

create or replace function public.list_my_join_requests()
returns table (
  request_id uuid,
  club_id uuid,
  user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  applicant_display_name text,
  applicant_login_id text,
  club_name text,
  club_code text
)
language sql
security definer
set search_path = public
as '
  select
    r.request_id,
    r.club_id,
    r.user_id,
    r.status,
    r.created_at,
    r.updated_at,
    coalesce(r.applicant_display_name, u.display_name) as applicant_display_name,
    coalesce(r.applicant_login_id, u.login_id) as applicant_login_id,
    coalesce(r.club_name, c.name) as club_name,
    c.club_code
  from public.club_join_requests r
  join public.clubs c on c.club_id = r.club_id
  left join public.users u on u.user_id = r.user_id
  where r.user_id = auth.uid()
  order by r.created_at desc
';

grant execute on function public.list_my_join_requests() to authenticated;

create or replace function public.list_club_members_for_admin(p_club_id uuid)
returns table (
  club_id uuid,
  user_id uuid,
  role text,
  point_balance integer,
  joined_at timestamptz,
  display_name text,
  login_id text
)
language sql
security definer
set search_path = public
as '
  select
    m.club_id,
    m.user_id,
    m.role,
    m.point_balance,
    m.joined_at,
    u.display_name,
    u.login_id
  from public.club_members m
  left join public.users u on u.user_id = m.user_id
  join public.clubs c on c.club_id = m.club_id
  where m.club_id = p_club_id
    and auth.uid() is not null
    and (
      c.owner_user_id = auth.uid()
      or exists (
        select 1
        from public.club_members admin_member
        where admin_member.club_id = p_club_id
          and admin_member.user_id = auth.uid()
          and admin_member.role = ''admin''
      )
    )
  order by m.joined_at asc
';

grant execute on function public.list_club_members_for_admin(uuid) to authenticated;

select 'patch_membership_visibility_and_member_list_ok' as result;
