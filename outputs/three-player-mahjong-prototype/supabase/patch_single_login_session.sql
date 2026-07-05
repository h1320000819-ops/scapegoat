-- One account / one browser session support.
-- Run this once in the Supabase SQL Editor.

alter table public.users add column if not exists active_login_session_id text;
alter table public.users add column if not exists active_login_session_updated_at timestamptz;
