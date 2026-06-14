-- Club settings RPC patch.
-- Run this whole file in the Supabase SQL Editor.

alter table public.users add column if not exists icon_url text;
alter table public.clubs add column if not exists icon_url text;
alter table public.clubs add column if not exists updated_at timestamptz not null default now();

drop function if exists public.update_club_name(uuid, text);

create or replace function public.update_club_name(p_club_id uuid, p_name text)
returns setof public.clubs
language sql
security definer
set search_path = public
as '
  update public.clubs c
  set name = nullif(btrim(p_name), ''''),
      updated_at = now()
  where c.club_id = p_club_id
    and auth.uid() is not null
    and nullif(btrim(p_name), '''') is not null
    and public.is_club_admin(c.club_id, auth.uid())
  returning c.*
';

grant execute on function public.update_club_name(uuid, text) to authenticated;

drop function if exists public.update_my_icon(text);

create or replace function public.update_my_icon(p_icon_url text)
returns setof public.users
language sql
security definer
set search_path = public
as '
  update public.users u
  set icon_url = nullif(p_icon_url, ''''),
      updated_at = now()
  where u.user_id = auth.uid()
  returning u.*
';

grant execute on function public.update_my_icon(text) to authenticated;

drop function if exists public.update_club_icon(uuid, text);

create or replace function public.update_club_icon(p_club_id uuid, p_icon_url text)
returns setof public.clubs
language sql
security definer
set search_path = public
as '
  update public.clubs c
  set icon_url = nullif(p_icon_url, ''''),
      updated_at = now()
  where c.club_id = p_club_id
    and auth.uid() is not null
    and public.is_club_admin(c.club_id, auth.uid())
  returning c.*
';

grant execute on function public.update_club_icon(uuid, text) to authenticated;

select 'patch_club_settings_rpc_ok' as result;
