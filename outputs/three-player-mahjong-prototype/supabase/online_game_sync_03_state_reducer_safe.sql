create or replace function public.submit_game_action(
  p_game_id uuid,
  p_table_id uuid,
  p_player_id uuid,
  p_action_type text,
  p_turn_version integer,
  p_payload jsonb default '{}'
)
returns public.game_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_club_id uuid;
  v_current_version integer;
  v_state jsonb;
  v_next_state jsonb;
  v_event public.game_events;
  v_seat_index integer;
  v_next_seat_index integer;
  v_action jsonb;
  v_discards jsonb;
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if p_player_id <> auth.uid() then
    raise exception 'cannot submit another player action';
  end if;

  select club_id into v_table_club_id
  from public.tables
  where table_id = p_table_id;

  if v_table_club_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_table_club_id, auth.uid()) then
    raise exception 'not club member';
  end if;

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id
    and user_id = auth.uid()
    and player_type = 'human'
  limit 1;

  if v_seat_index is null then
    raise exception 'not seated';
  end if;

  select version, state into v_current_version, v_state
  from public.game_states
  where game_id = p_game_id
    and table_id = p_table_id
    and is_active = true
  for update;

  if v_current_version is null then
    raise exception 'active game not found';
  end if;

  if v_current_version <> p_turn_version then
    raise exception 'stale turn_version';
  end if;

  if p_action_type not in ('draw', 'discard', 'ron', 'tsumo', 'pon', 'kan', 'riichi', 'skip', 'flower', 'nukiDora') then
    raise exception 'invalid action type';
  end if;

  insert into public.game_events (
    game_id,
    table_id,
    player_id,
    action_type,
    turn_version,
    payload
  )
  values (
    p_game_id,
    p_table_id,
    p_player_id,
    p_action_type,
    p_turn_version,
    coalesce(p_payload, '{}')
  )
  returning * into v_event;

  v_action := jsonb_build_object(
    'eventId', v_event.event_id,
    'type', p_action_type,
    'playerId', p_player_id,
    'seatIndex', v_seat_index,
    'turnVersion', p_turn_version,
    'payload', coalesce(p_payload, '{}'),
    'createdAt', v_event.created_at
  );

  v_next_state := coalesce(v_state, '{}'::jsonb) || jsonb_build_object(
    'version', v_current_version + 1,
    'phase', 'onlinePlaying',
    'lastAction', v_action,
    'lastSyncedAt', extract(epoch from now()) * 1000
  );

  v_next_state := jsonb_set(
    v_next_state,
    '{actionLog}',
    coalesce(v_state->'actionLog', '[]'::jsonb) || jsonb_build_array(v_action),
    true
  );

  if p_action_type = 'discard' then
    v_key := v_seat_index::text;
    v_discards := coalesce(v_state->'discards', '{}'::jsonb);
    v_discards := jsonb_set(
      v_discards,
      array[v_key],
      coalesce(v_discards->v_key, '[]'::jsonb) || jsonb_build_array(coalesce(p_payload, '{}'::jsonb)),
      true
    );
    v_next_seat_index := (v_seat_index + 1) % 3;
    v_next_state := jsonb_set(v_next_state, '{discards}', v_discards, true);
    v_next_state := jsonb_set(v_next_state, '{currentTurnSeatIndex}', to_jsonb(v_next_seat_index), true);
    v_next_state := jsonb_set(v_next_state, '{lastDiscard}', coalesce(p_payload, '{}'::jsonb), true);
  elsif p_action_type = 'draw' then
    v_next_state := jsonb_set(v_next_state, '{lastDraw}', v_action, true);
    v_next_state := jsonb_set(v_next_state, '{currentTurnSeatIndex}', to_jsonb(v_seat_index), true);
  elsif p_action_type in ('ron', 'tsumo') then
    v_next_state := jsonb_set(v_next_state, '{phase}', to_jsonb('showingResult'::text), true);
    v_next_state := jsonb_set(v_next_state, '{result}', v_action, true);
  elsif p_action_type in ('pon', 'kan', 'riichi', 'flower', 'nukiDora', 'skip') then
    v_next_state := jsonb_set(v_next_state, '{pendingAction}', 'null'::jsonb, true);
  end if;

  update public.game_states
  set version = v_current_version + 1,
      state = v_next_state,
      updated_at = now()
  where game_id = p_game_id;

  return v_event;
end;
$$;

grant execute on function public.submit_game_action(uuid, uuid, uuid, text, integer, jsonb) to authenticated;

select 'online_game_sync_03_safe_ok' as result;
