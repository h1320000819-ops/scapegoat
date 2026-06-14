-- Anmika Rocket: club point transfer RPC patch
-- Run this whole file in Supabase SQL Editor to enable point send/collect
-- from the online debug club point screen.

create table if not exists public.club_points (
  point_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  amount integer not null,
  reason text not null,
  game_id uuid,
  created_at timestamptz not null default now()
);

alter table public.club_points enable row level security;

drop policy if exists "points club members read" on public.club_points;
drop policy if exists "points club members insert" on public.club_points;

create policy "points club members read"
on public.club_points for select
to authenticated
using (public.is_club_member(club_id, auth.uid()));

create policy "points club members insert"
on public.club_points for insert
to authenticated
with check (public.is_club_member(club_id, auth.uid()));

create or replace function public.admin_grant_club_points(
  p_club_id uuid,
  p_to_user_id uuid,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = public
as $anmika_admin_grant_club_points$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not public.is_club_admin(p_club_id, auth.uid()) then
    raise exception 'admin required';
  end if;
  if not public.is_club_member(p_club_id, p_to_user_id) then
    raise exception 'target is not club member';
  end if;

  update public.club_members
  set point_balance = point_balance + p_amount
  where club_id = p_club_id and user_id = p_to_user_id;

  insert into public.club_points (club_id, user_id, amount, reason)
  values (p_club_id, p_to_user_id, p_amount, 'admin_grant');
end;
$anmika_admin_grant_club_points$;

create or replace function public.admin_collect_club_points(
  p_club_id uuid,
  p_from_user_id uuid,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = public
as $anmika_admin_collect_club_points$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not public.is_club_admin(p_club_id, auth.uid()) then
    raise exception 'admin required';
  end if;
  if not public.is_club_member(p_club_id, p_from_user_id) then
    raise exception 'target is not club member';
  end if;

  update public.club_members
  set point_balance = point_balance - p_amount
  where club_id = p_club_id and user_id = p_from_user_id;

  insert into public.club_points (club_id, user_id, amount, reason)
  values (p_club_id, p_from_user_id, -p_amount, 'admin_collect');
end;
$anmika_admin_collect_club_points$;

create or replace function public.transfer_my_club_points(
  p_club_id uuid,
  p_to_user_id uuid,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = public
as $anmika_transfer_my_club_points$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not public.is_club_member(p_club_id, auth.uid()) then
    raise exception 'not club member';
  end if;
  if not public.is_club_member(p_club_id, p_to_user_id) then
    raise exception 'target is not club member';
  end if;
  if auth.uid() = p_to_user_id then
    raise exception 'cannot transfer to yourself';
  end if;

  update public.club_members
  set point_balance = point_balance - p_amount
  where club_id = p_club_id and user_id = auth.uid();

  update public.club_members
  set point_balance = point_balance + p_amount
  where club_id = p_club_id and user_id = p_to_user_id;

  insert into public.club_points (club_id, user_id, amount, reason)
  values
    (p_club_id, auth.uid(), -p_amount, 'user_transfer'),
    (p_club_id, p_to_user_id, p_amount, 'user_transfer');
end;
$anmika_transfer_my_club_points$;

grant execute on function public.admin_grant_club_points(uuid, uuid, integer) to authenticated;
grant execute on function public.admin_collect_club_points(uuid, uuid, integer) to authenticated;
grant execute on function public.transfer_my_club_points(uuid, uuid, integer) to authenticated;

select 'patch_club_points_rpc_ok' as result;
