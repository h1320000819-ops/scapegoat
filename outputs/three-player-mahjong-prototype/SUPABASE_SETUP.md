# Supabase Setup

Project URL:

```txt
https://zotqxmnvtaxbduwphjjo.supabase.co
```

## 1. SQL

Run this file in Supabase SQL Editor:

```txt
supabase/schema.sql
```

The schema creates:

- users
- clubs
- club_members
- club_join_requests
- tables
- table_seats
- table_waiting_list
- games
- game_states
- game_events
- replays
- club_points
- club_rake_logs

It also enables RLS and adds Realtime publication entries for table/game sync.

## 2. Auth Setting

For the current local password-login prototype, turn off email confirmation in
Supabase Auth settings before testing. The app creates internal random emails
for Supabase Auth.

## 3. Environment

Create `.env`:

```txt
VITE_REPOSITORY_BACKEND=supabase
VITE_SUPABASE_URL=https://zotqxmnvtaxbduwphjjo.supabase.co
VITE_SUPABASE_ANON_KEY=<your Supabase anon public key>
```

Only the anon public key is allowed in frontend configuration.

Do not put `service_role` or any secret key in `.env`, source files, Vercel,
Netlify, or any frontend deployment setting.

## 4. Browser Check

After SQL and `.env` are ready:

1. Run `npm install`.
2. Run `npm run dev`.
3. Open the smoke-check page:
   ```txt
   http://localhost:5173/supabase-check.html
   ```
4. Create an account.
5. Log in.
6. Create a club.
7. Create a table.
8. Copy/open the generated `supabase-check.html?tableId=...` URL in another browser or device.
9. Log in with another account.
10. Search the same club ID and request to join.
11. Approve that user ID from the club owner's browser.
12. Sit at the same table from the second browser.
13. Confirm seats, waiting list, table status, game state, events, and replays sync.

CPU tables are debug-only and should not create club point or rake movement.
