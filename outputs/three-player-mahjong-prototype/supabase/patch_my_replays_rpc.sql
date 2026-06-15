-- Account-wide replay list for the current signed-in user.
-- Shows the latest 100 replays the account participated in.

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
    and (
      exists (
        select 1
        from public.player_replay_stats prs
        where prs.replay_id = r.replay_id
          and prs.user_id = auth.uid()
      )
      or exists (
      select 1
      from public.club_members cm
      where cm.club_id = r.club_id
        and cm.user_id = auth.uid()
      )
      or r.summary->''players'' @> jsonb_build_array(jsonb_build_object(''playerId'', auth.uid()::text))
    )
  order by r.created_at desc
  limit 100
';

grant execute on function public.get_my_replays() to authenticated;

select 'patch_my_replays_rpc_ok' as result;
