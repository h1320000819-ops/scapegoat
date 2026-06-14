# Online migration layer

This folder separates persistence/synchronization from the mahjong UI and rules.

## Backend switch

Use `.env`:

```txt
VITE_REPOSITORY_BACKEND=supabase
VITE_SUPABASE_URL=https://zotqxmnvtaxbduwphjjo.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon public key>
```

Only the Supabase anon public key belongs in the frontend. Never put a
`service_role` key or any secret key in `.env`, source files, or deployed
frontend settings.

## Supabase setup checklist

1. Run `supabase/schema.sql` in the Supabase SQL Editor.
2. In Supabase Auth settings, disable email confirmation for the current local
   password-login prototype. The app creates internal random emails for Auth.
3. Put only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`.
4. Start with `npm run dev`.
5. Open `http://localhost:5173/supabase-check.html`.
6. In browser A: create account, create club, create table, sit down.
7. In browser B or another device: open the generated
   `supabase-check.html?tableId=...` URL, login with a second account, request
   to join the same club, approve it from browser A, then sit down.
8. Confirm seats, waiting list, last-hand status, game state, events, and
   replays sync through Repository methods and Supabase Realtime.

## Event flow

Online play must use this flow:

```txt
client action
-> GameAction with turnVersion
-> authoritative validation
-> GameState.version += 1
-> save game_states
-> Supabase Realtime broadcasts update
```

Do not directly mutate remote `GameState` from UI components.

## Current online authority layer

The current Supabase-backed online layer has these production-facing pieces:

- `tables`, `table_seats`, `table_waiting_list` are the source of truth for
  lobby state.
- `player_connections` stores online / reconnecting / offline presence.
- `games`, `game_states`, `game_events`, and `pending_actions` are the source
  of truth for in-game sync.
- `GameState.version` and `GameAction.turnVersion` protect against double
  clicks, stale clients, and delayed submissions.
- Client code should call `submitOnlineAction(...)`, which forwards to the
  Supabase RPC `submit_game_action`.
- A production online table starts only when three real human players are
  seated. CPU seats remain debug-only.

Run this patch after the base schema when upgrading an existing database:

```txt
supabase/patch_online_authority.sql
```

The SQL patch adds:

- `player_connections`
- `pending_actions`
- `sit_at_table(...)`
- `try_start_table_game(...)`
- `submit_game_action(...)`

## CPU policy

CPU remains debug/local only.

Online production tables should start only when 3 real users are seated. CPU
tables must not generate club point deltas or rake logs.

## TODO before public operation

- Replace the placeholder `waitingForServerDeal` state from
  `try_start_table_game` with authoritative server-side dealing.
- Move full legality checks for discard, ron, tsumo, pon, kan, riichi, skip,
  and nuki-dora into a server-side function or a trusted Node/WebSocket
  process.
- Persist and resolve `pending_actions` with priority, deadlines, and
  simultaneous-ron policy.
- Implement timeout jobs server-side: discard wait -> tsumogiri, action wait
  -> skip, fever riichi opponent turns -> forced tsumogiri.
- Implement reconnection grace period and automatic leave timing.
- Generate per-player `ViewState` so only the acting player's hand is visible.
- Save every hand replay to Supabase and keep replay URLs stable.
- Apply club point and rake settlement only for three-human production games.
- Add audit logs for point changes, club admin actions, and login ID changes.
