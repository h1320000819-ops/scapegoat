-- Allow game settlements to make player club-point balances negative.
-- Manual admin grant/collect RPCs can still reject negative balances.

alter table public.club_members
  alter column point_balance type numeric(14, 1)
  using point_balance::numeric;

alter table public.club_points
  alter column amount type numeric(14, 1)
  using amount::numeric;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'club_members'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%point_balance%'
  loop
    execute format('alter table public.club_members drop constraint if exists %I', v_constraint.conname);
  end loop;
end;
$$;

select 'patch_allow_negative_game_settlement_balances_ok' as result;
