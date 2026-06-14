-- 04a: add debug CPU RPC.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.add_debug_cpu_to_table(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_table public.tables;
  v_seat_index smallint;
  v_cpu_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_table from public.tables where table_id = p_table_id;
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
  where table_id = p_table_id and user_id is null and player_type = 'empty'
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
$function$;

grant execute on function public.add_debug_cpu_to_table(uuid) to authenticated;

select 'patch_table_seat_04a_add_cpu_ok' as result;
