-- 03: sit and leave RPCs.
-- Run this whole file in Supabase SQL Editor.

drop function if exists public.sit_at_table(uuid);
drop function if exists public.sit_at_table(uuid, smallint, uuid);

create or replace function public.sit_at_table(p_table_id uuid)
returns setof public.table_seats
as $anmika_sit_at_table$
declare
  v_club_id uuid;
  v_seat_index smallint;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select club_id into v_club_id
  from public.tables
  where table_id = p_table_id;

  if v_club_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_club_id, auth.uid()) then
    raise exception 'not club member';
  end if;

  if exists (
    select 1
    from public.table_seats
    where table_id = p_table_id
      and user_id = auth.uid()
  ) then
    return query
    select *
    from public.table_seats
    where table_id = p_table_id
    order by seat_index asc;
    return;
  end if;

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id
    and (user_id is null or player_type = 'cpu')
    and player_type in ('empty', 'cpu')
  order by case when player_type = 'empty' then 0 else 1 end, seat_index asc
  limit 1;

  if v_seat_index is null then
    raise exception 'no empty seat';
  end if;

  update public.table_seats
  set user_id = auth.uid(),
      player_type = 'human',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id
    and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_sit_at_table$
language plpgsql
security definer
set search_path = public;

grant execute on function public.sit_at_table(uuid) to authenticated;

create or replace function public.leave_table(p_table_id uuid)
returns setof public.table_seats
as $anmika_leave_table$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  update public.table_seats
  set user_id = null,
      player_type = 'empty',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id
    and user_id = auth.uid();

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_leave_table$
language plpgsql
security definer
set search_path = public;

grant execute on function public.leave_table(uuid) to authenticated;

select 'patch_table_seat_03_sit_leave_ok' as result;
