-- Account display name update RPC.
-- Run this in Supabase SQL Editor if name changes fail because of RLS.

drop function if exists public.update_my_display_name(text);

create or replace function public.update_my_display_name(p_display_name text)
returns public.users
language plpgsql
security definer
set search_path = public
as $anmika_update_my_display_name$
declare
  v_user public.users;
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  v_display_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_display_name is null then
    raise exception 'display name required';
  end if;

  update public.users
  set display_name = v_display_name,
      updated_at = now()
  where user_id = auth.uid()
  returning * into v_user;

  if v_user.user_id is null then
    raise exception 'user profile not found';
  end if;

  return v_user;
end;
$anmika_update_my_display_name$;

grant execute on function public.update_my_display_name(text) to authenticated;

select 'patch_account_display_name_rpc_ok' as result;
