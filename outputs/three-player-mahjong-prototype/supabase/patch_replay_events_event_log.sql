-- Event-log replay storage.
-- Replays keep metadata in public.replays; replay_events stores the canonical
-- replay event stream for playback and large-scale storage.

create table if not exists public.replay_events (
  replay_event_id uuid primary key default gen_random_uuid(),
  replay_id uuid not null references public.replays(replay_id) on delete cascade,
  sequence integer not null,
  event_type text not null,
  actor_player_id uuid references public.users(user_id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (replay_id, sequence)
);

create index if not exists replay_events_replay_sequence_idx
on public.replay_events(replay_id, sequence);

create index if not exists replay_events_replay_type_idx
on public.replay_events(replay_id, event_type);

alter table public.replay_events enable row level security;

drop policy if exists "replay events club members read" on public.replay_events;
create policy "replay events club members read"
on public.replay_events for select
using (
  exists (
    select 1
    from public.replays r
    where r.replay_id = replay_events.replay_id
      and (
        r.club_id is null
        or public.is_club_member(r.club_id, auth.uid())
      )
  )
);

drop policy if exists "replay events club members insert" on public.replay_events;
create policy "replay events club members insert"
on public.replay_events for insert
with check (
  exists (
    select 1
    from public.replays r
    where r.replay_id = replay_events.replay_id
      and (
        r.club_id is null
        or public.is_club_member(r.club_id, auth.uid())
      )
  )
);

do $anmika_replay_events_realtime$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'replay_events'
  ) then
    alter publication supabase_realtime add table public.replay_events;
  end if;
end;
$anmika_replay_events_realtime$;

select 'patch_replay_events_event_log_ok' as result;
