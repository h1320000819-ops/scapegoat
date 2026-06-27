-- Share default table layout adjustments across users and devices.
-- Run this whole file in the Supabase SQL Editor.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_read_all" on public.app_settings;
drop policy if exists "app_settings_super_insert" on public.app_settings;
drop policy if exists "app_settings_super_update" on public.app_settings;

create policy "app_settings_read_all"
on public.app_settings
for select
using (true);

create policy "app_settings_super_insert"
on public.app_settings
for insert
with check (
  auth.uid() = '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'h1320000819@gamil.com'
);

create policy "app_settings_super_update"
on public.app_settings
for update
using (
  auth.uid() = '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'h1320000819@gamil.com'
)
with check (
  auth.uid() = '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'h1320000819@gamil.com'
);

grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;

select 'patch_global_layout_defaults_ok' as result;
