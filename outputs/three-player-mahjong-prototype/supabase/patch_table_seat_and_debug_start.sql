-- Anmika Rocket: stable lobby seat/debug RPCs.
-- Run this whole file in Supabase SQL Editor.
-- It fixes seat, CPU add/remove, and debug start actions through SECURITY DEFINER RPCs.

alter table public.table_seats add column if not exists player_type text not null default 'empty';
alter table public.table_seats add column if not exists display_name text;
alter table public.tables add column if not exists is_debug boolean not null default false;

drop function if exists public.sit_at_table(uuid);
drop function if exists public.sit_at_table(uuid, smallint, uuid);

create or replace function public.sit_at_table(p_table_id uuid)
returns setof public.table_seats
as $$
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
    select 1 from public.table_seats
    where table_id = p_table_id and user_id = auth.uid()
  ) then
    return query
    select * from public.table_seats
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
  where table_id = p_table_id and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.sit_at_table(uuid) to authenticated;

create or replace function public.refresh_table_lobby_status(p_table_id uuid)
returns public.tables
as $$
declare
  v_table public.tables;
  v_filled_count integer;
  v_cpu_count integer;
begin
  select count(*) into v_filled_count
  from public.table_seats
  where table_id = p_table_id
    and (user_id is not null or player_type = 'cpu');

  select count(*) into v_cpu_count
  from public.table_seats
  where table_id = p_table_id and player_type = 'cpu';

  update public.tables
  set is_debug = v_cpu_count > 0,
      status = case
        when status = 'playing' then status
        else 'waiting'
      end
  where table_id = p_table_id
  returning * into v_table;

  return v_table;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.refresh_table_lobby_status(uuid) to authenticated;

create or replace function public.leave_table(p_table_id uuid)
returns setof public.table_seats
as $$
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
  where table_id = p_table_id and user_id = auth.uid();

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.leave_table(uuid) to authenticated;

create or replace function public.add_debug_cpu_to_table(p_table_id uuid)
returns setof public.table_seats
as $$
declare
  v_table public.tables;
  v_seat_index smallint;
  v_cpu_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_table
  from public.tables
  where table_id = p_table_id;

  if v_table.table_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_admin(v_table.club_id, auth.uid()) then
    raise exception 'admin required';
  end if;

  select count(*) into v_cpu_count
  from public.table_seats
  where table_id = p_table_id and player_type = 'cpu';

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id
    and user_id is null
    and player_type = 'empty'
  order by seat_index asc
  limit 1;

  if v_seat_index is null then
    raise exception 'no empty seat';
  end if;

  update public.table_seats
  set player_type = 'cpu',
      display_name = 'CPU' || (v_cpu_count + 1)::text,
      updated_at = now()
  where table_id = p_table_id and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.add_debug_cpu_to_table(uuid) to authenticated;

create or replace function public.remove_debug_cpu_from_table(p_table_id uuid)
returns setof public.table_seats
as $$
declare
  v_table public.tables;
  v_seat_index smallint;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_table
  from public.tables
  where table_id = p_table_id;

  if v_table.table_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_admin(v_table.club_id, auth.uid()) then
    raise exception 'admin required';
  end if;

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id and player_type = 'cpu'
  order by seat_index desc
  limit 1;

  if v_seat_index is null then
    raise exception 'no cpu seat';
  end if;

  update public.table_seats
  set player_type = 'empty',
      display_name = null,
      updated_at = now()
  where table_id = p_table_id and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.remove_debug_cpu_from_table(uuid) to authenticated;

create or replace function public.start_debug_table_game(p_table_id uuid)
returns public.tables
as $$
declare
  v_table public.tables;
  v_filled_count integer;
  v_cpu_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_table
  from public.tables
  where table_id = p_table_id
  for update;

  if v_table.table_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_admin(v_table.club_id, auth.uid()) then
    raise exception 'admin required';
  end if;

  select
    count(*) filter (where user_id is not null or player_type = 'cpu'),
    count(*) filter (where player_type = 'cpu')
  into v_filled_count, v_cpu_count
  from public.table_seats
  where table_id = p_table_id;

  if v_filled_count < 3 then
    raise exception 'not enough players';
  end if;

  if v_cpu_count = 0 then
    raise exception 'debug start requires cpu';
  end if;

  update public.tables
  set status = 'playing',
      is_debug = true
  where table_id = p_table_id
  returning * into v_table;

  return v_table;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.start_debug_table_game(uuid) to authenticated;

select 'patch_table_seat_and_debug_start_ok' as result;
