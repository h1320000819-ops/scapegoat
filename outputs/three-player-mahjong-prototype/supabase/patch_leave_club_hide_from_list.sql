-- Fix club leave behavior.
-- Run this whole file in the Supabase SQL Editor.
-- Point history, rake logs, replays, and audit logs are intentionally kept.

drop function if exists public.leave_club(uuid);

create or replace function public.leave_club(p_club_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as '
  with membership as (
    select m.club_id, m.user_id, m.role
    from public.club_members m
    where m.club_id = p_club_id
      and m.user_id = auth.uid()
      and auth.uid() is not null
    limit 1
  ),
  allowed as (
    select *
    from membership
    where coalesce(role, ''member'') <> ''admin''
  ),
  removed_waiting as (
    delete from public.table_waiting_list w
    using public.tables t, allowed a
    where w.table_id = t.table_id
      and t.club_id = a.club_id
      and w.user_id = a.user_id
    returning w.table_id
  ),
  removed_seats as (
    delete from public.table_seats s
    using public.tables t, allowed a
    where s.table_id = t.table_id
      and t.club_id = a.club_id
      and s.user_id = a.user_id
      and coalesce(t.status, ''waiting'') <> ''playing''
    returning s.table_id
  ),
  updated_requests as (
    update public.club_join_requests r
    set status = ''rejected'',
        updated_at = now()
    from allowed a
    where r.club_id = a.club_id
      and r.user_id = a.user_id
      and r.status in (''pending'', ''approved'')
    returning r.request_id
  ),
  removed_member as (
    delete from public.club_members m
    using allowed a
    where m.club_id = a.club_id
      and m.user_id = a.user_id
    returning m.club_id
  )
  select case
    when exists (select 1 from removed_member) then jsonb_build_object(''ok'', true, ''clubId'', p_club_id)
    when exists (select 1 from membership where role = ''admin'') then jsonb_build_object(''ok'', false, ''message'', ''admin club cannot be left'')
    else jsonb_build_object(''ok'', false, ''message'', ''club membership not found'')
  end
';

grant execute on function public.leave_club(uuid) to authenticated;

select 'patch_leave_club_hide_from_list_ok' as result;
