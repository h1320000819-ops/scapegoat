-- Remove a club member by club admin.
-- This version intentionally avoids PL/pgSQL DECLARE variables.

drop function if exists public.remove_club_member(uuid, uuid);

create or replace function public.remove_club_member(
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
  select role, coalesce(point_balance, 0) as point_balance
  from public.club_members
  where club_id = p_club_id
    and user_id = p_member_user_id
  limit 1
),
removed_waiting as (
  delete from public.table_waiting_list
  where user_id = p_member_user_id
    and table_id in (select table_id from public.tables where club_id = p_club_id)
    and exists (select 1 from actor_admin)
    and exists (select 1 from target_member where role <> ''admin'')
  returning table_id
),
cleared_seats as (
  update public.table_seats
  set user_id = null,
      player_type = ''empty'',
      display_name = null
  where user_id = p_member_user_id
    and table_id in (select table_id from public.tables where club_id = p_club_id)
    and exists (select 1 from actor_admin)
    and exists (select 1 from target_member where role <> ''admin'')
  returning table_id
),
removed_member as (
  delete from public.club_members
  where club_id = p_club_id
    and user_id = p_member_user_id
    and exists (select 1 from actor_admin)
    and exists (select 1 from target_member where role <> ''admin'')
  returning user_id
),
audit_row as (
  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  select
    auth.uid(),
    ''remove_club_member'',
    ''club_member'',
    p_member_user_id,
    jsonb_build_object(
      ''clubId'', p_club_id,
      ''removedUserId'', p_member_user_id,
      ''returnedPointBalance'', (select point_balance from target_member)
    )
  where exists (select 1 from removed_member)
  returning audit_log_id
)
select
  case
    when auth.uid() is null then jsonb_build_object(''ok'', false, ''message'', ''login required'')
    when not exists (select 1 from actor_admin) then jsonb_build_object(''ok'', false, ''message'', ''admin required'')
    when p_member_user_id = auth.uid() then jsonb_build_object(''ok'', false, ''message'', ''cannot remove yourself'')
    when not exists (select 1 from target_member) then jsonb_build_object(''ok'', false, ''message'', ''member not found'')
    when exists (select 1 from target_member where role = ''admin'') then jsonb_build_object(''ok'', false, ''message'', ''cannot remove admin'')
    when exists (select 1 from removed_member) then jsonb_build_object(
      ''ok'', true,
      ''clubId'', p_club_id,
      ''removedUserId'', p_member_user_id,
      ''returnedPointBalance'', (select point_balance from target_member)
    )
    else jsonb_build_object(''ok'', false, ''message'', ''not removed'')
  end;
';

grant execute on function public.remove_club_member(uuid, uuid) to authenticated;

select 'patch_remove_club_member_rpc_ok' as result;
