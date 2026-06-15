-- Account-wide replay list for the current signed-in user.
-- Shows the latest 100 replays from clubs the user belongs to.

drop function if exists public.get_my_replays();

create or replace function public.get_my_replays()
returns table (
  replay_id uuid,
  club_id uuid,
  table_id uuid,
  game_id uuid,
  summary jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as '
  select
    r.replay_id,
    r.club_id,
    r.table_id,
    r.game_id,
    r.summary,
    r.created_at
  from public.replays r
  where auth.uid() is not null
    and exists (
      select 1
      from public.club_members cm
      where cm.club_id = r.club_id
        and cm.user_id = auth.uid()
    )
  order by r.created_at desc
  limit 100
';

grant execute on function public.get_my_replays() to authenticated;

select 'patch_my_replays_rpc_ok' as result;
