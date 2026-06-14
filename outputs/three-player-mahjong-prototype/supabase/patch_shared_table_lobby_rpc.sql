-- Shared table lobby RPCs for cross-browser / cross-device table state.
-- Copy and run this whole file in Supabase SQL Editor.
-- SQL-language only. No PL/pgSQL variables and no dollar-quoted bodies.

alter table public.tables
  add column if not exists rule_config jsonb not null default '{}'::jsonb;

alter table public.tables
  add column if not exists entry_rake_points numeric(4, 1) not null default 0;

drop function if exists public.shared_list_tables_for_club(uuid);
drop function if exists public.shared_get_table_seats(uuid);
drop function if exists public.shared_sit_at_table(uuid, integer);
drop function if exists public.shared_add_debug_cpu_to_table(uuid);
drop function if exists public.shared_remove_debug_cpu_from_table(uuid);
drop function if exists public.shared_start_debug_table_game(uuid);
drop function if exists public.shared_set_last_hand(uuid, boolean);

create or replace function public.shared_list_tables_for_club(p_club_id uuid)
returns table (
  table_id uuid,
  club_id uuid,
  name text,
  status text,
  rule_id text,
  point_rate numeric,
  rake_percent numeric,
  rule_config jsonb,
  entry_rake_points numeric,
  created_by uuid,
  created_at timestamptz,
  is_debug boolean,
  table_seats jsonb
)
language sql
security definer
set search_path = public
as '
  select
    t.table_id,
    t.club_id,
    t.name,
    t.status,
    t.rule_id,
    t.point_rate,
    t.rake_percent,
    coalesce(t.rule_config, ''{}''::jsonb) as rule_config,
    coalesce(t.entry_rake_points, 0) as entry_rake_points,
    t.created_by,
    t.created_at,
    coalesce(t.is_debug, false) as is_debug,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          ''table_id'', s.table_id,
          ''seat_index'', s.seat_index,
          ''user_id'', s.user_id,
          ''player_type'', s.player_type,
          ''display_name'', coalesce(s.display_name, u.display_name),
          ''is_last_hand_declared'', s.is_last_hand_declared,
          ''updated_at'', s.updated_at
        )
        order by s.seat_index asc
      ) filter (where s.table_id is not null),
      ''[]''::jsonb
    ) as table_seats
  from public.tables t
  left join public.table_seats s on s.table_id = t.table_id
  left join public.users u on u.user_id = s.user_id
  where t.club_id = p_club_id
    and auth.uid() is not null
    and exists (
      select 1
      from public.club_members m
      where m.club_id = p_club_id
        and m.user_id = auth.uid()
    )
  group by t.table_id
  order by t.created_at desc
';

grant execute on function public.shared_list_tables_for_club(uuid) to authenticated;

create or replace function public.shared_get_table_seats(p_table_id uuid)
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
  select
    s.table_id,
    s.seat_index,
    s.user_id,
    s.player_type,
    coalesce(s.display_name, u.display_name) as display_name,
    s.is_last_hand_declared,
    s.updated_at
  from public.table_seats s
  join public.tables t on t.table_id = s.table_id
  left join public.users u on u.user_id = s.user_id
  where s.table_id = p_table_id
    and auth.uid() is not null
    and exists (
      select 1
      from public.club_members m
      where m.club_id = t.club_id
        and m.user_id = auth.uid()
    )
  order by s.seat_index asc
';

grant execute on function public.shared_get_table_seats(uuid) to authenticated;

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
  already_seated as (
    select s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where s.user_id = auth.uid()
    limit 1
  ),
  target_seat as (
    select s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where not exists (select 1 from already_seated)
      and (
        (p_seat_index is not null and s.seat_index = p_seat_index)
        or p_seat_index is null
      )
      and (s.user_id is null or s.player_type = ''cpu'')
      and s.player_type in (''empty'', ''cpu'')
    order by
      case when p_seat_index is not null and s.seat_index = p_seat_index then 0 else 1 end,
      case when s.player_type = ''empty'' then 0 else 1 end,
      s.seat_index asc
    limit 1
  ),
  updated_seat as (
    update public.table_seats s
    set user_id = auth.uid(),
        player_type = ''human'',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat
    where s.table_id = p_table_id
      and s.seat_index = target_seat.seat_index
    returning s.table_id
  ),
  refreshed_table as (
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
    returning t.table_id
  )
  select * from public.shared_get_table_seats(p_table_id)
