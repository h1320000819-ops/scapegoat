-- 02: Authoritative table seating RPC.
-- Run this whole file in Supabase SQL Editor.

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
  where table_id = p_table_id;

  if v_table_club_id is null then
    raise exception 'table not found';
  end if;

  if not public.is_club_member(v_table_club_id, v_user_id) then
    raise exception 'not club member';
  end if;

  if exists (
    select 1
    from public.table_seats
    where table_id = p_table_id
      and user_id = v_user_id
  ) then
    return query
    select *
    from public.table_seats
    where table_id = p_table_id
    order by seat_index asc;
    return;
  end if;

  if p_seat_index is not null then
    select seat_index into v_target_seat_index
    from public.table_seats
    where table_id = p_table_id
      and seat_index = p_seat_index
      and (user_id is null or player_type = 'cpu')
    limit 1;
  else
    select seat_index into v_target_seat_index
    from public.table_seats
    where table_id = p_table_id
      and (user_id is null or player_type = 'cpu')
      and player_type in ('empty', 'cpu')
    order by case when player_type = 'empty' then 0 else 1 end, seat_index asc
    limit 1;
  end if;

  if v_target_seat_index is null then
    raise exception 'no empty seat';
  end if;

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

select 'online_authority_02_ok' as result;
