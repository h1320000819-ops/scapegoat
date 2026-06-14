-- Anmika Rocket: add "ツモ損なし全赤三麻" table rule config.
-- Run this whole file in Supabase SQL Editor.
-- This file intentionally avoids dollar-quoted function bodies.

alter table public.tables
  add column if not exists rule_config jsonb not null default '{}'::jsonb;

alter table public.tables
  add column if not exists entry_rake_points numeric(4, 1) not null default 0;

drop function if exists public.create_table_with_seats(uuid, text, text, numeric, numeric);
drop function if exists public.create_table_with_seats(uuid, text, text, numeric, numeric, jsonb);

create or replace function public.create_table_with_seats(
  p_club_id uuid,
  p_name text,
  p_rule_id text default 'anmika-rocket',
  p_point_rate numeric default 1.0,
  p_rake_percent numeric default 5.0,
  p_rule_config jsonb default '{}'::jsonb
)
returns public.tables
language sql
security definer
set search_path = public
as '
  with inserted_table as (
    insert into public.tables (
      club_id,
      name,
      status,
      rule_id,
      point_rate,
      rake_percent,
      rule_config,
      entry_rake_points,
      created_by
    )
    select
      p_club_id,
      coalesce(
        nullif(trim(coalesce(p_name, '''')), ''''),
        case
          when coalesce(nullif(p_rule_id, ''''), ''anmika-rocket'') = ''tsumo-lossless-red-3ma''
            then ''ツモ損なし全赤三麻卓''
          else ''アンミカロケット卓''
        end
      ),
      ''waiting'',
      coalesce(nullif(p_rule_id, ''''), ''anmika-rocket''),
      coalesce(p_point_rate, 1.0),
      coalesce(p_rake_percent, 0),
      coalesce(p_rule_config, ''{}''::jsonb),
      case
        when coalesce(nullif(p_rule_id, ''''), ''anmika-rocket'') = ''tsumo-lossless-red-3ma''
          then coalesce(nullif(p_rule_config->>''entryRakePoints'', '''')::numeric, 5.0)
        else 0
      end,
      auth.uid()
    where auth.uid() is not null
      and p_club_id is not null
      and public.is_club_admin(p_club_id, auth.uid())
    returning *
  ),
  inserted_seats as (
    insert into public.table_seats (table_id, seat_index, player_type)
    select inserted_table.table_id, seat_index, ''empty''
    from inserted_table
    cross join (values (0::smallint), (1::smallint), (2::smallint)) as seats(seat_index)
    on conflict (table_id, seat_index) do nothing
  )
  select *
  from inserted_table
  limit 1
';

grant execute on function public.create_table_with_seats(uuid, text, text, numeric, numeric, jsonb) to authenticated;

-- Optional smoke test after creating a table through the app:
-- select table_id, rule_id, point_rate, rake_percent, entry_rake_points, rule_config from public.tables order by created_at desc limit 5;

select 'patch_tsumo_lossless_3ma_rule_ok' as result;
