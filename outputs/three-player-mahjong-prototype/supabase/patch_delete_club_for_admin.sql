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
  v_ref record;
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

  -- Keep historical replay/stat rows usable, but detach them from the club/tables/games
  -- so old or missing ON DELETE SET NULL constraints cannot block actual club deletion.
  if to_regclass('public.player_replay_stats') is not null then
    execute '
      update public.player_replay_stats
      set club_id = null,
          table_id = null
      where club_id = $1
         or table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'player_replay_stats'
        and column_name = 'game_id'
    ) then
      execute '
        update public.player_replay_stats
        set game_id = null
        where game_id in (
          select g.game_id
          from public.games g
          join public.tables t on t.table_id = g.table_id
          where t.club_id = $1
        )
      ' using p_club_id;
    end if;
  end if;

  if to_regclass('public.replays') is not null then
    execute '
      update public.replays
      set club_id = null,
          table_id = null
      where club_id = $1
         or table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'replays'
        and column_name = 'game_id'
    ) then
      execute '
        update public.replays
        set game_id = null
        where game_id in (
          select g.game_id
          from public.games g
          join public.tables t on t.table_id = g.table_id
          where t.club_id = $1
        )
      ' using p_club_id;
    end if;
  end if;

  -- Delete club-bound financial rows before removing members/tables. These rows are
  -- historical inside the deleted club and otherwise commonly block old schemas.
  if to_regclass('public.club_rake_logs') is not null then
    execute 'delete from public.club_rake_logs where club_id = $1' using p_club_id;
  end if;

  if to_regclass('public.club_points') is not null then
    execute 'delete from public.club_points where club_id = $1' using p_club_id;
  end if;

  if to_regclass('public.club_super_rake_shares') is not null then
    execute 'delete from public.club_super_rake_shares where club_id = $1' using p_club_id;
  end if;

  -- Last line of defense: find every public FK that points at games/tables/clubs
  -- and clear/delete matching child rows before deleting the parent rows. This keeps
  -- the RPC working even when the live DB has older or extra tables not listed above.
  if to_regclass('public.games') is not null and to_regclass('public.tables') is not null then
    for v_ref in
      select
        con.conrelid::regclass as ref_table,
        att.attname as ref_col,
        att.attnotnull as ref_col_not_null
      from pg_constraint con
      join unnest(con.conkey) with ordinality ck(attnum, ord) on true
      join unnest(con.confkey) with ordinality fk(attnum, ord) on fk.ord = ck.ord
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ck.attnum
      join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = fk.attnum
      join pg_class cls on cls.oid = con.conrelid
      join pg_namespace ns on ns.oid = cls.relnamespace
      where con.contype = 'f'
        and ns.nspname = 'public'
        and con.confrelid = 'public.games'::regclass
        and fatt.attname = 'game_id'
    loop
      if v_ref.ref_col_not_null then
        execute format(
          'delete from %s where %I in (
             select g.game_id
             from public.games g
             join public.tables t on t.table_id = g.table_id
             where t.club_id = $1
           )',
          v_ref.ref_table,
          v_ref.ref_col
        ) using p_club_id;
      else
        execute format(
          'update %s set %I = null where %I in (
             select g.game_id
             from public.games g
             join public.tables t on t.table_id = g.table_id
             where t.club_id = $1
           )',
          v_ref.ref_table,
          v_ref.ref_col,
          v_ref.ref_col
        ) using p_club_id;
      end if;
    end loop;
  end if;

  if to_regclass('public.tables') is not null then
    for v_ref in
      select
        con.conrelid::regclass as ref_table,
        att.attname as ref_col,
        att.attnotnull as ref_col_not_null
      from pg_constraint con
      join unnest(con.conkey) with ordinality ck(attnum, ord) on true
      join unnest(con.confkey) with ordinality fk(attnum, ord) on fk.ord = ck.ord
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ck.attnum
      join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = fk.attnum
      join pg_class cls on cls.oid = con.conrelid
      join pg_namespace ns on ns.oid = cls.relnamespace
      where con.contype = 'f'
        and ns.nspname = 'public'
        and con.confrelid = 'public.tables'::regclass
        and fatt.attname = 'table_id'
    loop
      if v_ref.ref_col_not_null then
        execute format(
          'delete from %s where %I in (select table_id from public.tables where club_id = $1)',
          v_ref.ref_table,
          v_ref.ref_col
        ) using p_club_id;
      else
        execute format(
          'update %s set %I = null where %I in (select table_id from public.tables where club_id = $1)',
          v_ref.ref_table,
          v_ref.ref_col,
          v_ref.ref_col
        ) using p_club_id;
      end if;
    end loop;
  end if;

  for v_ref in
    select
      con.conrelid::regclass as ref_table,
      att.attname as ref_col,
      att.attnotnull as ref_col_not_null
    from pg_constraint con
    join unnest(con.conkey) with ordinality ck(attnum, ord) on true
    join unnest(con.confkey) with ordinality fk(attnum, ord) on fk.ord = ck.ord
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = ck.attnum
    join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = fk.attnum
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where con.contype = 'f'
      and ns.nspname = 'public'
      and con.confrelid = 'public.clubs'::regclass
      and fatt.attname = 'club_id'
      and con.conrelid <> 'public.club_delete_point_logs'::regclass
  loop
    if v_ref.ref_col_not_null then
      execute format(
        'delete from %s where %I = $1',
        v_ref.ref_table,
        v_ref.ref_col
      ) using p_club_id;
    else
      execute format(
        'update %s set %I = null where %I = $1',
        v_ref.ref_table,
        v_ref.ref_col,
        v_ref.ref_col
      ) using p_club_id;
    end if;
  end loop;

  if to_regclass('public.player_connections') is not null then
    execute '
      delete from public.player_connections
      where table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
  end if;

  if to_regclass('public.table_waiting_list') is not null then
    execute '
      delete from public.table_waiting_list
      where table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
  end if;

  if to_regclass('public.table_seats') is not null then
    execute '
      delete from public.table_seats
      where table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
  end if;

  if to_regclass('public.game_events') is not null then
    execute '
      delete from public.game_events
      where table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
  end if;

  if to_regclass('public.game_states') is not null then
    execute '
      delete from public.game_states
      where table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
  end if;

  if to_regclass('public.games') is not null then
    execute '
      delete from public.games
      where table_id in (select table_id from public.tables where club_id = $1)
    ' using p_club_id;
  end if;

  if to_regclass('public.tables') is not null then
    execute 'delete from public.tables where club_id = $1' using p_club_id;
  end if;

  if to_regclass('public.club_join_requests') is not null then
    execute 'delete from public.club_join_requests where club_id = $1' using p_club_id;
  end if;

  if to_regclass('public.club_members') is not null then
    execute 'delete from public.club_members where club_id = $1' using p_club_id;
  end if;

  delete from public.clubs
  where club_id = p_club_id;

  if exists (select 1 from public.clubs where club_id = p_club_id) then
    raise exception 'club delete failed: club row still exists';
  end if;

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