';

grant execute on function public.shared_sit_at_table(uuid, integer) to authenticated;

create or replace function public.shared_add_debug_cpu_to_table(p_table_id uuid)
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
      and (
        t.created_by = auth.uid()
        or exists (
          select 1
          from public.club_members m
          where m.club_id = t.club_id
            and m.user_id = auth.uid()
            and m.role = ''admin''
        )
        or exists (
          select 1
          from public.table_seats self_seat
          where self_seat.table_id = t.table_id
            and self_seat.user_id = auth.uid()
            and self_seat.player_type = ''human''
        )
      )
  ),
  cpu_count as (
    select count(*)::integer as count
    from public.table_seats
    where table_id = p_table_id
      and player_type = ''cpu''
  ),
  target_seat as (
    select s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where s.user_id is null
      and s.player_type = ''empty''
    order by s.seat_index asc
    limit 1
  ),
  updated_seat as (
    update public.table_seats s
    set user_id = null,
        player_type = ''cpu'',
        display_name = ''CPU'' || ((select count from cpu_count) + 1)::text,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat
    where s.table_id = p_table_id
      and s.seat_index = target_seat.seat_index
    returning s.table_id
  ),
  refreshed_table as (
    update public.tables t
    set is_debug = true,
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
    returning t.table_id
  )
  select * from public.shared_get_table_seats(p_table_id)
';

grant execute on function public.shared_add_debug_cpu_to_table(uuid) to authenticated;

create or replace function public.shared_remove_debug_cpu_from_table(p_table_id uuid)
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
      and (
        t.created_by = auth.uid()
        or exists (
          select 1
          from public.club_members m
          where m.club_id = t.club_id
            and m.user_id = auth.uid()
            and m.role = ''admin''
        )
      )
  ),
  target_seat as (
    select s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where s.player_type = ''cpu''
    order by s.seat_index desc
    limit 1
  ),
  updated_seat as (
    update public.table_seats s
    set user_id = null,
        player_type = ''empty'',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat
    where s.table_id = p_table_id
      and s.seat_index = target_seat.seat_index
    returning s.table_id
  ),
  refreshed_table as (
    update public.tables t
    set is_debug = exists (
          select 1 from public.table_seats s
          where s.table_id = p_table_id and s.player_type = ''cpu''
        ),
        status = case when t.status = ''playing'' then t.status else ''waiting'' end
    where t.table_id = p_table_id
    returning t.table_id
  )
  select * from public.shared_get_table_seats(p_table_id)
';

grant execute on function public.shared_remove_debug_cpu_from_table(uuid) to authenticated;

create or replace function public.shared_set_last_hand(p_table_id uuid, p_is_last_hand boolean)
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
  updated_seat as (
    update public.table_seats s
    set is_last_hand_declared = coalesce(p_is_last_hand, false),
        updated_at = now()
    from target_table t
    where s.table_id = t.table_id
      and s.user_id = auth.uid()
      and s.player_type = ''human''
    returning s.table_id
  )
  select * from public.shared_get_table_seats(p_table_id)
';

grant execute on function public.shared_set_last_hand(uuid, boolean) to authenticated;

create or replace function public.shared_start_debug_table_game(p_table_id uuid)
returns table (
  table_id uuid,
  club_id uuid,
  name text,
  status text,
  is_debug boolean
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
      and (
        t.created_by = auth.uid()
        or exists (
          select 1
          from public.club_members m
          where m.club_id = t.club_id
            and m.user_id = auth.uid()
            and m.role = ''admin''
        )
        or exists (
          select 1
          from public.table_seats self_seat
          where self_seat.table_id = t.table_id
            and self_seat.user_id = auth.uid()
            and self_seat.player_type = ''human''
        )
      )
      and (
        select count(*)
        from public.table_seats s
        where s.table_id = p_table_id
          and (s.user_id is not null or s.player_type = ''cpu'')
      ) >= 3
  ),
  updated_table as (
    update public.tables t
    set status = ''playing'',
        is_debug = exists (
          select 1 from public.table_seats s
          where s.table_id = p_table_id and s.player_type = ''cpu''
        )
    from target_table
    where t.table_id = target_table.table_id
    returning t.table_id, t.club_id, t.name, t.status, t.is_debug
  )
  select * from updated_table
';

grant execute on function public.shared_start_debug_table_game(uuid) to authenticated;

select 'patch_shared_table_lobby_rpc_ok' as result;
