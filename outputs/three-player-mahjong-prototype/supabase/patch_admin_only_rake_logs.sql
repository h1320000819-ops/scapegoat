alter table if exists public.club_rake_logs enable row level security;

drop policy if exists "rake club members read own or admin" on public.club_rake_logs;
drop policy if exists "rake club members read" on public.club_rake_logs;
drop policy if exists "rake club admins read" on public.club_rake_logs;

create policy "rake club admins read"
on public.club_rake_logs for select
using (public.is_club_admin(club_id, auth.uid()));

select 'patch_admin_only_rake_logs_ok' as result;
