-- Club owner membership repair patch.
-- Run this in Supabase SQL Editor when created clubs do not appear in the
-- joined-club list.

create or replace function public.is_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $anmika_is_club_member$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_user_id
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
    select 1 from public.club_members
    where club_id = p_club_id and user_id = p_user_id and role = 'admin'
  );
$anmika_is_club_admin$;

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
  values (public.generate_unique_club_code(), coalesce(nullif(p_name, ''), 'Test Club'), auth.uid())
  returning * into v_club;

  insert into public.club_members (club_id, user_id, role)
  values (v_club.club_id, auth.uid(), 'admin')
  on conflict (club_id, user_id) do update
  set role = 'admin';

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
  select c.club_id, auth.uid(), 'admin'
  from public.clubs c
  where c.owner_user_id = auth.uid()
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

drop policy if exists "club members own or same club read" on public.club_members;

create policy "club members own or same club read"
on public.club_members for select
using (
  auth.uid() = user_id
  or public.is_club_member(club_id, auth.uid())
);

select 'owner_memberships' as item, count(*) as count
from public.club_members cm
join public.clubs c on c.club_id = cm.club_id
where c.owner_user_id = cm.user_id and cm.role = 'admin';
