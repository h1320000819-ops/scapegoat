-- Online game sync 01: create or return the active game_state for a table.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.ensure_online_game_for_table(p_table_id uuid)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $anmika_ensure_online_game_for_table$
declare
  v_table public.tables;
  v_game public.games;
  v_state public.game_states;
  v_filled_count integer;
  v_human_count integer;
  v_cpu_count integer;
  v_players jsonb;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_table
  from public.tables
  where table_id = p_table_id
  for update;

  if not found then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_table.club_id, auth.uid()) then
    raise exception 'not club member';
  end if;

  select * into v_state
  from public.game_states
  where table_id = p_table_id
    and is_active = true
  order by updated_at desc
  limit 1;

  if found then
    return v_state;
  end if;

  select
    count(*) filter (where user_id is not null or player_type = 'cpu'),
    count(*) filter (where player_type = 'human' and user_id is not null),
    count(*) filter (where player_type = 'cpu')
  into v_filled_count, v_human_count, v_cpu_count
  from public.table_seats
  where table_id = p_table_id;

  if v_filled_count < 3 then
    raise exception 'not enough players';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'seatIndex', s.seat_index,
      'userId', s.user_id,
      'playerType', s.player_type,
      'displayName', coalesce(s.display_name, u.display_name)
    )
    order by s.seat_index
  )
  into v_players
  from public.table_seats s
  left join public.users u on u.user_id = s.user_id
  where s.table_id = p_table_id;

  insert into public.games (table_id, status)
  values (p_table_id, 'playing')
  returning * into v_game;

  insert into public.game_states (game_id, table_id, version, state, is_active)
  values (
    v_game.game_id,
    p_table_id,
    0,
    jsonb_build_object(
      'version', 0,
      'phase', 'waitingForFirstAction',
      'tableId', p_table_id,
      'clubId', v_table.club_id,
      'isDebug', v_cpu_count > 0,
      'players', coalesce(v_players, '[]'::jsonb),
      'currentTurnSeatIndex', 0,
      'pendingAction', null,
      'lastAction', null,
      'lastSyncedAt', extract(epoch from now()) * 1000
    ),
    true
  )
  returning * into v_state;

  update public.tables
  set status = 'playing',
      is_debug = v_cpu_count > 0
  where table_id = p_table_id;

  return v_state;
end;
$anmika_ensure_online_game_for_table$;

grant execute on function public.ensure_online_game_for_table(uuid) to authenticated;

select 'online_game_sync_01_ok' as result;
