-- Force-leave the current authenticated player after a last-hand game ends.
-- This does not depend on table_seats.is_last_hand_declared, because the
-- in-game last-hand flag is managed by the Socket.IO game state.

drop function if exists public.leave_table_after_last_hand(uuid);

create or replace function public.leave_table_after_last_hand(p_table_id uuid)
returns setof public.table_seats
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if p_table_id is null then
    raise exception 'table_id is required';
  end if;

  delete from public.table_waiting_list
  where user_id = auth.uid();

  update public.table_seats
  set user_id = null,
      player_type = 'empty',
      display_name = null,
      is_last_hand_declared = false,
      updated_at = now()
  where table_id = p_table_id
    and user_id = auth.uid();

  update public.tables
  set status = 'waiting',
      updated_at = now()
  where table_id = p_table_id
    and status <> 'ended'
    and not exists (
      select 1
      from public.game_states gs
      where gs.table_id = p_table_id
        and gs.is_active = true
    );

  return query
  select *
  from public.table_seats
  where table_id = p_table_id
  order by seat_index asc;
end;
$$;

grant execute on function public.leave_table_after_last_hand(uuid) to authenticated;

select 'patch_leave_table_after_last_hand_ok' as result;
