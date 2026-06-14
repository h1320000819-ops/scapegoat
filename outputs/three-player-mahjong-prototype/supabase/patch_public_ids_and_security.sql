-- Public ID / security patch for Anmika Rocket online debug.
-- Run this in Supabase SQL Editor.

alter table public.users add column if not exists login_id text;
alter table public.users add column if not exists auth_provider text not null default 'password';
alter table public.users add column if not exists updated_at timestamptz not null default now();
create unique index if not exists users_login_id_unique_idx on public.users(login_id);

alter table public.clubs add column if not exists club_code text;
alter table public.clubs add column if not exists updated_at timestamptz not null default now();
create unique index if not exists clubs_club_code_unique_idx on public.clubs(club_code);

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

-- Backfill existing rows without a DO block so the patch is easy to paste into
-- Supabase SQL Editor. The generator functions are VOLATILE, so they are
-- evaluated per updated row.
update public.users
set login_id = public.generate_unique_login_id(),
    updated_at = now()
where login_id is null;

update public.clubs
set club_code = public.generate_unique_club_code(),
    updated_at = now()
where club_code is null;

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

select 'users_login_id' as item, count(*) from public.users where login_id is not null
union all
select 'clubs_club_code' as item, count(*) from public.clubs where club_code is not null;
