-- Detail fetch for replay playback.
-- Normal accounts can fetch only replays they participated in.
-- The privileged account can fetch every replay.

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
      auth.uid() = ''3cda7884-9464-4b26-b7a2-bd79cc5ab65f''::uuid
      or exists (
        select 1
        from public.users u
        where u.user_id = auth.uid()
          and lower(coalesce(u.auth_email, '''')) = ''h1320000819@gamil.com''
      )
      or
      exists (
        select 1
        from public.player_replay_stats prs
        where prs.replay_id = r.replay_id
          and prs.user_id = auth.uid()
          and coalesce(prs.is_cpu, false) = false
      )
      or r.summary->''players'' @> jsonb_build_array(jsonb_build_object(''playerId'', auth.uid()::text))
    )
  limit 1
';

grant execute on function public.get_my_replay(uuid) to authenticated;

select 'patch_my_replay_detail_rpc_ok' as result;
