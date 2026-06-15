-- Grant club admin privilege to an existing club member.
-- This version intentionally avoids PL/pgSQL DECLARE variables.

drop function if exists public.grant_club_admin_role(uuid, uuid);

create or replace function public.grant_club_admin_role(
  p_club_id uuid,
  p_member_user_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
as '
with
actor_admin as (
  select 1 as ok
  from public.club_members
  where club_id = p_club_id
    and user_id = auth.uid()
    and role = ''admin''
  limit 1
),
target_member as (
  select role
  from public.club_members
  where club_id = p_club_id
    and user_id = p_member_user_id
  limit 1
),
updated_member as (
  update public.club_members
  set role = ''admin''
  where club_id = p_club_id
    and user_id = p_member_user_id
    and exists (select 1 from actor_admin)
    and exists (select 1 from target_member)
  returning user_id
),
audit_row as (
  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  select
    auth.uid(),
    ''grant_club_admin_role'',
    ''club_member'',
    p_member_user_id,
    jsonb_build_object(
      ''clubId'', p_club_id,
      ''targetUserId'', p_member_user_id,
      ''previousRole'', (select role from target_member)
    )
  where exists (select 1 from updated_member)
  returning audit_log_id
)
select
  case
    when auth.uid() is null then jsonb_build_object(''ok'', false, ''message'', ''login required'')
    when not exists (select 1 from actor_admin) then jsonb_build_object(''ok'', false, ''message'', ''admin required'')
    when not exists (select 1 from target_member) then jsonb_build_object(''ok'', false, ''message'', ''member not found'')
    when exists (select 1 from updated_member) then jsonb_build_object(
      ''ok'', true,
      ''clubId'', p_club_id,
      ''targetUserId'', p_member_user_id,
      ''role'', ''admin''
    )
    else jsonb_build_object(''ok'', false, ''message'', ''not updated'')
  end;
';

grant execute on function public.grant_club_admin_role(uuid, uuid) to authenticated;

select 'patch_grant_club_admin_role_ok' as result;
