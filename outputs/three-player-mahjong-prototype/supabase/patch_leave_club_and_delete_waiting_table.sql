-- Safe RPC patch: leave a club and delete waiting tables.
-- This patch does not delete replays, point history, rake logs, or audit logs.
-- Run this whole file in the Supabase SQL Editor.

create or replace function public.leave_club(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  if auth.uid() is null then
    raise exception ''login required'';
  end if;

  if to_regclass(''public.table_seats'') is not null then
    delete from public.table_seats
    where user_id = auth.uid()
      and table_id in (
        select table_id
        from public.tables
        where club_id = p_club_id
          and coalesce(status, ''waiting'') <> ''playing''
      );
  end if;

  if to_regclass(''public.table_waiting_list'') is not null then
    delete from public.table_waiting_list
    where user_id = auth.uid()
      and table_id in (
        select table_id
        from public.tables
        where club_id = p_club_id
      );
  end if;

  delete from public.club_members
  where club_id = p_club_id
    and user_id = auth.uid();
end;
';

grant execute on function public.leave_club(uuid) to authenticated;

create or replace function public.delete_table_if_not_started(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  if auth.uid() is null then
    raise exception ''login required'';
  end if;

  if not exists (
    select 1
    from public.tables
    where table_id = p_table_id
  ) then
    raise exception ''table not found'';
  end if;

  if not exists (
    select 1
    from public.tables
    where table_id = p_table_id
      and public.is_club_admin(club_id, auth.uid())
  ) then
    raise exception ''admin required'';
  end if;

  if to_regclass(''public.game_states'') is not null and exists (
    select 1
    from public.game_states
    where table_id = p_table_id
      and coalesce(is_active, false) = true
  ) then
    raise exception ''table is currently playing'';
  end if;

  if to_regclass(''public.table_waiting_list'') is not null then
    delete from public.table_waiting_list
    where table_id = p_table_id;
  end if;

  if to_regclass(''public.table_seats'') is not null then
    delete from public.table_seats
    where table_id = p_table_id;
  end if;

  if to_regclass(''public.game_events'') is not null then
    delete from public.game_events
    where table_id = p_table_id;
  end if;

  if to_regclass(''public.game_states'') is not null then
    delete from public.game_states
    where table_id = p_table_id;
  end if;

  if to_regclass(''public.games'') is not null then
    delete from public.games
    where table_id = p_table_id;
  end if;

  delete from public.tables
  where table_id = p_table_id;
end;
';

grant execute on function public.delete_table_if_not_started(uuid) to authenticated;

drop function if exists public.mark_table_waiting_if_no_active_game(uuid);

create or replace function public.mark_table_waiting_if_no_active_game(p_table_id uuid)
returns setof public.tables
language sql
security definer
set search_path = public
as '
  with allowed_table as (
    select t.*
    from public.tables t
    where t.table_id = p_table_id
      and auth.uid() is not null
      and public.is_club_member(t.club_id, auth.uid())
      and not exists (
        select 1
        from public.game_states gs
        where gs.table_id = t.table_id
          and coalesce(gs.is_active, false) = true
      )
  ),
  ended_games as (
    update public.games g
    set status = ''ended'',
        ended_at = coalesce(ended_at, now())
    from allowed_table a
    where g.table_id = a.table_id
      and g.status = ''playing''
    returning g.game_id
  ),
  updated_table as (
    update public.tables t
    set status = ''waiting''
    from allowed_table a
    where t.table_id = a.table_id
    returning t.*
  )
  select * from updated_table
';

grant execute on function public.mark_table_waiting_if_no_active_game(uuid) to authenticated;

drop function if exists public.sync_table_playing_status(uuid);

create or replace function public.sync_table_playing_status(p_table_id uuid)
returns setof public.tables
language sql
security definer
set search_path = public
as '
  with allowed_table as (
    select t.*
    from public.tables t
    where t.table_id = p_table_id
      and auth.uid() is not null
      and public.is_club_member(t.club_id, auth.uid())
  ),
  active_state as (
    select a.table_id
    from allowed_table a
    where exists (
      select 1
      from public.game_states gs
      where gs.table_id = a.table_id
        and coalesce(gs.is_active, false) = true
    )
  ),
  ended_games as (
    update public.games g
    set status = ''ended'',
        ended_at = coalesce(ended_at, now())
    from allowed_table a
    where g.table_id = a.table_id
      and g.status = ''playing''
      and not exists (select 1 from active_state s where s.table_id = a.table_id)
    returning g.game_id
  ),
  updated_table as (
    update public.tables t
    set status = case
      when exists (select 1 from active_state s where s.table_id = t.table_id) then ''playing''
      else ''waiting''
    end
    from allowed_table a
    where t.table_id = a.table_id
      and coalesce(t.status, ''waiting'') <> ''ended''
    returning t.*
  )
  select * from updated_table
';

grant execute on function public.sync_table_playing_status(uuid) to authenticated;

select 'patch_leave_club_and_delete_waiting_table_ok' as result;
