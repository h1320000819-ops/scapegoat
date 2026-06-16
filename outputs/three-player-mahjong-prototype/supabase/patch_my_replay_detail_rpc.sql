-- Detail fetch for replay playback.
-- The list RPC intentionally returns only summary data; playback needs snapshots.

drop function if exists public.get_my_replay(uuid);

create or replace function public.get_my_replay(p_replay_id uuid)
returns table (
  replay_id uuid,
  club_id uuid,
  table_id uuid,
  game_id uuid,
  summary jsonb,
  initial_state jsonb,
  events jsonb,
  snapshots jsonb,
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
    r.initial_state,
    r.events,
    r.snapshots,
    r.created_at
  from public.replays r
  where r.replay_id = p_replay_id
    and auth.uid() is not null
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
  limit 1
';

grant execute on function public.get_my_replay(uuid) to authenticated;

select 'patch_my_replay_detail_rpc_ok' as result;
