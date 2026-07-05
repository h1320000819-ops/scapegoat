-- Anmika Rocket online schema for Supabase.
-- Apply this in Supabase SQL Editor.
-- Frontend must use only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
-- Never expose service_role / secret keys in the browser.

create extension if not exists pgcrypto;

create table if not exists public.users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auth_email text unique,
  login_id text,
  display_name text not null,
  icon_url text,
  auth_provider text not null default 'password',
  created_at timestamptz not null default now()
);

alter table public.users add column if not exists login_id text;
alter table public.users add column if not exists auth_provider text not null default 'password';
alter table public.users add column if not exists updated_at timestamptz not null default now();
alter table public.users add column if not exists active_login_session_id text;
alter table public.users add column if not exists active_login_session_updated_at timestamptz;
create unique index if not exists users_login_id_unique_idx on public.users(login_id);

create table if not exists public.clubs (
  club_id uuid primary key default gen_random_uuid(),
  club_code text,
  name text not null,
  owner_user_id uuid not null references public.users(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.clubs add column if not exists club_code text;
alter table public.clubs add column if not exists updated_at timestamptz not null default now();
create unique index if not exists clubs_club_code_unique_idx on public.clubs(club_code);
create unique index if not exists clubs_one_owner_idx on public.clubs(owner_user_id);

create table if not exists public.user_identities (
  identity_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id) on delete cascade,
  provider text not null check (provider in ('password', 'google', 'email', 'apple')),
  provider_user_id text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  audit_log_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(user_id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  point_balance integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create table if not exists public.club_join_requests (
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create table if not exists public.tables (
  table_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  name text not null,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'ended')),
  rule_id text not null default 'anmika-rocket',
  point_rate numeric(4, 1) not null default 1.0,
  rake_percent numeric(4, 1) not null default 0,
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.table_seats (
  table_id uuid not null references public.tables(table_id) on delete cascade,
  seat_index smallint not null check (seat_index between 0 and 2),
  user_id uuid references public.users(user_id) on delete set null,
  player_type text not null default 'empty' check (player_type in ('empty', 'human', 'cpu')),
  display_name text,
  is_last_hand_declared boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (table_id, seat_index),
  unique (table_id, user_id)
);

alter table public.table_seats add column if not exists player_type text not null default 'empty'
  check (player_type in ('empty', 'human', 'cpu'));
alter table public.table_seats add column if not exists display_name text;
alter table public.tables add column if not exists is_debug boolean not null default false;

create table if not exists public.table_waiting_list (
  table_id uuid not null references public.tables(table_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

create table if not exists public.games (
  game_id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(table_id) on delete cascade,
  status text not null default 'playing' check (status in ('playing', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.game_states (
  game_id uuid primary key references public.games(game_id) on delete cascade,
  table_id uuid not null references public.tables(table_id) on delete cascade,
  version integer not null default 0,
  state jsonb not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.game_events (
  event_id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(game_id) on delete cascade,
  table_id uuid not null references public.tables(table_id) on delete cascade,
  player_id uuid not null references public.users(user_id),
  action_type text not null check (action_type in ('discard', 'ron', 'tsumo', 'pon', 'kan', 'riichi', 'skip', 'nukiDora')),
  turn_version integer not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists game_events_game_created_idx on public.game_events(game_id, created_at);

create table if not exists public.replays (
  replay_id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(club_id) on delete set null,
  table_id uuid references public.tables(table_id) on delete set null,
  game_id uuid references public.games(game_id) on delete set null,
  summary jsonb not null,
  initial_state jsonb not null,
  events jsonb not null default '[]',
  snapshots jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists replays_club_created_idx on public.replays(club_id, created_at desc);

create table if not exists public.club_points (
  point_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  amount integer not null,
  reason text not null,
  game_id uuid references public.games(game_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.club_rake_logs (
  rake_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid references public.users(user_id) on delete set null,
  user_name text,
  table_id uuid references public.tables(table_id) on delete set null,
  game_id uuid references public.games(game_id) on delete set null,
  replay_id uuid references public.replays(replay_id) on delete set null,
  win_type text check (win_type in ('ron', 'tsumo')),
  original_gain integer,
  rake_percent numeric(4, 1),
  rake_amount integer,
  amount integer not null,
  created_at timestamptz not null default now()
);

alter table public.club_rake_logs add column if not exists user_id uuid references public.users(user_id) on delete set null;
alter table public.club_rake_logs add column if not exists user_name text;
alter table public.club_rake_logs add column if not exists replay_id uuid references public.replays(replay_id) on delete set null;
alter table public.club_rake_logs add column if not exists win_type text check (win_type in ('ron', 'tsumo'));
alter table public.club_rake_logs add column if not exists original_gain integer;
alter table public.club_rake_logs add column if not exists rake_percent numeric(4, 1);
alter table public.club_rake_logs add column if not exists rake_amount integer;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists table_seats_touch on public.table_seats;
create trigger table_seats_touch
before update on public.table_seats
for each row execute function public.touch_updated_at();

drop trigger if exists game_states_touch on public.game_states;
create trigger game_states_touch
before update on public.game_states
for each row execute function public.touch_updated_at();

create or replace function public.generate_short_code(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $anmika_generate_short_code$
declare
  v_code text;
begin
  v_code := upper(p_prefix || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  return v_code;
end;
$anmika_generate_short_code$;

create or replace function public.generate_unique_login_id()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $anmika_generate_unique_login_id$
declare
  v_code text;
begin
  loop
    v_code := public.generate_short_code('P');
    exit when not exists (select 1 from public.users where login_id = v_code);
  end loop;
  return v_code;
end;
$anmika_generate_unique_login_id$;

create or replace function public.generate_unique_club_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $anmika_generate_unique_club_code$
declare
  v_code text;
begin
  loop
    v_code := public.generate_short_code('C');
    exit when not exists (select 1 from public.clubs where club_code = v_code);
  end loop;
  return v_code;
end;
$anmika_generate_unique_club_code$;

-- Creates a public profile automatically when Supabase Auth creates a user.
-- The frontend still uses anon key only; this trigger runs inside the database.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (user_id, auth_email, login_id, display_name, icon_url, auth_provider)
  values (
    new.id,
    new.email,
    public.generate_unique_login_id(),
    coalesce(new.raw_user_meta_data->>'display_name', 'プレイヤー'),
    new.raw_user_meta_data->>'icon_url',
    'password'
  )
  on conflict (user_id) do update
  set auth_email = excluded.auth_email,
      login_id = coalesce(public.users.login_id, excluded.login_id),
      display_name = coalesce(public.users.display_name, excluded.display_name),
      icon_url = coalesce(public.users.icon_url, excluded.icon_url),
      updated_at = now();

  insert into public.user_identities (user_id, provider, provider_user_id, email)
  values (new.id, 'password', new.id::text, new.email)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_user_id
  );
$$;

create or replace function public.is_club_admin(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_user_id and role = 'admin'
  );
$$;

-- Login helper for the local debug UI.
-- It resolves a player ID to the generated Supabase Auth email without exposing service keys.
drop function if exists public.get_login_email(uuid);
drop function if exists public.get_login_email(text);

create or replace function public.get_login_email(p_user_id text)
returns text
language sql
stable
security definer
set search_path = public
as $anmika_get_login_email$
  select auth_email
  from public.users
  where user_id::text = p_user_id
     or login_id = upper(p_user_id)
  limit 1;
$anmika_get_login_email$;

grant execute on function public.get_login_email(text) to anon, authenticated;

-- Profile upsert helper for the browser app.
-- Direct inserts into public.users are intentionally protected by RLS, so the app uses this function.
drop function if exists public.ensure_user_profile(text, text, text);

create or replace function public.ensure_user_profile(
  p_user_id text,
  p_auth_email text,
  p_display_name text
)
returns public.users
language plpgsql
security definer
set search_path = public
as $anmika_ensure_user_profile$
declare
  v_user public.users;
begin
  if auth.uid()::text <> p_user_id then
    raise exception 'cannot create another user profile';
  end if;

  insert into public.users (user_id, auth_email, login_id, display_name, auth_provider)
  values (p_user_id::uuid, p_auth_email, public.generate_unique_login_id(), coalesce(nullif(p_display_name, ''), 'Player'), 'password')
  on conflict (user_id) do update
  set auth_email = excluded.auth_email,
      login_id = coalesce(public.users.login_id, excluded.login_id),
      display_name = coalesce(nullif(public.users.display_name, ''), excluded.display_name),
      updated_at = now()
  returning * into v_user;

  return v_user;
end;
$anmika_ensure_user_profile$;

grant execute on function public.ensure_user_profile(text, text, text) to authenticated;

-- Club creation helper.
-- Creates the club and the owner admin membership in one protected database operation.
drop function if exists public.create_club_with_owner(text);

create or replace function public.create_club_with_owner(p_name text)
returns public.clubs
language plpgsql
security definer
set search_path = public
as $anmika_create_club_with_owner$
declare
  v_club public.clubs;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select *
  into v_club
  from public.clubs
  where owner_user_id = auth.uid()
  limit 1;

  if found then
    insert into public.club_members (club_id, user_id, role)
    values (v_club.club_id, auth.uid(), 'admin')
    on conflict (club_id, user_id) do update
    set role = 'admin';

    return v_club;
  end if;

  insert into public.clubs (club_code, name, owner_user_id)
  values (public.generate_unique_club_code(), coalesce(nullif(p_name, ''), 'テストクラブ'), auth.uid())
  returning * into v_club;

  insert into public.club_members (club_id, user_id, role)
  values (v_club.club_id, auth.uid(), 'admin')
  on conflict (club_id, user_id) do update
  set role = 'admin';

  return v_club;
end;
$anmika_create_club_with_owner$;

grant execute on function public.create_club_with_owner(text) to authenticated;

-- Repairs older data where a club exists but its owner membership row was not created.
drop function if exists public.repair_my_owner_memberships();

create or replace function public.repair_my_owner_memberships()
returns setof public.clubs
language plpgsql
security definer
set search_path = public
as $anmika_repair_my_owner_memberships$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  insert into public.club_members (club_id, user_id, role)
  select club_id, auth.uid(), 'admin'
  from public.clubs
  where owner_user_id = auth.uid()
  on conflict (club_id, user_id) do update
  set role = 'admin';

  return query
  select *
  from public.clubs
  where owner_user_id = auth.uid()
  order by created_at desc;
end;
$anmika_repair_my_owner_memberships$;

grant execute on function public.repair_my_owner_memberships() to authenticated;

drop function if exists public.change_my_login_id(text);

create or replace function public.change_my_login_id(p_new_login_id text)
returns public.users
language plpgsql
security definer
set search_path = public
as $anmika_change_my_login_id$
declare
  v_old_login_id text;
  v_new_login_id text;
  v_user public.users;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  v_new_login_id := upper(trim(p_new_login_id));

  if v_new_login_id !~ '^P-[A-Z0-9]{6,20}$' then
    raise exception 'invalid login id format';
  end if;

  select login_id into v_old_login_id
  from public.users
  where user_id = auth.uid();

  if exists (
    select 1 from public.users
    where login_id = v_new_login_id and user_id <> auth.uid()
  ) then
    raise exception 'login id already used';
  end if;

  update public.users
  set login_id = v_new_login_id,
      updated_at = now()
  where user_id = auth.uid()
  returning * into v_user;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    'change_login_id',
    'user',
    auth.uid()::text,
    jsonb_build_object('oldLoginId', v_old_login_id, 'newLoginId', v_new_login_id)
  );

  return v_user;
end;
$anmika_change_my_login_id$;

grant execute on function public.change_my_login_id(text) to authenticated;

-- Backfill public IDs for existing rows. The generator functions are VOLATILE,
-- so they are evaluated per updated row.
update public.users
set login_id = public.generate_unique_login_id(),
    updated_at = now()
where login_id is null;

update public.clubs
set club_code = public.generate_unique_club_code(),
    updated_at = now()
where club_code is null;

create or replace function public.approve_club_join_request(p_club_id uuid, p_user_id uuid, p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_admin_user_id and role = 'admin'
  ) then
    raise exception 'not club admin';
  end if;

  insert into public.club_members (club_id, user_id, role)
  values (p_club_id, p_user_id, 'member')
  on conflict (club_id, user_id) do nothing;

  update public.club_join_requests
  set status = 'approved'
  where club_id = p_club_id and user_id = p_user_id;
end;
$$;

create or replace function public.reject_club_join_request(p_club_id uuid, p_user_id uuid, p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_admin_user_id and role = 'admin'
  ) then
    raise exception 'not club admin';
  end if;

  update public.club_join_requests
  set status = 'rejected'
  where club_id = p_club_id and user_id = p_user_id;
end;
$$;

alter table public.users enable row level security;
alter table public.user_identities enable row level security;
alter table public.audit_logs enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_join_requests enable row level security;
alter table public.tables enable row level security;
alter table public.table_seats enable row level security;
alter table public.table_waiting_list enable row level security;
alter table public.games enable row level security;
alter table public.game_states enable row level security;
alter table public.game_events enable row level security;
alter table public.replays enable row level security;
alter table public.club_points enable row level security;
alter table public.club_rake_logs enable row level security;

drop policy if exists "users can read users" on public.users;
drop policy if exists "users can update self" on public.users;
drop policy if exists "users can insert self" on public.users;
drop policy if exists "user identities own read" on public.user_identities;
drop policy if exists "audit logs own read" on public.audit_logs;
drop policy if exists "audit logs insert self" on public.audit_logs;
drop policy if exists "clubs authenticated read" on public.clubs;
drop policy if exists "club readable by members or search" on public.clubs;
drop policy if exists "clubs owner creates" on public.clubs;
drop policy if exists "club owner creates" on public.clubs;
drop policy if exists "club members read same club" on public.club_members;
drop policy if exists "members read same club" on public.club_members;
drop policy if exists "club members own or same club read" on public.club_members;
drop policy if exists "club owner inserts self admin" on public.club_members;
drop policy if exists "join requests own insert" on public.club_join_requests;
drop policy if exists "join requests visible to self or admins" on public.club_join_requests;
drop policy if exists "tables club members read" on public.tables;
drop policy if exists "tables admins create" on public.tables;
drop policy if exists "tables club members update" on public.tables;
drop policy if exists "tables members update" on public.tables;
drop policy if exists "tables admins delete" on public.tables;
drop policy if exists "seats club members read" on public.table_seats;
drop policy if exists "seats club members update" on public.table_seats;
drop policy if exists "seats table creator insert" on public.table_seats;
drop policy if exists "seats creator inserts" on public.table_seats;
drop policy if exists "seats sit self" on public.table_seats;
drop policy if exists "seats leave self" on public.table_seats;
drop policy if exists "waiting club members read" on public.table_waiting_list;
drop policy if exists "waiting club members all" on public.table_waiting_list;
drop policy if exists "waiting join self" on public.table_waiting_list;
drop policy if exists "waiting leave self" on public.table_waiting_list;
drop policy if exists "games club members read" on public.games;
drop policy if exists "game data club members read" on public.games;
drop policy if exists "games club members insert" on public.games;
drop policy if exists "game data club members insert" on public.games;
drop policy if exists "games club members update" on public.games;
drop policy if exists "game states club members read" on public.game_states;
drop policy if exists "game states club members insert" on public.game_states;
drop policy if exists "game states club members update" on public.game_states;
drop policy if exists "game states club members write" on public.game_states;
drop policy if exists "game events club members read" on public.game_events;
drop policy if exists "game events player insert" on public.game_events;
drop policy if exists "game events club members insert" on public.game_events;
drop policy if exists "replays club members read" on public.replays;
drop policy if exists "replays club members insert" on public.replays;
drop policy if exists "points club members read" on public.club_points;
drop policy if exists "points club members insert" on public.club_points;
drop policy if exists "rake club members read" on public.club_rake_logs;
drop policy if exists "rake club members insert" on public.club_rake_logs;

create policy "users can read users"
on public.users for select
using (auth.uid() is not null);

create policy "users can update self"
on public.users for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can insert self"
on public.users for insert
with check (auth.uid() = user_id);

create policy "user identities own read"
on public.user_identities for select
using (auth.uid() = user_id);

create policy "audit logs own read"
on public.audit_logs for select
using (auth.uid() = actor_user_id);

create policy "audit logs insert self"
on public.audit_logs for insert
with check (auth.uid() = actor_user_id);

create policy "clubs authenticated read"
on public.clubs for select
using (auth.uid() is not null);

create policy "clubs owner creates"
on public.clubs for insert
with check (auth.uid() = owner_user_id);

create policy "club members read same club"
on public.club_members for select
using (public.is_club_member(club_id, auth.uid()));

create policy "club members own or same club read"
on public.club_members for select
using (
  auth.uid() = user_id
  or public.is_club_member(club_id, auth.uid())
);

create policy "club owner inserts self admin"
on public.club_members for insert
with check (
  user_id = auth.uid()
  and role = 'admin'
  and exists (
    select 1 from public.clubs c
    where c.club_id = club_members.club_id and c.owner_user_id = auth.uid()
  )
);

create policy "join requests own insert"
on public.club_join_requests for insert
with check (auth.uid() = user_id);

create policy "join requests visible to self or admins"
on public.club_join_requests for select
using (
  auth.uid() = user_id
  or public.is_club_admin(club_id, auth.uid())
);

create policy "tables club members read"
on public.tables for select
using (public.is_club_member(club_id, auth.uid()));

create policy "tables admins create"
on public.tables for insert
with check (
  created_by = auth.uid()
  and public.is_club_admin(club_id, auth.uid())
);

create policy "tables club members update"
on public.tables for update
using (public.is_club_member(club_id, auth.uid()))
with check (public.is_club_member(club_id, auth.uid()));

create policy "tables admins delete"
on public.tables for delete
using (public.is_club_admin(club_id, auth.uid()));

create policy "seats club members read"
on public.table_seats for select
using (
  exists (
    select 1 from public.tables t
    where t.table_id = table_seats.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "seats creator inserts"
on public.table_seats for insert
with check (
  exists (
    select 1 from public.tables t
    where t.table_id = table_seats.table_id and t.created_by = auth.uid()
  )
);

create policy "seats sit self"
on public.table_seats for update
using (
  user_id is null
  and exists (
    select 1 from public.tables t
    where t.table_id = table_seats.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
)
with check (user_id = auth.uid());

create policy "seats leave self"
on public.table_seats for update
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tables t
    where t.table_id = table_seats.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
)
with check (user_id is null);

create policy "waiting club members read"
on public.table_waiting_list for select
using (
  exists (
    select 1 from public.tables t
    where t.table_id = table_waiting_list.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "waiting join self"
on public.table_waiting_list for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tables t
    where t.table_id = table_waiting_list.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "waiting leave self"
on public.table_waiting_list for delete
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tables t
    where t.table_id = table_waiting_list.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "games club members read"
on public.games for select
using (
  exists (
    select 1 from public.tables t
    where t.table_id = games.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "games club members insert"
on public.games for insert
with check (
  exists (
    select 1 from public.tables t
    where t.table_id = games.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "games club members update"
on public.games for update
using (
  exists (
    select 1 from public.tables t
    where t.table_id = games.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tables t
    where t.table_id = games.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "game states club members read"
on public.game_states for select
using (
  exists (
    select 1 from public.tables t
    where t.table_id = game_states.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "game states club members insert"
on public.game_states for insert
with check (
  exists (
    select 1 from public.tables t
    where t.table_id = game_states.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "game states club members update"
on public.game_states for update
using (
  exists (
    select 1 from public.tables t
    where t.table_id = game_states.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tables t
    where t.table_id = game_states.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "game events club members read"
on public.game_events for select
using (
  exists (
    select 1 from public.tables t
    where t.table_id = game_events.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "game events player insert"
on public.game_events for insert
with check (
  player_id = auth.uid()
  and exists (
    select 1 from public.tables t
    where t.table_id = game_events.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

create policy "replays club members read"
on public.replays for select
using (
  club_id is null
  or public.is_club_member(club_id, auth.uid())
);

create policy "replays club members insert"
on public.replays for insert
with check (
  club_id is null
  or public.is_club_member(club_id, auth.uid())
);

create policy "points club members read"
on public.club_points for select
using (public.is_club_member(club_id, auth.uid()));

create policy "points club members insert"
on public.club_points for insert
with check (public.is_club_member(club_id, auth.uid()));

create policy "rake club members read"
on public.club_rake_logs for select
using (public.is_club_admin(club_id, auth.uid()));

create policy "rake club members insert"
on public.club_rake_logs for insert
with check (public.is_club_member(club_id, auth.uid()));

-- Function existence check after running this file:
-- select proname from pg_proc where proname = 'get_login_email';
-- select proname from pg_proc where proname = 'ensure_user_profile';
-- Login helper smoke test:
-- select public.get_login_email('test-user-id');

-- Enable Supabase Realtime for the tables that need live lobby/game updates.
do $anmika_realtime$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tables'
  ) then
    alter publication supabase_realtime add table public.tables;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_seats'
  ) then
    alter publication supabase_realtime add table public.table_seats;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_waiting_list'
  ) then
    alter publication supabase_realtime add table public.table_waiting_list;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_states'
  ) then
    alter publication supabase_realtime add table public.game_states;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_events'
  ) then
    alter publication supabase_realtime add table public.game_events;
  end if;
end;
$anmika_realtime$;


-- Included table lobby RPC patch.
-- Table lobby RPC patch.
-- Adds debug CPU seats and safe seat operations for the online lobby.

alter table public.table_seats add column if not exists player_type text not null default 'empty'
  check (player_type in ('empty', 'human', 'cpu'));
alter table public.table_seats add column if not exists display_name text;
alter table public.tables add column if not exists is_debug boolean not null default false;

update public.table_seats
set player_type = case when user_id is null then player_type else 'human' end
where player_type = 'empty' and user_id is not null;

create or replace function public.refresh_table_lobby_status(p_table_id uuid)
returns public.tables
language plpgsql
security definer
set search_path = public
as $anmika_refresh_table_lobby_status$
declare
  v_table public.tables;
  v_filled_count integer;
  v_cpu_count integer;
begin
  select count(*)
  into v_filled_count
  from public.table_seats
  where table_id = p_table_id
    and (user_id is not null or player_type = 'cpu');

  select count(*)
  into v_cpu_count
  from public.table_seats
  where table_id = p_table_id and player_type = 'cpu';

  update public.tables
  set is_debug = v_cpu_count > 0,
      status = case when v_filled_count >= 3 then 'playing' else 'waiting' end
  where table_id = p_table_id
  returning * into v_table;

  return v_table;
end;
$anmika_refresh_table_lobby_status$;

grant execute on function public.refresh_table_lobby_status(uuid) to authenticated;

create or replace function public.sit_at_table(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_sit_at_table$
declare
  v_seat_index smallint;
  v_club_id uuid;
begin
  if auth.uid() is null then
    raise exception 'login required';
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

  -- If the player is already seated, just return the current seats.
  if exists (
    select 1 from public.table_seats
    where table_id = p_table_id and user_id = auth.uid()
  ) then
    return query
    select * from public.table_seats
    where table_id = p_table_id
    order by seat_index asc;
    return;
  end if;

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id
    and (user_id is null)
    and player_type in ('empty', 'cpu')
  order by case when player_type = 'empty' then 0 else 1 end, seat_index asc
  limit 1;

  if v_seat_index is null then
    raise exception 'no empty seat';
  end if;

  update public.table_seats
  set user_id = auth.uid(),
      player_type = 'human',
      display_name = null,
      updated_at = now()
  where table_id = p_table_id and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_sit_at_table$;

grant execute on function public.sit_at_table(uuid) to authenticated;

create or replace function public.leave_table(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_leave_table$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  update public.table_seats
  set user_id = null,
      player_type = 'empty',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id and user_id = auth.uid();

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_leave_table$;

grant execute on function public.leave_table(uuid) to authenticated;

create or replace function public.add_debug_cpu_to_table(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_add_debug_cpu_to_table$
declare
  v_seat_index smallint;
  v_cpu_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from public.tables t
    where t.table_id = p_table_id
      and t.created_by = auth.uid()
  ) then
    raise exception 'not table owner';
  end if;

  select count(*) into v_cpu_count
  from public.table_seats
  where table_id = p_table_id and player_type = 'cpu';

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id and user_id is null and player_type = 'empty'
  order by seat_index asc
  limit 1;

  if v_seat_index is null then
    raise exception 'no empty seat';
  end if;

  update public.table_seats
  set player_type = 'cpu',
      display_name = 'CPU' || (v_cpu_count + 1)::text,
      updated_at = now()
  where table_id = p_table_id and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_add_debug_cpu_to_table$;

grant execute on function public.add_debug_cpu_to_table(uuid) to authenticated;

create or replace function public.remove_debug_cpu_from_table(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_remove_debug_cpu_from_table$
declare
  v_seat_index smallint;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from public.tables t
    where t.table_id = p_table_id
      and t.created_by = auth.uid()
  ) then
    raise exception 'not table owner';
  end if;

  select seat_index into v_seat_index
  from public.table_seats
  where table_id = p_table_id and player_type = 'cpu'
  order by seat_index desc
  limit 1;

  if v_seat_index is null then
    raise exception 'no cpu seat';
  end if;

  update public.table_seats
  set player_type = 'empty',
      display_name = null,
      updated_at = now()
  where table_id = p_table_id and seat_index = v_seat_index;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select * from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_remove_debug_cpu_from_table$;

grant execute on function public.remove_debug_cpu_from_table(uuid) to authenticated;

