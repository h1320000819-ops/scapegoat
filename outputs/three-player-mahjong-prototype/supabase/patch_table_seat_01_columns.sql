-- 01: table lobby columns.
-- Run this whole file in Supabase SQL Editor.

alter table public.table_seats add column if not exists player_type text not null default 'empty';
alter table public.table_seats add column if not exists display_name text;
alter table public.tables add column if not exists is_debug boolean not null default false;

update public.table_seats
set player_type = case
  when user_id is not null then 'human'
  when player_type is null then 'empty'
  else player_type
end;

select 'patch_table_seat_01_columns_ok' as result;
