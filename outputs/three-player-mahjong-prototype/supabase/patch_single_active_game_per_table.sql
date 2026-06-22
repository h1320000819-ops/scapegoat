-- Ensure one active game_state per table when auto-start/debug-start races.
-- Run this whole file in the Supabase SQL Editor.

create or replace function public.ensure_online_game_for_table(p_table_id uuid)
returns setof public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table public.tables;
  v_existing public.game_states;
  v_game public.games;
  v_state public.game_states;
  v_filled_count integer := 0;
  v_cpu_count integer := 0;
  v_players jsonb := '[]'::jsonb;
begin
  select * into v_table
  from public.tables
  where table_id = p_table_id
  for update;

  if not found then
    raise exception 'table not found';
  end if;

  if auth.uid() is null or not exists (
    select 1
    from public.club_members cm
    where cm.club_id = v_table.club_id
      and cm.user_id = auth.uid()
  ) then
    raise exception 'not club member';
  end if;

  with ranked as (
    select
      gs.game_id,
      row_number() over (order by gs.updated_at desc nulls last, gs.game_id desc) as rn
    from public.game_states gs
    where gs.table_id = p_table_id
      and gs.is_active = true
  )
  update public.game_states gs
  set is_active = false
  from ranked r
  where gs.game_id = r.game_id
    and r.rn > 1;

  select * into v_existing
  from public.game_states
  where table_id = p_table_id
    and is_active = true
  order by updated_at desc nulls last, game_id desc
  limit 1;

  if found then
    update public.tables
    set status = 'playing'
    where table_id = p_table_id
      and status <> 'playing';

    return next v_existing;
    return;
  end if;

  select
    count(*) filter (where s.user_id is not null or s.player_type = 'cpu'),
    count(*) filter (where s.player_type = 'cpu')
  into v_filled_count, v_cpu_count
  from public.table_seats s
  where s.table_id = p_table_id;

  if v_filled_count < 3 then
    return;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seatIndex', s.seat_index,
        'userId', s.user_id,
        'playerType', s.player_type,
        'displayName', coalesce(s.display_name, u.display_name)
      )
      order by s.seat_index
    ),
    '[]'::jsonb
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
      'players', v_players,
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

  return next v_state;
  return;
end;
$$;

grant execute on function public.ensure_online_game_for_table(uuid) to authenticated;

create or replace function public.shared_start_debug_table_game(p_table_id uuid)
returns setof public.game_states
language sql
security definer
set search_path = public
as $$
  select *
  from public.ensure_online_game_for_table(p_table_id)
$$;

grant execute on function public.shared_start_debug_table_game(uuid) to authenticated;

select 'patch_single_active_game_per_table_ok' as result;
