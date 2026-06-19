-- Delete a club by the programmer/super account only.
-- Replays and rake logs with ON DELETE SET NULL references are kept when the schema allows it.
-- Tables, seats, memberships, join requests, point rows, and rake-share settings cascade where FKs are configured.
-- Point balances at deletion are copied to a programmer-only audit table before the club is removed.

create or replace function public.is_super_club_creator(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    p_user_id = '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid
    or exists (
      select 1
      from public.users u
      where u.user_id = p_user_id
        and lower(coalesce(u.auth_email, '')) = 'h1320000819@gamil.com'
    ),
    false
  )
$$;

grant execute on function public.is_super_club_creator(uuid) to authenticated;

create table if not exists public.club_delete_point_logs (
  log_id uuid primary key default gen_random_uuid(),
  deleted_club_id uuid not null,
  club_name text,
  club_code text,
  deleted_by uuid references public.users(user_id) on delete set null,
  entry_type text not null default 'member_balance',
  member_user_id uuid references public.users(user_id) on delete set null,
  member_name text,
  member_role text,
  point_balance numeric(14, 1) not null default 0,
  club_reserve_balance numeric(14, 1) not null default 0,
  fixed_total numeric(14, 1) not null default 10000000,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.club_delete_point_logs enable row level security;

drop policy if exists "club delete point logs programmer read" on public.club_delete_point_logs;
drop policy if exists "club delete point logs no client insert" on public.club_delete_point_logs;

create policy "club delete point logs programmer read"
on public.club_delete_point_logs for select
to authenticated
using (public.is_super_club_creator(auth.uid()));

create policy "club delete point logs no client insert"
on public.club_delete_point_logs for insert
to authenticated
with check (false);

create index if not exists club_delete_point_logs_created_idx
on public.club_delete_point_logs(created_at desc);

create index if not exists club_delete_point_logs_club_idx
on public.club_delete_point_logs(deleted_club_id, created_at desc);

drop function if exists public.delete_club_for_admin(uuid);

create or replace function public.delete_club_for_admin(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club public.clubs;
  v_fixed_total numeric(14, 1) := 10000000;
  v_member_total numeric(14, 1) := 0;
  v_club_reserve numeric(14, 1) := 0;
  v_snapshot_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if p_club_id is null then
    raise exception 'club_id is required';
  end if;

  select *
  into v_club
  from public.clubs
  where club_id = p_club_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'deleted', false, 'reason', 'not_found');
  end if;

  if not public.is_super_club_creator(auth.uid()) then
    raise exception 'super account required';
  end if;

  select round(coalesce(sum(cm.point_balance), 0)::numeric, 1)
  into v_member_total
  from public.club_members cm
  where cm.club_id = p_club_id;

  v_club_reserve := round((v_fixed_total - coalesce(v_member_total, 0))::numeric, 1);

  insert into public.club_delete_point_logs (
    deleted_club_id,
    club_name,
    club_code,
    deleted_by,
    entry_type,
    member_user_id,
    member_name,
    member_role,
    point_balance,
    club_reserve_balance,
    fixed_total,
    metadata
  )
  select
    p_club_id,
    v_club.name,
    v_club.club_code,
    auth.uid(),
    'member_balance',
    cm.user_id,
    coalesce(u.display_name, u.login_id, cm.user_id::text),
    cm.role,
    round(coalesce(cm.point_balance, 0)::numeric, 1),
    v_club_reserve,
    v_fixed_total,
    jsonb_build_object(
      'deletedAt', now(),
      'memberTotal', v_member_total,
      'clubReserve', v_club_reserve
    )
  from public.club_members cm
  left join public.users u on u.user_id = cm.user_id
  where cm.club_id = p_club_id;

  get diagnostics v_snapshot_count = row_count;

  insert into public.club_delete_point_logs (
    deleted_club_id,
    club_name,
    club_code,
    deleted_by,
    entry_type,
    member_user_id,
    member_name,
    member_role,
    point_balance,
    club_reserve_balance,
    fixed_total,
    metadata
  )
  values (
    p_club_id,
    v_club.name,
    v_club.club_code,
    auth.uid(),
    'club_reserve',
    null,
    'クラブ保管ポイント',
    'club',
    v_club_reserve,
    v_club_reserve,
    v_fixed_total,
    jsonb_build_object(
      'deletedAt', now(),
      'memberTotal', v_member_total,
      'memberSnapshotCount', v_snapshot_count
    )
  );

  delete from public.table_waiting_list
  where table_id in (select table_id from public.tables where club_id = p_club_id);

  delete from public.table_seats
  where table_id in (select table_id from public.tables where club_id = p_club_id);

  delete from public.game_events
  where table_id in (select table_id from public.tables where club_id = p_club_id);

  delete from public.game_states
  where table_id in (select table_id from public.tables where club_id = p_club_id);

  delete from public.games
  where table_id in (select table_id from public.tables where club_id = p_club_id);

  delete from public.tables
  where club_id = p_club_id;

  delete from public.clubs
  where club_id = p_club_id;

  return jsonb_build_object(
    'ok', true,
    'deleted', true,
    'clubId', p_club_id,
    'name', v_club.name,
    'pointSnapshotCount', v_snapshot_count + 1
  );
end;
$$;

grant execute on function public.delete_club_for_admin(uuid) to authenticated;
grant select on public.club_delete_point_logs to authenticated;

select 'patch_delete_club_for_admin_ok' as result;
