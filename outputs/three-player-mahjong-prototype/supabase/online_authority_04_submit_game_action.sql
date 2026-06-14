-- 04: Version-checked action submission.
-- Run this whole file in Supabase SQL Editor.

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
  v_event public.game_events;
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

  if not exists (
    select 1
    from public.table_seats
    where table_id = p_table_id
      and user_id = auth.uid()
      and player_type = 'human'
  ) then
    raise exception 'not seated';
  end if;

  select version into v_current_version
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

  if p_action_type not in ('discard', 'ron', 'tsumo', 'pon', 'kan', 'riichi', 'skip', 'nukiDora') then
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

  update public.game_states
  set version = version + 1,
      state = jsonb_set(
        jsonb_set(state, '{version}', to_jsonb(version + 1), true),
        '{lastAction}',
        to_jsonb(v_event),
        true
      ),
      updated_at = now()
  where game_id = p_game_id;

  return v_event;
end;
$$;

grant execute on function public.submit_game_action(uuid, uuid, uuid, text, integer, jsonb) to authenticated;

select 'online_authority_04_ok' as result;
