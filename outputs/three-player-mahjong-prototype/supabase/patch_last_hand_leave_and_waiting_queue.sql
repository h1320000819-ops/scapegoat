-- Fix last-hand table loop.
-- Run this whole file in Supabase SQL Editor.
-- This patch avoids dollar-quoted bodies so the dashboard will not corrupt PL/pgSQL blocks.

drop function if exists public.resolve_last_hand_and_waiting_queue(uuid);

create or replace function public.resolve_last_hand_and_waiting_queue(p_table_id uuid)
returns table (
  table_id uuid,
  seat_index smallint,
  user_id uuid,
  player_type text,
  display_name text,
  is_last_hand_declared boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as '
  with target_table as (
    select t.*
    from public.tables t
    where t.table_id = p_table_id
      and auth.uid() is not null
      and exists (
        select 1
        from public.club_members m
        where m.club_id = t.club_id
          and m.user_id = auth.uid()
      )
  ),
  leavers as (
    select s.user_id, s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where s.is_last_hand_declared = true
      and s.user_id is not null
      and s.player_type = ''human''
  ),
  free_seats as (
    select
      s.seat_index,
      row_number() over (order by s.seat_index asc) as rn
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where (s.user_id is null and s.player_type in (''empty'', ''cpu''))
       or exists (select 1 from leavers l where l.seat_index = s.seat_index)
  ),
  already_staying as (
    select s.user_id
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where s.user_id is not null
      and s.player_type = ''human''
      and not exists (select 1 from leavers l where l.user_id = s.user_id)
  ),
  waiting_order as (
    select
      w.user_id,
      row_number() over (order by w.created_at asc, w.user_id asc) as rn
    from public.table_waiting_list w
    join target_table t on t.table_id = w.table_id
    where not exists (select 1 from leavers l where l.user_id = w.user_id)
      and not exists (select 1 from already_staying a where a.user_id = w.user_id)
  ),
  promotions as (
    select f.seat_index, w.user_id
    from free_seats f
    join waiting_order w on w.rn = f.rn
  ),
  updated_seats as (
    update public.table_seats s
    set user_id = p.user_id,
        player_type = case when p.user_id is null then ''empty'' else ''human'' end,
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from (
      select f.seat_index, p.user_id
      from free_seats f
      left join promotions p on p.seat_index = f.seat_index
    ) p
    where s.table_id = p_table_id
      and s.seat_index = p.seat_index
    returning s.table_id
  ),
  cleared_waiting as (
    delete from public.table_waiting_list w
    where w.table_id = p_table_id
      and (
        exists (select 1 from leavers l where l.user_id = w.user_id)
        or exists (select 1 from promotions p where p.user_id = w.user_id)
      )
    returning w.table_id
  ),
  refreshed_table as (
    update public.tables t
    set status = case
          when (
            select count(*)
            from public.table_seats s
            where s.table_id = p_table_id
              and (s.user_id is not null or s.player_type = ''cpu'')
          ) >= 3 then ''playing''
          else ''waiting''
        end,
        is_debug = exists (
          select 1
          from public.table_seats s
          where s.table_id = p_table_id
            and s.player_type = ''cpu''
        )
    where t.table_id = p_table_id
    returning t.table_id
  )
  select
    s.table_id,
    s.seat_index,
    s.user_id,
    s.player_type,
    coalesce(s.display_name, u.display_name) as display_name,
    s.is_last_hand_declared,
    s.updated_at
  from public.table_seats s
  left join public.users u on u.user_id = s.user_id
  where s.table_id = p_table_id
  order by s.seat_index asc
';

grant execute on function public.resolve_last_hand_and_waiting_queue(uuid) to authenticated;

select 'patch_last_hand_leave_and_waiting_queue_ok' as result;
