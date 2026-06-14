-- Online GameState sync RPC for Anmika Rocket.
-- Run this in Supabase SQL Editor.

drop function if exists public.publish_game_state(uuid, uuid, jsonb, integer);

create or replace function public.publish_game_state(
  p_game_id uuid,
  p_table_id uuid,
  p_state jsonb,
  p_version integer
)
returns setof public.game_states
language sql
security definer
set search_path = public
as '
  update public.game_states as gs
  set
    version = greatest(coalesce(p_version, 0), coalesce(gs.version, 0) + 1),
    state = p_state,
    updated_at = now()
  where gs.game_id = p_game_id
    and gs.table_id = p_table_id
    and gs.is_active = true
    and exists (
      select 1
      from public.tables as t
      join public.club_members as cm on cm.club_id = t.club_id
      where t.table_id = p_table_id
        and cm.user_id = auth.uid()
    )
  returning gs.*;
';

grant execute on function public.publish_game_state(uuid, uuid, jsonb, integer) to authenticated;

select 'patch_online_game_state_sync_rpc_ok' as result;
