-- Join request RPC + RLS repair.
-- Copy and run this whole file in Supabase SQL Editor.
-- This patch is intentionally SQL-only and does not use PL/pgSQL variables.

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

alter table public.club_join_requests enable row level security;

drop policy if exists "join requests own insert" on public.club_join_requests;
drop policy if exists "join requests visible to self or admins" on public.club_join_requests;
drop policy if exists "join requests own update" on public.club_join_requests;
drop policy if exists "join requests admins update" on public.club_join_requests;

create policy "join requests own insert"
on public.club_join_requests
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "join requests visible to self or admins"
on public.club_join_requests
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.clubs c
    where c.club_id = public.club_join_requests.club_id
      and c.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.club_members m
    where m.club_id = public.club_join_requests.club_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  )
);

create policy "join requests own update"
on public.club_join_requests
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "join requests admins update"
on public.club_join_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.clubs c
    where c.club_id = public.club_join_requests.club_id
      and c.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.club_members m
    where m.club_id = public.club_join_requests.club_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.clubs c
    where c.club_id = public.club_join_requests.club_id
      and c.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.club_members m
    where m.club_id = public.club_join_requests.club_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  )
);

drop function if exists public.submit_join_request(text);

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
    select u.display_name, u.login_id
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
      coalesce(u.display_name, ''''),
      coalesce(u.login_id, ''''),
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

select 'patch_join_requests_rls_and_rpc_ok' as result;
