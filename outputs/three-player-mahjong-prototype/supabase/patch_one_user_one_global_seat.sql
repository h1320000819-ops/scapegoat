-- Enforce one account = one seat across all tables.
-- Run this whole file in Supabase SQL Editor.
-- Pressed seat wins: when a user sits, every other seat held by that user is released.

drop function if exists public.shared_sit_at_table(uuid, integer);

create or replace function public.shared_sit_at_table(p_table_id uuid, p_seat_index integer)
returns table (
  table_id uuid,
  seat_index smallint,
  user_id uuid,
  player_type text,
  display_name text,
  is_last_hand_declared boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as '
  with target_table as (
    select t.*
    from public.tables t
    where t.table_id = p_table_id
      and t.status <> ''ended''
      and auth.uid() is not null
      and exists (
        select 1
        from public.club_members m
        where m.club_id = t.club_id
          and m.user_id = auth.uid()
      )
  ),
  target_seat as (
    select s.table_id, s.seat_index
    from public.table_seats s
    join target_table t on t.table_id = s.table_id
    where (
        (p_seat_index is not null and s.seat_index = p_seat_index)
        or p_seat_index is null
      )
      and (
        s.user_id is null
        or s.player_type = ''cpu''
        or s.user_id = auth.uid()
      )
      and s.player_type in (''empty'', ''cpu'', ''human'')
    order by
      case when p_seat_index is not null and s.seat_index = p_seat_index then 0 else 1 end,
      case when s.user_id = auth.uid() then 0 when s.player_type = ''empty'' then 1 else 2 end,
      s.seat_index asc
    limit 1
  ),
  released_other_seats as (
    update public.table_seats s
    set user_id = null,
        player_type = ''empty'',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat ts
    where s.user_id = auth.uid()
      and not (s.table_id = ts.table_id and s.seat_index = ts.seat_index)
    returning s.table_id
  ),
  updated_seat as (
    update public.table_seats s
    set user_id = auth.uid(),
        player_type = ''human'',
        display_name = null,
        is_last_hand_declared = false,
        updated_at = now()
    from target_seat ts
    where s.table_id = ts.table_id
      and s.seat_index = ts.seat_index
    returning s.table_id
  ),
  refreshed_released_tables as (
    update public.tables t
    set is_debug = exists (
          select 1 from public.table_seats s
          where s.table_id = t.table_id and s.player_type = ''cpu''
        ),
        status = case
          when t.status = ''playing'' then t.status
          when (
            select count(*)
            from public.table_seats s
            where s.table_id = t.table_id
              and (s.user_id is not null or s.player_type = ''cpu'')
          ) >= 3 then ''playing''
          else ''waiting''
        end
    where t.table_id in (select table_id from released_other_seats)
    returning t.table_id
  ),
  refreshed_target_table as (
    update public.tables t
    set is_debug = exists (
          select 1 from public.table_seats s
          where s.table_id = p_table_id and s.player_type = ''cpu''
        ),
        status = case
          when t.status = ''playing'' then t.status
          when (
            select count(*)
            from public.table_seats s
            where s.table_id = p_table_id
              and (s.user_id is not null or s.player_type = ''cpu'')
          ) >= 3 then ''playing''
          else ''waiting''
        end
    where t.table_id = p_table_id
      and exists (select 1 from updated_seat)
    returning t.table_id
  )
  select * from public.shared_get_table_seats(p_table_id)
';

grant execute on function public.shared_sit_at_table(uuid, integer) to authenticated;

drop function if exists public.sit_at_table(uuid);
drop function if exists public.sit_at_table(uuid, smallint, uuid);

create or replace function public.sit_at_table(
  p_table_id uuid,
  p_seat_index smallint default null,
  p_user_id uuid default null
)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_table_club_id uuid;
  v_target_seat_index smallint;
begin
  v_user_id := coalesce(p_user_id, auth.uid());

  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if v_user_id <> auth.uid() then
    raise exception 'cannot seat another player';
  end if;

  select club_id into v_table_club_id
  from public.tables
  where table_id = p_table_id
    and status <> 'ended';

  if v_table_club_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_table_club_id, v_user_id) then
    raise exception 'not club member';
  end if;

  if p_seat_index is not null then
    select seat_index into v_target_seat_index
    from public.table_seats
    where table_id = p_table_id
      and seat_index = p_seat_index
      and (user_id is null or user_id = v_user_id or player_type = 'cpu')
      and player_type in ('empty', 'cpu', 'human')
    limit 1;
  else
    select seat_index into v_target_seat_index
    from public.table_seats
    where table_id = p_table_id
      and (user_id is null or user_id = v_user_id or player_type = 'cpu')
      and player_type in ('empty', 'cpu', 'human')
    order by case when user_id = v_user_id then 0 when player_type = 'empty' then 1 else 2 end, seat_index asc
    limit 1;
  end if;

  if v_target_seat_index is null then
    raise exception 'no empty seat';
  end if;

  update public.table_seats s
  set user_id = null,
      player_type = 'empty',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where s.user_id = v_user_id
    and not (s.table_id = p_table_id and s.seat_index = v_target_seat_index);

  update public.table_seats
  set user_id = v_user_id,
      player_type = 'human',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id
    and seat_index = v_target_seat_index;

  insert into public.player_connections (table_id, user_id, status, last_seen_at)
  values (p_table_id, v_user_id, 'online', now())
  on conflict (table_id, user_id) do update
  set status = excluded.status,
      last_seen_at = excluded.last_seen_at;

  perform public.try_start_table_game(p_table_id);

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$$;

grant execute on function public.sit_at_table(uuid, smallint, uuid) to authenticated;

select 'patch_one_user_one_global_seat_ok' as result;
