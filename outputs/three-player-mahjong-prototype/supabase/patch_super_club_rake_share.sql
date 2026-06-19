-- Super account club participation and club-by-club rake share.
-- Super account: 3cda7884-9464-4b26-b7a2-bd79cc5ab65f / h1320000819@gamil.com
--
-- Behavior:
-- - The super account is treated as a member of every club.
-- - The super account can set a rake share percent per club.
-- - When game settlement writes club-point deltas and metadata.rake exists,
--   the configured share of the club-collected rake is moved from club reserve
--   to the super account's club member balance.

alter table public.club_members
  add column if not exists point_balance numeric(14, 1) not null default 0;

alter table public.clubs
  add column if not exists point_balance numeric(14, 1) not null default 0;

create table if not exists public.club_points (
  point_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(club_id) on delete cascade,
  user_id uuid references public.users(user_id) on delete set null,
  amount numeric(14, 1) not null default 0,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.club_members
  alter column point_balance type numeric(14, 1)
  using point_balance::numeric;

alter table public.clubs
  alter column point_balance type numeric(14, 1)
  using point_balance::numeric;

alter table public.club_points
  alter column amount type numeric(14, 1)
  using amount::numeric;

alter table public.club_points
  add column if not exists table_id uuid references public.tables(table_id) on delete set null,
  add column if not exists game_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

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

create table if not exists public.club_super_rake_shares (
  club_id uuid primary key references public.clubs(club_id) on delete cascade,
  percent numeric(5, 2) not null default 0 check (percent >= 0 and percent <= 100),
  updated_by uuid references public.users(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.club_super_rake_shares enable row level security;

drop policy if exists "super rake shares club members read" on public.club_super_rake_shares;
drop policy if exists "super rake shares club admins read" on public.club_super_rake_shares;
drop policy if exists "super rake shares super write" on public.club_super_rake_shares;

create policy "super rake shares club admins read"
on public.club_super_rake_shares for select
using (
  public.is_super_club_creator(auth.uid())
  or exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_super_rake_shares.club_id
      and cm.user_id = auth.uid()
      and cm.role = 'admin'
  )
);

create policy "super rake shares super write"
on public.club_super_rake_shares for all
using (public.is_super_club_creator(auth.uid()))
with check (public.is_super_club_creator(auth.uid()));

create or replace function public.ensure_super_club_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super_user_id uuid := '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid;
  v_count integer := 0;
begin
  insert into public.club_members (club_id, user_id, role, point_balance, joined_at)
  select c.club_id, v_super_user_id, 'admin', 0, now()
  from public.clubs c
  where exists (select 1 from public.users u where u.user_id = v_super_user_id)
  on conflict (club_id, user_id) do update
  set role = case when public.club_members.role = 'admin' then 'admin' else 'admin' end;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.ensure_super_club_memberships() to authenticated;
grant execute on function public.ensure_super_club_memberships() to service_role;

create or replace function public.is_club_member(p_club_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    public.is_super_club_creator(p_user_id)
    or exists (
      select 1
      from public.club_members
      where club_id = p_club_id
        and user_id = p_user_id
    ),
    false
  )
$$;

grant execute on function public.is_club_member(uuid, uuid) to anon, authenticated;

drop function if exists public.set_club_super_rake_share(uuid, numeric);

create or replace function public.set_club_super_rake_share(p_club_id uuid, p_percent numeric)
returns public.club_super_rake_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.club_super_rake_shares;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not public.is_super_club_creator(auth.uid()) then
    raise exception 'super account required';
  end if;

  if p_club_id is null then
    raise exception 'club_id is required';
  end if;

  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'percent must be between 0 and 100';
  end if;

  perform public.ensure_super_club_memberships();

  insert into public.club_super_rake_shares (club_id, percent, updated_by)
  values (p_club_id, round(p_percent::numeric, 2), auth.uid())
  on conflict (club_id) do update
  set percent = excluded.percent,
      updated_by = excluded.updated_by,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_club_super_rake_share(uuid, numeric) to authenticated;

drop function if exists public.get_club_super_rake_share(uuid);

create or replace function public.get_club_super_rake_share(p_club_id uuid)
returns table (
  club_id uuid,
  percent numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_club_id is null then
    raise exception 'club_id is required';
  end if;

  if not (
    public.is_super_club_creator(auth.uid())
    or exists (
      select 1
      from public.club_members cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  ) then
    raise exception 'admin required';
  end if;

  return query
  select p_club_id, coalesce(s.percent, 0), s.updated_at
  from (select p_club_id as club_id) base
  left join public.club_super_rake_shares s on s.club_id = base.club_id;
end;
$$;

grant execute on function public.get_club_super_rake_share(uuid) to authenticated;

drop function if exists public.apply_game_club_point_deltas(uuid, uuid, text, text, jsonb, jsonb);

create or replace function public.apply_game_club_point_deltas(
  p_club_id uuid,
  p_table_id uuid,
  p_game_key text,
  p_reason text,
  p_deltas jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_user_id uuid;
  v_amount numeric(14, 1);
  v_total_delta numeric(14, 1) := 0;
  v_club_delta numeric(14, 1) := 0;
  v_super_user_id uuid := '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid;
  v_share_percent numeric(5, 2) := 0;
  v_rake_amount numeric(14, 1) := 0;
  v_super_share numeric(14, 1) := 0;
begin
  if p_club_id is null then
    raise exception 'club_id is required';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required';
  end if;

  if p_deltas is null or jsonb_typeof(p_deltas) <> 'object' then
    raise exception 'deltas must be a json object';
  end if;

  perform public.ensure_super_club_memberships();

  for v_item in
    select key, value
    from jsonb_each(p_deltas)
  loop
    v_user_id := v_item.key::uuid;
    v_amount := round((v_item.value #>> '{}')::numeric, 1);

    if v_amount = 0 then
      continue;
    end if;

    v_total_delta := round((v_total_delta + v_amount)::numeric, 1);

    update public.club_members
    set point_balance = round((coalesce(point_balance, 0) + v_amount)::numeric, 1)
    where club_id = p_club_id
      and user_id = v_user_id;

    if not found then
      raise exception 'club member not found: %', v_user_id;
    end if;

    insert into public.club_points (
      club_id,
      user_id,
      amount,
      reason,
      table_id,
      game_key,
      metadata
    )
    values (
      p_club_id,
      v_user_id,
      v_amount,
      p_reason,
      p_table_id,
      p_game_key,
      coalesce(p_metadata, '{}'::jsonb)
    );
  end loop;

  v_club_delta := round((-v_total_delta)::numeric, 1);
  if v_club_delta <> 0 then
    update public.clubs
    set point_balance = round((coalesce(point_balance, 0) + v_club_delta)::numeric, 1)
    where club_id = p_club_id;

    if not found then
      raise exception 'club not found: %', p_club_id;
    end if;
  end if;

  select coalesce(percent, 0)
  into v_share_percent
  from public.club_super_rake_shares
  where club_id = p_club_id;

  if coalesce(v_share_percent, 0) <= 0 then
    return;
  end if;

  if coalesce(p_metadata, '{}'::jsonb) ? 'rake' then
    v_rake_amount := coalesce(
      nullif(p_metadata #>> '{rake,totalAmount}', '')::numeric,
      nullif(p_metadata #>> '{rake,rakeRaw}', '')::numeric,
      nullif(p_metadata #>> '{rake,playerDeduction}', '')::numeric,
      0
    );
  end if;

  v_rake_amount := round(greatest(coalesce(v_rake_amount, 0), 0)::numeric, 1);
  if v_rake_amount <= 0 then
    return;
  end if;

  v_super_share := round((v_rake_amount * v_share_percent / 100.0)::numeric, 1);
  if v_super_share <= 0 then
    return;
  end if;

  insert into public.club_members (club_id, user_id, role, point_balance, joined_at)
  values (p_club_id, v_super_user_id, 'admin', 0, now())
  on conflict (club_id, user_id) do update
  set role = 'admin';

  update public.club_members
  set point_balance = round((coalesce(point_balance, 0) + v_super_share)::numeric, 1)
  where club_id = p_club_id
    and user_id = v_super_user_id;

  update public.clubs
  set point_balance = round((coalesce(point_balance, 0) - v_super_share)::numeric, 1)
  where club_id = p_club_id;

  insert into public.club_points (
    club_id,
    user_id,
    amount,
    reason,
    table_id,
    game_key,
    metadata
  )
  values (
    p_club_id,
    v_super_user_id,
    v_super_share,
    'super_rake_share',
    p_table_id,
    p_game_key,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'superRakeShare',
      jsonb_build_object(
        'percent', v_share_percent,
        'rakeAmount', v_rake_amount,
        'shareAmount', v_super_share
      )
    )
  );
end;
$$;

grant execute on function public.apply_game_club_point_deltas(uuid, uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.apply_game_club_point_deltas(uuid, uuid, text, text, jsonb, jsonb) to service_role;

select 'patch_super_club_rake_share_ok' as result;
