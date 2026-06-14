-- Admin table deletion RPC.
-- Run this whole file in the Supabase SQL Editor.
-- Replays, point transactions, rake logs, and audit logs are intentionally kept.

drop function if exists public.delete_table_for_admin(uuid);

create or replace function public.delete_table_for_admin(p_table_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as '
  with target_table as (
    select t.table_id
    from public.tables t
    where t.table_id = p_table_id
      and auth.uid() is not null
      and public.is_club_admin(t.club_id, auth.uid())
    limit 1
  ),
  deleted_waiting as (
    delete from public.table_waiting_list w
    where w.table_id in (select table_id from target_table)
    returning w.table_id
  ),
  deleted_seats as (
    delete from public.table_seats s
    where s.table_id in (select table_id from target_table)
    returning s.table_id
  ),
  deleted_events as (
    delete from public.game_events e
    where e.table_id in (select table_id from target_table)
    returning e.event_id
  ),
  deleted_states as (
    delete from public.game_states gs
    where gs.table_id in (select table_id from target_table)
    returning gs.game_id
  ),
  deleted_games as (
    delete from public.games g
    where g.table_id in (select table_id from target_table)
    returning g.game_id
  ),
  deleted_table as (
    delete from public.tables t
    where t.table_id in (select table_id from target_table)
    returning t.table_id
  )
  select case
    when exists (select 1 from deleted_table) then jsonb_build_object(''ok'', true, ''tableId'', p_table_id)
    else jsonb_build_object(''ok'', false, ''message'', ''卓が見つからない、または削除権限がありません。'')
  end
';

grant execute on function public.delete_table_for_admin(uuid) to authenticated;

select 'patch_delete_table_for_admin_ok' as result;
