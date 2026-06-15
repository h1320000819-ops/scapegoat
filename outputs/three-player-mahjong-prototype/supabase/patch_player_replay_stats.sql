-- Player replay statistics base table.
-- This stores one row per replay per player, including CPU rows.
-- Future stats such as call rate, riichi rate, win rate, and average score
-- can be calculated from this table.

create table if not exists public.player_replay_stats (
  stat_id uuid primary key default gen_random_uuid(),
  replay_id uuid not null references public.replays(replay_id) on delete cascade,
  club_id uuid references public.clubs(club_id) on delete set null,
  table_id uuid references public.tables(table_id) on delete set null,
  game_id uuid references public.games(game_id) on delete set null,
  rule_id text not null default 'anmika-rocket',
  scope text not null default 'hand',
  player_key text not null,
  user_id uuid references public.users(user_id) on delete set null,
  display_name text,
  is_cpu boolean not null default false,
  hand_count integer not null default 1,
  win_count integer not null default 0,
  ron_win_count integer not null default 0,
  tsumo_win_count integer not null default 0,
  riichi_count integer not null default 0,
  call_count integer not null default 0,
  discard_count integer not null default 0,
  draw_count integer not null default 0,
  score_delta numeric not null default 0,
  final_score numeric not null default 0,
  stat_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists player_replay_stats_replay_idx
on public.player_replay_stats(replay_id);

create index if not exists player_replay_stats_user_created_idx
on public.player_replay_stats(user_id, created_at desc);

create index if not exists player_replay_stats_club_created_idx
on public.player_replay_stats(club_id, created_at desc);

create unique index if not exists player_replay_stats_replay_player_unique
on public.player_replay_stats(replay_id, player_key);

alter table public.player_replay_stats enable row level security;

drop policy if exists "player replay stats club members read" on public.player_replay_stats;

create policy "player replay stats club members read"
on public.player_replay_stats for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.club_members cm
    where cm.club_id = player_replay_stats.club_id
      and cm.user_id = auth.uid()
  )
);

select 'patch_player_replay_stats_ok' as result;
