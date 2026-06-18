-- Club creation permissions.
-- Default: normal accounts cannot create clubs.
-- Super creator: 3cda7884-9464-4b26-b7a2-bd79cc5ab65f / h1320000819@gamil.com can create unlimited clubs
-- and can grant one-club creation permission to other accounts.

drop index if exists public.clubs_one_owner_idx;

create table if not exists public.club_creation_permissions (
  user_id uuid primary key references public.users(user_id) on delete cascade,
  granted_by uuid references public.users(user_id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.club_creation_permissions enable row level security;

drop policy if exists "club creation permissions own read" on public.club_creation_permissions;
drop policy if exists "club creation permissions super read" on public.club_creation_permissions;

create policy "club creation permissions own read"
on public.club_creation_permissions for select
using (auth.uid() = user_id);

create or replace function public.is_super_club_creator(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    p_user_id = '3cda7884-9464-4b26-b7a2-bd79cc5ab65f'::uuid
    or exists (
      select 1
      from public.users u
      where u.user_id = p_user_id
        and lower(coalesce(u.auth_email, '')) = 'h1320000819@gamil.com'
    ),
    false
  )
$$;

grant execute on function public.is_super_club_creator(uuid) to authenticated;

create policy "club creation permissions super read"
on public.club_creation_permissions for select
using (public.is_super_club_creator(auth.uid()));

drop function if exists public.get_my_club_creation_status();

create or replace function public.get_my_club_creation_status()
returns table (
  user_id uuid,
  is_super_creator boolean,
  has_permission boolean,
  owned_club_count integer,
  can_create boolean,
  create_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_super boolean;
  v_has_permission boolean;
  v_owned_count integer;
begin
  if v_user_id is null then
    raise exception 'login required';
  end if;

  v_is_super := public.is_super_club_creator(v_user_id);

  select exists (
    select 1 from public.club_creation_permissions p where p.user_id = v_user_id
  ) into v_has_permission;

  select count(*)::integer
  into v_owned_count
  from public.clubs c
  where c.owner_user_id = v_user_id;

  return query select
    v_user_id,
    v_is_super,
    v_has_permission,
    v_owned_count,
    case
      when v_is_super then true
      when v_has_permission and v_owned_count < 1 then true
      else false
    end,
    case when v_is_super then null::integer else 1 end;
end;
$$;

grant execute on function public.get_my_club_creation_status() to authenticated;

drop function if exists public.grant_club_creation_permission(uuid);

create or replace function public.grant_club_creation_permission(p_user_id uuid)
returns public.club_creation_permissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permission public.club_creation_permissions;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not public.is_super_club_creator(auth.uid()) then
    raise exception 'club creation grant admin required';
  end if;

  if p_user_id is null then
    raise exception 'target user required';
  end if;

  insert into public.club_creation_permissions (user_id, granted_by)
  values (p_user_id, auth.uid())
  on conflict (user_id) do update
  set granted_by = excluded.granted_by,
      created_at = now()
  returning * into v_permission;

  return v_permission;
end;
$$;

grant execute on function public.grant_club_creation_permission(uuid) to authenticated;

drop function if exists public.create_club_with_owner(text);

create or replace function public.create_club_with_owner(p_name text)
returns public.clubs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club public.clubs;
  v_is_super boolean;
  v_has_permission boolean;
  v_owned_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  v_is_super := public.is_super_club_creator(auth.uid());

  select exists (
    select 1 from public.club_creation_permissions p where p.user_id = auth.uid()
  ) into v_has_permission;

  select count(*)::integer
  into v_owned_count
  from public.clubs
  where owner_user_id = auth.uid();

  if not v_is_super and not v_has_permission then
    raise exception 'club creation not permitted';
  end if;

  if not v_is_super and v_owned_count >= 1 then
    raise exception 'club creation limit reached';
  end if;

  insert into public.clubs (club_code, name, owner_user_id)
  values (public.generate_unique_club_code(), coalesce(nullif(p_name, ''), 'アンミカクラブ'), auth.uid())
  returning * into v_club;

  insert into public.club_members (club_id, user_id, role)
  values (v_club.club_id, auth.uid(), 'admin')
  on conflict (club_id, user_id) do update
  set role = 'admin';

  return v_club;
end;
$$;

grant execute on function public.create_club_with_owner(text) to authenticated;

drop policy if exists "clubs owner creates" on public.clubs;
drop policy if exists "club owner creates" on public.clubs;
drop policy if exists "clubs privileged creator inserts" on public.clubs;

-- Club creation must go through create_club_with_owner() so permission checks cannot be bypassed.

select 'patch_club_creation_permissions_ok' as result;
