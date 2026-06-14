-- Online game sync safe patch.
-- Copy and run this whole file in Supabase SQL Editor.
-- This file intentionally avoids dollar-quoted function bodies.

alter table public.game_events
drop constraint if exists game_events_action_type_check;

alter table public.game_events
add constraint game_events_action_type_check
check (action_type in (
  'draw',
  'discard',
  'ron',
  'tsumo',
  'pon',
  'kan',
  'riichi',
  'skip',
  'flower',
  'nukiDora'
));

drop function if exists public.ensure_online_game_for_table(uuid);

create or replace function public.ensure_online_game_for_table(p_table_id uuid)
returns public.game_states
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
      and (
        select count(*)
        from public.table_seats s
        where s.table_id = p_table_id
          and (s.user_id is not null or s.player_type = ''cpu'')
      ) >= 3
    limit 1
  ),
  existing_state as (
    select gs.*
    from public.game_states gs
    join target_table t on t.table_id = gs.table_id
    where gs.is_active = true
    order by gs.updated_at desc
    limit 1
  ),
  seat_summary as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            ''seatIndex'', s.seat_index,
            ''userId'', s.user_id,
            ''playerType'', s.player_type,
            ''displayName'', coalesce(s.display_name, u.display_name),
            ''isLastHandDeclared'', coalesce(s.is_last_hand_declared, false)
          )
          order by s.seat_index
        ),
        ''[]''::jsonb
      ) as players,
      count(*) filter (where s.player_type = ''cpu'') as cpu_count
    from public.table_seats s
    left join public.users u on u.user_id = s.user_id
    where s.table_id = p_table_id
  ),
  inserted_game as (
    insert into public.games (table_id, status)
    select p_table_id, ''playing''
    from target_table
    where not exists (select 1 from existing_state)
    returning *
  ),
  inserted_state as (
    insert into public.game_states (game_id, table_id, version, state, is_active)
    select
      g.game_id,
      p_table_id,
      0,
      jsonb_build_object(
        ''version'', 0,
        ''phase'', ''onlinePlaying'',
        ''tableId'', p_table_id,
        ''clubId'', t.club_id,
        ''isDebug'', (select cpu_count from seat_summary) > 0,
        ''players'', (select players from seat_summary),
        ''currentTurnSeatIndex'', 0,
        ''pendingAction'', null,
        ''lastAction'', null,
        ''actionLog'', ''[]''::jsonb,
        ''discards'', ''{}''::jsonb,
        ''lastSyncedAt'', extract(epoch from now()) * 1000
      ),
      true
    from inserted_game g
    join target_table t on t.table_id = g.table_id
    returning *
  ),
  updated_table as (
    update public.tables t
    set status = ''playing'',
        is_debug = (select cpu_count from seat_summary) > 0
    where t.table_id = p_table_id
      and exists (select 1 from inserted_state)
    returning t.table_id
  )
  select * from existing_state
  union all
  select * from inserted_state
  limit 1
';

grant execute on function public.ensure_online_game_for_table(uuid) to authenticated;

drop function if exists public.submit_game_action(uuid, uuid, uuid, text, integer, jsonb);

