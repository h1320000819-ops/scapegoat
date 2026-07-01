-- Restrict replay visibility.
-- Normal accounts can read only replays they participated in.
-- The privileged account can read every replay.

alter table public.replays enable row level security;

drop policy if exists "replays club members read" on public.replays;
drop policy if exists "replays participants or privileged read" on public.replays;

create policy "replays participants or privileged read"
on public.replays for select
using (
  auth.uid() = '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid
  or exists (
    select 1
    from public.users u
    where u.user_id = auth.uid()
      and lower(coalesce(u.auth_email, '')) = 'h1320000819@gamil.com'
  )
  or exists (
    select 1
    from public.player_replay_stats prs
    where prs.replay_id = replays.replay_id
      and prs.user_id = auth.uid()
      and coalesce(prs.is_cpu, false) = false
  )
  or summary->'players' @> jsonb_build_array(jsonb_build_object('playerId', auth.uid()::text))
);

select 'patch_replay_participant_visibility_ok' as result;
