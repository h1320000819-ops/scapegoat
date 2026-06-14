-- 02: refresh table lobby status RPC.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.refresh_table_lobby_status(p_table_id uuid)
returns public.tables
as $anmika_refresh_table_lobby_status$
declare
  v_table public.tables;
  v_cpu_count integer;
begin
  select count(*) into v_cpu_count
  from public.table_seats
  where table_id = p_table_id
    and player_type = 'cpu';

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
$anmika_refresh_table_lobby_status$
language plpgsql
security definer
set search_path = public;

grant execute on function public.refresh_table_lobby_status(uuid) to authenticated;

select 'patch_table_seat_02_refresh_status_ok' as result;
