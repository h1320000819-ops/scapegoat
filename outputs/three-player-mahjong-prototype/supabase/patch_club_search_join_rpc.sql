-- Fix club search/join from another account.
-- Run this whole file in Supabase SQL Editor.

create or replace function public.find_club_for_join(p_club_code_or_id text)
returns table (
  club_id uuid,
  club_code text,
  name text,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value text;
  v_uuid uuid;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  v_value := upper(trim(coalesce(p_club_code_or_id, '')));
  v_value := regexp_replace(v_value, '^クラブID\s*[:：]\s*', '', 'i');

  if v_value = '' then
    raise exception 'club code required';
  end if;

  begin
    v_uuid := v_value::uuid;
  exception when invalid_text_representation then
    v_uuid := null;
  end;

  return query
  select c.club_id, c.club_code, c.name, c.owner_user_id
  from public.clubs c
  where c.club_id = v_uuid
     or upper(c.club_code) = v_value
     or upper(c.name) = v_value
     or upper(c.name) like '%' || v_value || '%'
     or upper(coalesce(c.club_code, '')) like '%' || v_value || '%'
  order by
    case
      when upper(c.club_code) = v_value then 0
      when c.club_id = v_uuid then 1
      when upper(c.name) = v_value then 2
      else 3
    end,
    c.created_at desc
  limit 1;
end;
$$;

grant execute on function public.find_club_for_join(text) to anon, authenticated;

create or replace function public.request_join_club_by_code(p_club_code_or_id text)
returns public.club_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club public.clubs;
  v_request public.club_join_requests;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select c.*
  into v_club
  from public.clubs c
  join public.find_club_for_join(p_club_code_or_id) f
    on f.club_id = c.club_id
  limit 1;

  if v_club.club_id is null then
    raise exception 'club not found';
  end if;

  if public.is_club_member(v_club.club_id, auth.uid()) then
    insert into public.club_join_requests (club_id, user_id, status)
    values (v_club.club_id, auth.uid(), 'approved')
    on conflict (club_id, user_id) do update
    set status = 'approved'
    returning * into v_request;
    return v_request;
  end if;

  insert into public.club_join_requests (club_id, user_id, status)
  values (v_club.club_id, auth.uid(), 'pending')
  on conflict (club_id, user_id) do update
  set status = case
    when public.club_join_requests.status = 'approved' then 'approved'
    else 'pending'
  end
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.request_join_club_by_code(text) to authenticated;

-- 確認用:
-- select * from public.find_club_for_join('C-XXXXXX');

select 'patch_club_search_join_rpc_ok' as result;
