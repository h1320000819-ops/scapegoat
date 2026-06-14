-- Club points patch 03: admin collects points from a member.

create or replace function public.admin_collect_club_points(
  p_club_id uuid,
  p_from_user_id uuid,
  p_amount integer
)
returns void
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if not public.is_club_admin(p_club_id, auth.uid()) then
    raise exception 'admin required';
  end if;

  if not public.is_club_member(p_club_id, p_from_user_id) then
    raise exception 'target is not club member';
  end if;

  update public.club_members
  set point_balance = point_balance - p_amount
  where club_id = p_club_id
    and user_id = p_from_user_id;

  insert into public.club_points (club_id, user_id, amount, reason)
  values (p_club_id, p_from_user_id, -p_amount, 'admin_collect');
end;
$$
language plpgsql
security definer
set search_path = public;

grant execute on function public.admin_collect_club_points(uuid, uuid, integer) to authenticated;

select 'patch_club_points_03_admin_collect_ok' as result;
