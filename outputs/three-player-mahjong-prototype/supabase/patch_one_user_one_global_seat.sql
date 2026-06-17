-- Enforce one account = one seat across all tables.
-- Run this whole file in Supabase SQL Editor.
-- Pressed seat wins: when a user sits, every other seat held by that user is released.

drop function if exists public.shared_sit_at_table(uuid, integer);

create or replace function public.shared_sit_at_table(p_table_id uuid, p_seat_index integer)
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
      and t.status <> ''ended''
      and auth.uid() is not null
      and exists (
        select 1
        from public.club_members m
        where m.club_id = t.club_id
          and m.user_id = auth.uid()
      )
  ),
  target_seat as (
    select s.table_id, s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where (
        (p_seat_index is not null and s.seat_index = p_seat_index)
        or p_seat_index is null
      )
      and (
        s.user_id is null
        or s.player_type = ''cpu''
        or s.user_id = auth.uid()
      )
      and s.player_type in (''empty'', ''cpu'', ''human'')
    order by
      case when p_seat_index is not null and s.seat_index = p_seat_index then 0 else 1 end,
      case when s.user_id = auth.uid() then 0 when s.player_type = ''empty'' then 1 else 2 end,
      s.seat_index asc
    limit 1
  ),
  released_other_seats as (
    update public.table_seats s
    set user_id = null,
        player_type = ''empty'',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat ts
    where s.user_id = auth.uid()
      and not (s.table_id = ts.table_id and s.seat_index = ts.seat_index)
    returning s.table_id
  ),
  updated_seat as (
    update public.table_seats s
    set user_id = auth.uid(),
        player_type = ''human'',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat ts
    where s.table_id = ts.table_id
      and s.seat_index = ts.seat_index
    returning s.table_id
  ),
  refreshed_released_tables as (
    update public.tables t
    set is_debug = exists (
          select 1 from public.table_seats s
          where s.table_id = t.table_id and s.player_type = ''cpu''
        ),
        status = case
          when t.status = ''playing'' then t.status
          when (
            select count(*)
            from public.table_seats s
            where s.table_id = t.table_id
              and (s.user_id is not null or s.player_type = ''cpu'')
          ) >= 3 then ''playing''
          else ''waiting''
        end
    where t.table_id in (select table_id from released_other_seats)
    returning t.table_id
  ),
  refreshed_target_table as (
    update public.tables t
    set is_debug = exists (
          select 1 from public.table_seats s
          where s.table_id = p_table_id and s.player_type = ''cpu''
        ),
        status = case
          when t.status = ''playing'' then t.status
          when (
            select count(*)
            from public.table_seats s
            where s.table_id = p_table_id
              and (s.user_id is not null or s.player_type = ''cpu'')
          ) >= 3 then ''playing''
          else ''waiting''
        end
    where t.table_id = p_table_id
      and exists (select 1 from updated_seat)
    returning t.table_id
  )
  select * from public.shared_get_table_seats(p_table_id)
';

grant execute on function public.shared_sit_at_table(uuid, integer) to authenticated;

select 'patch_one_user_one_global_seat_ok' as result;
