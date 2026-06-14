-- Run this in Supabase SQL Editor if account creation fails with:
-- - ensure_user_profile not found
-- - row-level security policy for table "users"

create extension if not exists pgcrypto;

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

  insert into public.users (user_id, auth_email, display_name)
  values (p_user_id::uuid, p_auth_email, coalesce(nullif(p_display_name, ''), 'Player'))
  on conflict (user_id) do update
  set auth_email = excluded.auth_email,
      display_name = coalesce(nullif(public.users.display_name, ''), excluded.display_name)
  returning * into v_user;

  return v_user;
end;
$anmika_ensure_user_profile$;

grant execute on function public.ensure_user_profile(text, text, text) to authenticated;

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
  limit 1;
$anmika_get_login_email$;

grant execute on function public.get_login_email(text) to anon, authenticated;

select proname
from pg_proc
where proname in ('ensure_user_profile', 'get_login_email')
order by proname;
