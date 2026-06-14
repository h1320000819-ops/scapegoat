-- Reliable club join request patch.
-- Copy and run this whole file in Supabase SQL Editor.
-- Important: this patch uses SQL functions only. It has no PL/pgSQL variables
-- and no dollar-quoted bodies, so Supabase Dashboard should not misread local
-- variables as table names.

drop function if exists public.submit_join_request(text);
drop function if exists public.list_join_requests_for_club(uuid);
drop function if exists public.approve_join_request(uuid);
drop function if exists public.reject_join_request(uuid);

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

create index if not exists club_join_requests_club_status_idx
on public.club_join_requests(club_id, status, created_at);

create or replace function public.submit_join_request(p_club_code_or_id text)
returns table (
  request_id uuid,
  club_id uuid,
  user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  applicant_display_name text,
  applicant_login_id text,
  club_name text
)
language sql
security definer
set search_path = public
as '
  with input_value as (
    select
      upper(trim(coalesce(p_club_code_or_id, ''''))) as search_text,
      case
        when trim(coalesce(p_club_code_or_id, '''')) ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''
          then trim(p_club_code_or_id)::uuid
        else null::uuid
      end as search_uuid
  ),
  target_club as (
    select c.club_id, c.name
    from public.clubs c
    cross join input_value i
    where c.club_id = i.search_uuid
       or upper(c.club_code) = i.search_text
       or upper(c.name) = i.search_text
    order by
      case
        when upper(c.club_code) = i.search_text then 0
        when c.club_id = i.search_uuid then 1
        else 2
      end,
      c.created_at desc
    limit 1
  ),
  current_user_profile as (
    select u.user_id, u.display_name, u.login_id
    from public.users u
    where u.user_id = auth.uid()
    limit 1
  ),
  upsert_request as (
    insert into public.club_join_requests (
      club_id,
      user_id,
      request_id,
      status,
      applicant_display_name,
      applicant_login_id,
      club_name,
      updated_at
    )
    select
      c.club_id,
      auth.uid(),
      (
        substr(md5(c.club_id::text || '':'' || auth.uid()::text), 1, 8) || ''-'' ||
        substr(md5(c.club_id::text || '':'' || auth.uid()::text), 9, 4) || ''-'' ||
        substr(md5(c.club_id::text || '':'' || auth.uid()::text), 13, 4) || ''-'' ||
        substr(md5(c.club_id::text || '':'' || auth.uid()::text), 17, 4) || ''-'' ||
        substr(md5(c.club_id::text || '':'' || auth.uid()::text), 21, 12)
      )::uuid,
      ''pending'',
      u.display_name,
      u.login_id,
      c.name,
      now()
    from target_club c
    left join current_user_profile u on true
    where auth.uid() is not null
      and not exists (
        select 1
        from public.club_members m
        where m.club_id = c.club_id
          and m.user_id = auth.uid()
      )
    on conflict (club_id, user_id) do update
    set status = case
        when public.club_join_requests.status = ''approved'' then ''approved''
        else ''pending''
      end,
      applicant_display_name = excluded.applicant_display_name,
      applicant_login_id = excluded.applicant_login_id,
      club_name = excluded.club_name,
      updated_at = now()
    returning
      public.club_join_requests.request_id,
      public.club_join_requests.club_id,
      public.club_join_requests.user_id,
      public.club_join_requests.status,
      public.club_join_requests.created_at,
      public.club_join_requests.updated_at,
      public.club_join_requests.applicant_display_name,
      public.club_join_requests.applicant_login_id,
      public.club_join_requests.club_name
  )
  select * from upsert_request
';

grant execute on function public.submit_join_request(text) to authenticated;

create or replace function public.list_join_requests_for_club(p_club_id uuid)
returns table (
  request_id uuid,
  club_id uuid,
  user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  applicant_display_name text,
  applicant_login_id text,
  club_name text
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
    coalesce(r.club_name, c.name) as club_name
  from public.club_join_requests r
  join public.clubs c
    on c.club_id = r.club_id
  left join public.users u
    on u.user_id = r.user_id
  where r.club_id = p_club_id
    and r.status = ''pending''
    and auth.uid() is not null
    and (
      c.owner_user_id = auth.uid()
      or exists (
        select 1
        from public.club_members m
        where m.club_id = p_club_id
          and m.user_id = auth.uid()
          and m.role = ''admin''
      )
    )
  order by r.created_at asc
';

grant execute on function public.list_join_requests_for_club(uuid) to authenticated;

create or replace function public.approve_join_request(p_request_id uuid)
returns table (
  request_id uuid,
  club_id uuid,
  user_id uuid,
  status text
)
language sql
security definer
set search_path = public
as '
  with target_request as (
    select r.request_id, r.club_id, r.user_id
    from public.club_join_requests r
    join public.clubs c
      on c.club_id = r.club_id
    where r.request_id = p_request_id
      and auth.uid() is not null
      and (
        c.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.club_members admin_member
          where admin_member.club_id = r.club_id
            and admin_member.user_id = auth.uid()
            and admin_member.role = ''admin''
        )
      )
  ),
  inserted_member as (
    insert into public.club_members (club_id, user_id, role, point_balance, joined_at)
    select
      target_request.club_id,
      target_request.user_id,
      ''member'',
      0,
      now()
    from target_request
    on conflict (club_id, user_id) do update
    set role = case
        when public.club_members.role = ''admin'' then ''admin''
        else ''member''
      end
    returning club_id, user_id
  ),
  updated_request as (
    update public.club_join_requests r
    set status = ''approved'',
        updated_at = now()
    from target_request
    where r.request_id = target_request.request_id
    returning r.request_id, r.club_id, r.user_id, r.status
  )
  select
    updated_request.request_id,
    updated_request.club_id,
    updated_request.user_id,
    updated_request.status
  from updated_request
';

grant execute on function public.approve_join_request(uuid) to authenticated;

create or replace function public.reject_join_request(p_request_id uuid)
returns table (
  request_id uuid,
  club_id uuid,
  user_id uuid,
  status text
)
language sql
security definer
set search_path = public
as '
  with target_request as (
    select r.request_id, r.club_id, r.user_id
    from public.club_join_requests r
    join public.clubs c
      on c.club_id = r.club_id
    where r.request_id = p_request_id
      and auth.uid() is not null
      and (
        c.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.club_members admin_member
          where admin_member.club_id = r.club_id
            and admin_member.user_id = auth.uid()
            and admin_member.role = ''admin''
        )
      )
  ),
  updated_request as (
    update public.club_join_requests r
    set status = ''rejected'',
        updated_at = now()
    from target_request
    where r.request_id = target_request.request_id
    returning r.request_id, r.club_id, r.user_id, r.status
  )
  select
    updated_request.request_id,
    updated_request.club_id,
    updated_request.user_id,
    updated_request.status
  from updated_request
';

grant execute on function public.reject_join_request(uuid) to authenticated;

select 'patch_join_requests_reliable_ok' as result;
