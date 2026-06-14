-- Last-hand leaving and per-table waiting queue.
-- Execute this whole file in Supabase SQL Editor.

create table if not exists public.table_waiting_list (
  table_id uuid not null references public.tables(table_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

alter table public.table_waiting_list enable row level security;

drop policy if exists "waiting club members read" on public.table_waiting_list;
drop policy if exists "waiting join self" on public.table_waiting_list;
drop policy if exists "waiting leave self" on public.table_waiting_list;

create policy "waiting club members read"
on public.table_waiting_list for select
using (
  exists (
    select 1
    from public.tables t
    join public.club_members m on m.club_id = t.club_id
    where t.table_id = table_waiting_list.table_id
      and m.user_id = auth.uid()
  )
);

create policy "waiting join self"
on public.table_waiting_list for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tables t
    join public.club_members m on m.club_id = t.club_id
    where t.table_id = table_waiting_list.table_id
      and m.user_id = auth.uid()
  )
);

create policy "waiting leave self"
on public.table_waiting_list for delete
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.tables t
    join public.club_members m on m.club_id = t.club_id
    where t.table_id = table_waiting_list.table_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  )
);

create or replace function public.clear_my_table_waiting()
returns void
language sql
security definer
set search_path = public
as '
  delete from public.table_waiting_list
  where user_id = auth.uid()
';

grant execute on function public.clear_my_table_waiting() to authenticated;

create or replace function public.toggle_table_waiting(p_table_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $anmika_toggle_table_waiting$
declare
  v_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from public.tables t
    join public.club_members m on m.club_id = t.club_id
    where t.table_id = p_table_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'not club member';
  end if;

  if exists (
    select 1
    from public.table_seats
    where table_id = p_table_id
      and user_id = auth.uid()
  ) then
    raise exception 'already seated at this table';
  end if;

  if exists (
    select 1
    from public.table_waiting_list
    where table_id = p_table_id
      and user_id = auth.uid()
  ) then
    delete from public.table_waiting_list
    where table_id = p_table_id
      and user_id = auth.uid();
    v_enabled := false;
  else
    insert into public.table_waiting_list (table_id, user_id)
    values (p_table_id, auth.uid())
    on conflict (table_id, user_id) do nothing;
    v_enabled := true;
  end if;

  return v_enabled;
end;
$anmika_toggle_table_waiting$;

grant execute on function public.toggle_table_waiting(uuid) to authenticated;

create or replace function public.promote_waiting_player_for_table(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_promote_waiting_player_for_table$
declare
  v_waiting_user uuid;
  v_seat_index smallint;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from public.tables t
    join public.club_members m on m.club_id = t.club_id
    where t.table_id = p_table_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'not club member';
  end if;

  loop
    select s.seat_index into v_seat_index
    from public.table_seats s
    where s.table_id = p_table_id
      and (s.user_id is null or s.player_type = 'cpu')
    order by case when s.player_type = 'empty' then 0 else 1 end, s.seat_index asc
    limit 1;

    if v_seat_index is null then
      exit;
    end if;

    select w.user_id into v_waiting_user
    from public.table_waiting_list w
    where w.table_id = p_table_id
    order by w.created_at asc
    limit 1;

    if v_waiting_user is null then
      exit;
    end if;

    delete from public.table_waiting_list
    where user_id = v_waiting_user;

    update public.table_seats
    set user_id = null,
        player_type = 'empty',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    where user_id = v_waiting_user;

    update public.table_seats
    set user_id = v_waiting_user,
        player_type = 'human',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    where table_id = p_table_id
      and seat_index = v_seat_index;
  end loop;

  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_promote_waiting_player_for_table$;

grant execute on function public.promote_waiting_player_for_table(uuid) to authenticated;

create or replace function public.resolve_last_hand_leavers(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $anmika_resolve_last_hand_leavers$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from public.tables t
    join public.club_members m on m.club_id = t.club_id
    where t.table_id = p_table_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'not club member';
  end if;

  update public.table_seats
  set user_id = null,
      player_type = 'empty',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id
    and is_last_hand_declared = true
    and user_id is not null;

  perform public.promote_waiting_player_for_table(p_table_id);
  perform public.refresh_table_lobby_status(p_table_id);

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$anmika_resolve_last_hand_leavers$;

grant execute on function public.resolve_last_hand_leavers(uuid) to authenticated;

select 'patch_last_hand_waiting_queue_safe_ok' as result;
