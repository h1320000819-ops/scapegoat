-- 05: RLS policies for online authority tables.
-- Run this whole file in Supabase SQL Editor.

drop policy if exists "player connections club members read" on public.player_connections;
create policy "player connections club members read"
on public.player_connections for select
using (
  exists (
    select 1
    from public.tables t
    where t.table_id = player_connections.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

drop policy if exists "player connections own upsert" on public.player_connections;
create policy "player connections own upsert"
on public.player_connections for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tables t
    where t.table_id = player_connections.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

drop policy if exists "player connections own update" on public.player_connections;
create policy "player connections own update"
on public.player_connections for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "pending actions club members read" on public.pending_actions;
create policy "pending actions club members read"
on public.pending_actions for select
using (
  exists (
    select 1
    from public.tables t
    where t.table_id = pending_actions.table_id
      and public.is_club_member(t.club_id, auth.uid())
  )
);

select 'online_authority_05_ok' as result;
