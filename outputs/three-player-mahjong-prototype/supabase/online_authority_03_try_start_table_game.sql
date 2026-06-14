-- 03: Start a production online game only after three real players are seated.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.try_start_table_game(p_table_id uuid)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table public.tables;
  v_game public.games;
  v_state public.game_states;
  v_human_count integer;
  v_cpu_count integer;
  v_players jsonb;
begin
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

  if v_table.status <> 'waiting' then
    select * into v_state
    from public.game_states
    where table_id = p_table_id
      and is_active = true
    limit 1;
    return v_state;
  end if;

  select
    count(*) filter (where player_type = 'human' and user_id is not null),
    count(*) filter (where player_type = 'cpu')
  into v_human_count, v_cpu_count
  from public.table_seats
  where table_id = p_table_id;

  if v_human_count <> 3 or v_cpu_count <> 0 then
    return null;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'seatIndex', s.seat_index,
      'userId', s.user_id,
      'playerType', s.player_type
    )
    order by s.seat_index
  )
  into v_players
  from public.table_seats s
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
      'phase', 'waitingForServerDeal',
      'tableId', p_table_id,
      'clubId', v_table.club_id,
      'players', v_players,
      'pendingAction', null,
      'lastSyncedAt', extract(epoch from now()) * 1000
    ),
    true
  )
  returning * into v_state;

  update public.tables
  set status = 'playing',
      is_debug = false
  where table_id = p_table_id;

  return v_state;
end;
$$;

grant execute on function public.try_start_table_game(uuid) to authenticated;

select 'online_authority_03_ok' as result;
