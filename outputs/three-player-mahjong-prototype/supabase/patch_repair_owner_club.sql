-- Run this in Supabase SQL Editor if:
-- - club creation says the owner already has a club
-- - but "My clubs" / joined clubs is empty

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

select proname
from pg_proc
where proname in ('create_club_with_owner', 'repair_my_owner_memberships')
order by proname;
