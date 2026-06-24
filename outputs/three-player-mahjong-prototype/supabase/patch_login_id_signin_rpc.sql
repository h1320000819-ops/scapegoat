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
