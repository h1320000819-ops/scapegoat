-- Club point safety patch.
-- Total club point supply is fixed at 10000000:
--   club reserve = 10000000 - sum(club_members.point_balance)
-- Admin grant spends from club reserve.
-- Admin collect returns points to club reserve.
-- User transfer moves points between users.
-- Send/collect/transfer operations never allow the payer to go below 0.
-- Game settlement may still make a player negative through separate game logic.

create table if not exists public.club_points (
  point_log_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  amount integer not null,
  reason text not null,
  game_id uuid,
  created_at timestamptz not null default now()
);

alter table public.club_members
  add column if not exists point_balance integer not null default 0;

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

create or replace function public.get_club_point_summary(p_club_id uuid)
returns table (
  club_id uuid,
  fixed_total integer,
  member_total integer,
  club_reserve integer
)
language sql
security definer
set search_path = public
as $anmika_get_club_point_summary$
  select
    p_club_id as club_id,
    10000000::integer as fixed_total,
    coalesce(sum(cm.point_balance), 0)::integer as member_total,
    (10000000 - coalesce(sum(cm.point_balance), 0))::integer as club_reserve
  from public.club_members cm
  where cm.club_id = p_club_id;
$anmika_get_club_point_summary$;

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
declare
  v_reserve integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_amount > 10000000 then
    raise exception 'amount exceeds club point limit';
  end if;
  if not public.is_club_admin(p_club_id, auth.uid()) then
    raise exception 'admin required';
  end if;
  if not public.is_club_member(p_club_id, p_to_user_id) then
    raise exception 'target is not club member';
  end if;

  select club_reserve into v_reserve
  from public.get_club_point_summary(p_club_id);

  if v_reserve < p_amount then
    raise exception 'club reserve would be negative';
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
declare
  v_balance integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_amount > 10000000 then
    raise exception 'amount exceeds club point limit';
  end if;
  if not public.is_club_admin(p_club_id, auth.uid()) then
    raise exception 'admin required';
  end if;
  if not public.is_club_member(p_club_id, p_from_user_id) then
    raise exception 'target is not club member';
  end if;

  select point_balance into v_balance
  from public.club_members
  where club_id = p_club_id and user_id = p_from_user_id
  for update;

  if v_balance < p_amount then
    raise exception 'member balance would be negative';
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
declare
  v_balance integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_amount > 10000000 then
    raise exception 'amount exceeds club point limit';
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

  select point_balance into v_balance
  from public.club_members
  where club_id = p_club_id and user_id = auth.uid()
  for update;

  if v_balance < p_amount then
    raise exception 'member balance would be negative';
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

-- Rake logs are admin-only visible.
alter table if exists public.club_rake_logs enable row level security;
drop policy if exists "rake club members read" on public.club_rake_logs;
drop policy if exists "rake club admins read" on public.club_rake_logs;
drop policy if exists "rake club members insert" on public.club_rake_logs;

create policy "rake club admins read"
on public.club_rake_logs for select
to authenticated
using (public.is_club_admin(club_id, auth.uid()));

create policy "rake club members insert"
on public.club_rake_logs for insert
to authenticated
with check (public.is_club_member(club_id, auth.uid()));

grant execute on function public.get_club_point_summary(uuid) to authenticated;
grant execute on function public.admin_grant_club_points(uuid, uuid, integer) to authenticated;
grant execute on function public.admin_collect_club_points(uuid, uuid, integer) to authenticated;
grant execute on function public.transfer_my_club_points(uuid, uuid, integer) to authenticated;

select 'patch_club_points_fixed_total_10000000_ok' as result;

