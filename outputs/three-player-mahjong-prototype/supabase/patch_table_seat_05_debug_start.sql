-- 05: debug table start RPC.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.start_debug_table_game(p_table_id uuid)
returns public.tables
as $anmika_start_debug_table_game$
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
$anmika_start_debug_table_game$
language plpgsql
security definer
set search_path = public;

grant execute on function public.start_debug_table_game(uuid) to authenticated;

select 'patch_table_seat_05_debug_start_ok' as result;
