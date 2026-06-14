-- Anmika Rocket: create table with seats RPC.
-- Run this whole file in Supabase SQL Editor.
-- This avoids direct browser inserts into public.tables/public.table_seats,
-- which can be blocked by Row Level Security.

drop function if exists public.create_table_with_seats(uuid, text, text, numeric, numeric);

create or replace function public.create_table_with_seats(
  p_club_id uuid,
  p_name text,
  p_rule_id text default 'anmika-rocket',
  p_point_rate numeric default 1.0,
  p_rake_percent numeric default 5.0
)
returns public.tables
as $$
declare
  v_table public.tables;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if p_club_id is null then
    raise exception 'club required';
  end if;

  if not public.is_club_admin(p_club_id, auth.uid()) then
    raise exception 'admin required';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    v_name := 'Anmika Rocket Table';
  end if;

  insert into public.tables (
    club_id,
    name,
    status,
    rule_id,
    point_rate,
    rake_percent,
    created_by
  )
  values (
    p_club_id,
    v_name,
    'waiting',
    coalesce(nullif(p_rule_id, ''), 'anmika-rocket'),
    coalesce(p_point_rate, 1.0),
    coalesce(p_rake_percent, 5.0),
    auth.uid()
  )
  returning * into v_table;

  insert into public.table_seats (table_id, seat_index, player_type)
  values
    (v_table.table_id, 0, 'empty'),
    (v_table.table_id, 1, 'empty'),
    (v_table.table_id, 2, 'empty');

  return v_table;
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.create_table_with_seats(uuid, text, text, numeric, numeric) to authenticated;

select 'patch_create_table_with_seats_ok' as result;
