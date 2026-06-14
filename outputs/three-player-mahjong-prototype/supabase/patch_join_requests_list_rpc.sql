-- 管理者用: 加入申請一覧を取得するRPC。
-- ドル引用($$)を使わない版です。Supabase SQL Editorへそのまま貼り付けて実行できます。
-- club_members の修復漏れがあっても、clubs.owner_user_id は管理者として扱います。

create or replace function public.list_join_requests_for_club(p_club_id uuid)
returns table (
  club_id uuid,
  user_id uuid,
  status text,
  created_at timestamptz,
  applicant_display_name text,
  applicant_login_id text
)
language sql
security definer
set search_path = public
as '
  select
    r.club_id,
    r.user_id,
    r.status,
    r.created_at,
    u.display_name as applicant_display_name,
    u.login_id as applicant_login_id
  from public.club_join_requests r
  left join public.users u
    on u.user_id = r.user_id
  join public.clubs c
    on c.club_id = r.club_id
  where r.club_id = p_club_id
    and r.status = ''pending''
    and (
      public.is_club_admin(p_club_id, auth.uid())
      or c.owner_user_id = auth.uid()
    )
  order by r.created_at asc
';

grant execute on function public.list_join_requests_for_club(uuid) to authenticated;

create or replace function public.approve_club_join_request(p_club_id uuid, p_user_id uuid, p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  if auth.uid() is null then
    raise exception ''login required'';
  end if;

  if p_admin_user_id <> auth.uid() then
    raise exception ''cannot approve as another user'';
  end if;

  if not exists (
    select 1
    from public.clubs c
    where c.club_id = p_club_id
      and (c.owner_user_id = auth.uid() or public.is_club_admin(p_club_id, auth.uid()))
  ) then
    raise exception ''admin required'';
  end if;

  insert into public.club_members (club_id, user_id, role, point_balance)
  values (p_club_id, p_user_id, ''member'', 0)
  on conflict (club_id, user_id) do update
  set role = case
    when public.club_members.role = ''admin'' then ''admin''
    else ''member''
  end;

  update public.club_join_requests
  set status = ''approved''
  where club_id = p_club_id and user_id = p_user_id;
end;
';

grant execute on function public.approve_club_join_request(uuid, uuid, uuid) to authenticated;

create or replace function public.reject_club_join_request(p_club_id uuid, p_user_id uuid, p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  if auth.uid() is null then
    raise exception ''login required'';
  end if;

  if p_admin_user_id <> auth.uid() then
    raise exception ''cannot reject as another user'';
  end if;

  if not exists (
    select 1
    from public.clubs c
    where c.club_id = p_club_id
      and (c.owner_user_id = auth.uid() or public.is_club_admin(p_club_id, auth.uid()))
  ) then
    raise exception ''admin required'';
  end if;

  update public.club_join_requests
  set status = ''rejected''
  where club_id = p_club_id and user_id = p_user_id;
end;
';

grant execute on function public.reject_club_join_request(uuid, uuid, uuid) to authenticated;

select 'patch_join_requests_list_rpc_ok' as result;