create or replace function public.submit_game_action(
  p_game_id uuid,
  p_table_id uuid,
  p_player_id uuid,
  p_action_type text,
  p_turn_version integer,
  p_payload jsonb default '{}'
)
returns public.game_events
language sql
security definer
set search_path = public
as '
  with actor_seat as (
    select
      t.club_id,
      s.seat_index
    from public.tables t
    join public.table_seats s on s.table_id = t.table_id
    where t.table_id = p_table_id
      and auth.uid() is not null
      and p_player_id = auth.uid()
      and s.user_id = auth.uid()
      and s.player_type = ''human''
      and exists (
        select 1
        from public.club_members m
        where m.club_id = t.club_id
          and m.user_id = auth.uid()
      )
    limit 1
  ),
  locked_state as (
    select gs.*
    from public.game_states gs
    join actor_seat a on true
    where gs.game_id = p_game_id
      and gs.table_id = p_table_id
      and gs.is_active = true
      and gs.version = p_turn_version
      and p_action_type in (''draw'', ''discard'', ''ron'', ''tsumo'', ''pon'', ''kan'', ''riichi'', ''skip'', ''flower'', ''nukiDora'')
    for update
  ),
  inserted_event as (
    insert into public.game_events (
      game_id,
      table_id,
      player_id,
      action_type,
      turn_version,
      payload
    )
    select
      p_game_id,
      p_table_id,
      p_player_id,
      p_action_type,
      p_turn_version,
      coalesce(p_payload, ''{}''::jsonb)
    from locked_state
    returning *
  ),
  action_data as (
    select
      e.*,
      ls.version as current_version,
      ls.state as current_state,
      a.seat_index,
      jsonb_build_object(
        ''eventId'', e.event_id,
        ''type'', p_action_type,
        ''playerId'', p_player_id,
        ''seatIndex'', a.seat_index,
        ''turnVersion'', p_turn_version,
        ''payload'', coalesce(p_payload, ''{}''::jsonb),
        ''createdAt'', e.created_at
      ) as action_json
    from inserted_event e
    join locked_state ls on ls.game_id = e.game_id
    join actor_seat a on true
  ),
  base_state as (
    select
      ad.*,
      jsonb_set(
        coalesce(ad.current_state, ''{}''::jsonb) || jsonb_build_object(
          ''version'', ad.current_version + 1,
          ''phase'', case when p_action_type in (''ron'', ''tsumo'') then ''showingResult'' else ''onlinePlaying'' end,
          ''lastAction'', ad.action_json,
          ''lastSyncedAt'', extract(epoch from now()) * 1000
        ),
        ''{actionLog}'',
        coalesce(ad.current_state->''actionLog'', ''[]''::jsonb) || jsonb_build_array(ad.action_json),
        true
      ) as next_state
    from action_data ad
  ),
  reduced_state as (
    select
      bs.*,
      case
        when p_action_type = ''discard'' then
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  bs.next_state,
                  ''{discards}'',
                  jsonb_set(
                    coalesce(bs.current_state->''discards'', ''{}''::jsonb),
                    array[bs.seat_index::text],
                    coalesce((bs.current_state->''discards'')->(bs.seat_index::text), ''[]''::jsonb) || jsonb_build_array(coalesce(p_payload, ''{}''::jsonb)),
                    true
                  ),
                  true
                ),
                ''{currentTurnSeatIndex}'',
                to_jsonb((bs.seat_index + 1) % 3),
                true
              ),
              ''{lastDiscard}'',
              coalesce(p_payload, ''{}''::jsonb),
              true
            ),
            ''{pendingAction}'',
            ''null''::jsonb,
            true
          )
        when p_action_type = ''draw'' then
          jsonb_set(
            jsonb_set(bs.next_state, ''{lastDraw}'', bs.action_json, true),
            ''{currentTurnSeatIndex}'',
            to_jsonb(bs.seat_index),
            true
          )
        when p_action_type in (''ron'', ''tsumo'') then
          jsonb_set(bs.next_state, ''{result}'', bs.action_json, true)
        when p_action_type in (''pon'', ''kan'', ''riichi'', ''flower'', ''nukiDora'', ''skip'') then
          jsonb_set(bs.next_state, ''{pendingAction}'', ''null''::jsonb, true)
        else bs.next_state
      end as final_state
    from base_state bs
  ),
  updated_state as (
    update public.game_states gs
    set version = rs.current_version + 1,
        state = rs.final_state,
        updated_at = now()
    from reduced_state rs
    where gs.game_id = rs.game_id
    returning gs.game_id
  )
  select e.*
  from inserted_event e
  join updated_state u on u.game_id = e.game_id
  limit 1
';

grant execute on function public.submit_game_action(uuid, uuid, uuid, text, integer, jsonb) to authenticated;

select 'patch_online_game_sync_safe_ok' as result;
