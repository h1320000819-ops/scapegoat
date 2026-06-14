-- Run this in Supabase SQL Editor if club creation fails with:
-- new row violates row-level security policy for table "clubs"

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

  insert into public.clubs (name, owner_user_id)
  values (coalesce(nullif(p_name, ''), 'テストクラブ'), auth.uid())
  returning * into v_club;

  insert into public.club_members (club_id, user_id, role)
  values (v_club.club_id, auth.uid(), 'admin')
  on conflict (club_id, user_id) do nothing;

  return v_club;
end;
$anmika_create_club_with_owner$;

grant execute on function public.create_club_with_owner(text) to authenticated;

select proname
from pg_proc
where proname = 'create_club_with_owner';
