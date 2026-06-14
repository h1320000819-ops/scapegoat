-- Online authority patch for Anmika Rocket.
-- Run the whole file in Supabase SQL Editor. Do not run partial selections.
-- This patch adds the minimum server-side state needed for shared online tables:
-- connections, pending actions, version-checked action submission, and
-- production auto-start only when three real club members are seated.

create table if not exists public.player_connections (
  table_id uuid not null references public.tables(table_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  status text not null default 'online' check (status in ('online', 'reconnecting', 'offline')),
  last_seen_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

create table if not exists public.pending_actions (
  pending_action_id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(game_id) on delete cascade,
  table_id uuid not null references public.tables(table_id) on delete cascade,
  player_id uuid not null references public.users(user_id) on delete cascade,
  turn_version integer not null,
  options jsonb not null default '[]',
  selected_action_id uuid references public.game_events(event_id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_actions_game_open_idx
on public.pending_actions(game_id, player_id, selected_action_id);

alter table public.player_connections enable row level security;
alter table public.pending_actions enable row level security;

create or replace function public.is_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $anmika_is_club_member$
  select exists (
    select 1
    from public.club_members
    where club_id = p_club_id
      and user_id = p_user_id
  );
$anmika_is_club_member$;

create or replace function public.is_club_admin(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $anmika_is_club_admin$
  select exists (
    select 1
    from public.club_members
    where club_id = p_club_id
      and user_id = p_user_id
      and role = 'admin'
  );
$anmika_is_club_admin$;

grant execute on function public.is_club_member(uuid, uuid) to anon, authenticated;
grant execute on function public.is_club_admin(uuid, uuid) to anon, authenticated;

drop function if exists public.sit_at_table(uuid);
drop function if exists public.sit_at_table(uuid, smallint, uuid);

create or replace function public.sit_at_table(
  p_table_id uuid,
  p_seat_index smallint default null,
  p_user_id uuid default null
)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_sit_at_table$
declare
  v_user_id uuid;
  v_club_id uuid;
  v_seat_index smallint;
begin
  v_user_id := coalesce(p_user_id, auth.uid());

  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if v_user_id <> auth.uid() then
    raise exception 'cannot seat another player';
  end if;

  select club_id into v_club_id
  from public.tables
  where table_id = p_table_id;

  if v_club_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_club_id, v_user_id) then
    raise exception 'not club member';
  end if;

  if exists (
    select 1
    from public.table_seats
    where table_id = p_table_id
      and user_id = v_user_id
  ) then
    return query
    select *
    from public.table_seats
    where table_id = p_table_id
    order by seat_index asc;
    return;
  end if;

  if p_seat_index is not null then
    select seat_index into v_seat_index
    from public.table_seats
    where table_id = p_table_id
      and seat_index = p_seat_index
      and (user_id is null or player_type = 'cpu')
    limit 1;
  else
    select seat_index into v_seat_index
    from public.table_seats
    where table_id = p_table_id
      and (user_id is null or player_type = 'cpu')
      and player_type in ('empty', 'cpu')
    order by case when player_type = 'empty' then 0 else 1 end, seat_index asc
    limit 1;
  end if;

  if v_seat_index is null then
    raise exception 'no empty seat';
  end if;

  update public.table_seats
  set user_id = v_user_id,
      player_type = 'human',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id
    and seat_index = v_seat_index;

  insert into public.player_connections (table_id, user_id, status, last_seen_at)
  values (p_table_id, v_user_id, 'online', now())
  on conflict (table_id, user_id) do update
  set status = excluded.status,
      last_seen_at = excluded.last_seen_at;

  perform public.try_start_table_game(p_table_id);

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_sit_at_table$;

grant execute on function public.sit_at_table(uuid, smallint, uuid) to authenticated;

create or replace function public.try_start_table_game(p_table_id uuid)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $anmika_try_start_table_game$
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

  -- Production online tables start only with three real players.
  -- CPU seats are debug/local only and must not start a production game.
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
$anmika_try_start_table_game$;

grant execute on function public.try_start_table_game(uuid) to authenticated;

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
as $anmika_submit_game_action$
declare
  v_club_id uuid;
  v_current_version integer;
  v_event public.game_events;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if p_player_id <> auth.uid() then
    raise exception 'cannot submit another player action';
  end if;

  select club_id into v_club_id
  from public.tables
  where table_id = p_table_id;

  if v_club_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_club_id, auth.uid()) then
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
$anmika_submit_game_action$;

grant execute on function public.submit_game_action(uuid, uuid, uuid, text, integer, jsonb) to authenticated;

drop policy if exists "player connections club members read" on public.player_connections;
create policy "player connections club members read"
on public.player_connections for select
using (
  exists (
    select 1
    from public.tables t
    where t.table_id = player_connections.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

drop policy if exists "player connections own upsert" on public.player_connections;
create policy "player connections own upsert"
on public.player_connections for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tables t
    where t.table_id = player_connections.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

drop policy if exists "player connections own update" on public.player_connections;
create policy "player connections own update"
on public.player_connections for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "pending actions club members read" on public.pending_actions;
create policy "pending actions club members read"
on public.pending_actions for select
using (
  exists (
    select 1
    from public.tables t
    where t.table_id = pending_actions.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

select 'online_authority_patch_ok' as result;
