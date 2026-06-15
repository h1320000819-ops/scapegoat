-- Game settlement point writer.
-- Run this in Supabase SQL Editor.
-- This lets the Socket.IO game server apply shugi, tobi prizes,
-- hanchan settlement, and start-entry rake to club point balances.
-- Important: admin grant/collect still prevents manual negative balances;
-- this RPC intentionally allows game results to make a player negative.

alter table public.club_members
  alter column point_balance type numeric(14, 1)
  using point_balance::numeric;

alter table public.club_points
  alter column amount type numeric(14, 1)
  using amount::numeric;

alter table public.club_points
  add column if not exists table_id uuid references public.tables(table_id) on delete set null,
  add column if not exists game_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.club_rake_logs
  alter column amount type numeric(14, 1)
  using amount::numeric;

alter table if exists public.club_rake_logs
  alter column rake_amount type numeric(14, 1)
  using rake_amount::numeric;

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

  for v_item in
    select key, value
    from jsonb_each(p_deltas)
  loop
    v_user_id := v_item.key::uuid;
    v_amount := round((v_item.value #>> '{}')::numeric, 1);

    if v_amount = 0 then
      continue;
    end if;

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
end;
$$;

grant execute on function public.apply_game_club_point_deltas(uuid, uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.apply_game_club_point_deltas(uuid, uuid, text, text, jsonb, jsonb) to service_role;

select 'patch_game_club_point_settlement_rpc_ok' as result;
