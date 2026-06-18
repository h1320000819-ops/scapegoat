-- Prevent a reused table from loading the previous game's final result.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.mark_stale_game_states_inactive(p_table_id uuid)
returns void
language sql
security definer
set search_path = public
as '
  update public.game_states gs
  set is_active = false,
      updated_at = now()
  where gs.table_id = p_table_id
    and coalesce(gs.is_active, false) = true
    and exists (
      select 1
      from public.tables t
      where t.table_id = gs.table_id
        and auth.uid() is not null
        and exists (
          select 1
          from public.club_members m
          where m.club_id = t.club_id
            and m.user_id = auth.uid()
        )
    )
    and (
      gs.state->>''phase'' in (''gameEnded'', ''finalResult'')
      or gs.state ? ''finalResult''
      or gs.state#>''{handLog,result,finalResult}'' is not null
      or gs.state#>>''{handLog,result,type}'' = ''gameEnded''
    )
';

grant execute on function public.mark_stale_game_states_inactive(uuid) to authenticated;

create or replace function public.ensure_online_game_for_table(p_table_id uuid)
returns setof public.game_states
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
        from public.club_members cm
        where cm.club_id = t.club_id
          and cm.user_id = auth.uid()
      )
    limit 1
  ),
  stale_closed as (
    update public.game_states gs
    set is_active = false,
        updated_at = now()
    from target_table t
    where gs.table_id = t.table_id
      and coalesce(gs.is_active, false) = true
      and (
        gs.state->>''phase'' in (''gameEnded'', ''finalResult'')
        or gs.state ? ''finalResult''
        or gs.state#>''{handLog,result,finalResult}'' is not null
        or gs.state#>>''{handLog,result,type}'' = ''gameEnded''
      )
    returning gs.game_id
  ),
  seat_counts as (
    select
      count(*) filter (where s.user_id is not null or s.player_type = ''cpu'') as filled_count,
      count(*) filter (where s.player_type = ''cpu'') as cpu_count
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
  ),
  existing_state as (
    select gs.*
    from public.game_states gs
    join target_table t on t.table_id = gs.table_id
    where gs.is_active = true
      and not (
        gs.state->>''phase'' in (''gameEnded'', ''finalResult'')
        or gs.state ? ''finalResult''
        or gs.state#>''{handLog,result,finalResult}'' is not null
        or gs.state#>>''{handLog,result,type}'' = ''gameEnded''
      )
    order by gs.updated_at desc
    limit 1
  ),
  players as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          ''seatIndex'', s.seat_index,
          ''userId'', s.user_id,
          ''playerType'', s.player_type,
          ''displayName'', coalesce(s.display_name, u.display_name)
        )
        order by s.seat_index
      ),
      ''[]''::jsonb
    ) as players_json
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    left join public.users u on u.user_id = s.user_id
  ),
  inserted_game as (
    insert into public.games (table_id, status)
    select t.table_id, ''playing''
    from target_table t
    cross join seat_counts sc
    where sc.filled_count >= 3
      and not exists (select 1 from existing_state)
    returning *
  ),
  inserted_state as (
    insert into public.game_states (game_id, table_id, version, state, is_active)
    select
      g.game_id,
      t.table_id,
      0,
      jsonb_build_object(
        ''version'', 0,
        ''phase'', ''waitingForFirstAction'',
        ''tableId'', t.table_id,
        ''clubId'', t.club_id,
        ''isDebug'', sc.cpu_count > 0,
        ''players'', p.players_json,
        ''currentTurnSeatIndex'', 0,
        ''pendingAction'', null,
        ''lastAction'', null,
        ''lastSyncedAt'', extract(epoch from now()) * 1000
      ),
      true
    from inserted_game g
    join target_table t on t.table_id = g.table_id
    cross join seat_counts sc
    cross join players p
    returning *
  ),
  updated_table as (
    update public.tables tbl
    set status = ''playing'',
        is_debug = sc.cpu_count > 0
    from target_table t
    cross join seat_counts sc
    where tbl.table_id = t.table_id
      and (
        exists (select 1 from existing_state)
        or exists (select 1 from inserted_state)
      )
    returning tbl.table_id
  )
  select * from existing_state
  union all
  select * from inserted_state
';

grant execute on function public.ensure_online_game_for_table(uuid) to authenticated;

create or replace function public.shared_start_debug_table_game(p_table_id uuid)
returns setof public.game_states
language sql
security definer
set search_path = public
as '
  select *
  from public.ensure_online_game_for_table(p_table_id)
';

grant execute on function public.shared_start_debug_table_game(uuid) to authenticated;

select 'patch_reset_stale_game_state_on_new_start_ok' as result;
