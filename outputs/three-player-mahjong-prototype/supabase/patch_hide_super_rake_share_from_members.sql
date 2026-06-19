-- Hide super-account rake share percent from normal club members.
-- Only the super account and club admins can read the configured percent.

drop policy if exists "super rake shares club members read" on public.club_super_rake_shares;
drop policy if exists "super rake shares club admins read" on public.club_super_rake_shares;

create policy "super rake shares club admins read"
on public.club_super_rake_shares for select
using (
  public.is_super_club_creator(auth.uid())
  or exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_super_rake_shares.club_id
      and cm.user_id = auth.uid()
      and cm.role = 'admin'
  )
);

drop function if exists public.get_club_super_rake_share(uuid);

create or replace function public.get_club_super_rake_share(p_club_id uuid)
returns table (
  club_id uuid,
  percent numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_club_id is null then
    raise exception 'club_id is required';
  end if;

  if not (
    public.is_super_club_creator(auth.uid())
    or exists (
      select 1
      from public.club_members cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  ) then
    raise exception 'admin required';
  end if;

  return query
  select p_club_id, coalesce(s.percent, 0), s.updated_at
  from (select p_club_id as club_id) base
  left join public.club_super_rake_shares s on s.club_id = base.club_id;
end;
$$;

grant execute on function public.get_club_super_rake_share(uuid) to authenticated;

select 'patch_hide_super_rake_share_from_members_ok' as result;
