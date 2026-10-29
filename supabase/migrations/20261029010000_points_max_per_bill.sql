-- Points: an optional cap on the points one bill can earn (Admin > Money > Points > Settings).
-- Empty (null) means no cap. A bill earns least(floor(amount / earn rate), cap); least() ignores null.
-- Like the other settings, it applies to bills approved from now on. check_bill, approve_bill and
-- points_wallet are the three places that work out a bill's points; they are redefined here unchanged
-- apart from the cap, and points_wallet also returns the cap so the app can show it.

alter table public.points_settings
  add column max_points_per_bill int check (max_points_per_bill between 1 and 10000000);

-- Customer: bill check (from 20261026062500_bill_branch.sql) ----------------------------------------

-- Checks a bill before its photo is uploaded, so a bill that will be refused is never sent. Raises a
-- message the customer can read; returns the points it would earn. submit_bill runs the same checks.
create or replace function public.check_bill(p_shop_id bigint, p_bill_number text, p_bill_date date,
                                             p_amount numeric, p_resubmit_of bigint default null,
                                             p_branch_id bigint default null)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.points_settings := private.points_settings();
  today date := private.today_ist();
  norm text := upper(regexp_replace(coalesce(p_bill_number, ''), '[^A-Za-z0-9]', '', 'g'));
  prev public.bill_submissions;
  oldest date := today - s.bill_age_days;
begin
  if uid is null then
    raise exception 'Sign in to add bills' using errcode = 'insufficient_privilege';
  end if;
  if p_resubmit_of is not null then
    select * into prev from public.bill_submissions where id = p_resubmit_of and customer_id = uid;
    if not found then
      raise exception 'That bill was not found' using errcode = 'P0001';
    end if;
    if prev.status <> 'rejected' then
      raise exception 'Only a rejected bill can be sent again' using errcode = 'P0001';
    end if;
    if prev.reject_reason = 'duplicate' then
      raise exception 'A bill rejected as a duplicate cannot be sent again' using errcode = 'P0001';
    end if;
    if prev.resubmit_of is not null
       or exists (select 1 from public.bill_submissions where resubmit_of = prev.id) then
      raise exception 'This bill was already sent again once' using errcode = 'P0001';
    end if;
    if prev.decided_at < now() - make_interval(days => s.bill_age_days) then
      raise exception 'A rejected bill can be fixed within % days', s.bill_age_days using errcode = 'P0001';
    end if;
    -- the age limit counts from when the bill was first added
    oldest := (prev.created_at at time zone 'Asia/Kolkata')::date - s.bill_age_days;
  end if;

  if p_shop_id is null or not private.shop_is_live(p_shop_id) then
    raise exception 'Pick a shop listed on IWILLFLY' using errcode = 'P0001';
  end if;
  if private.works_at_shop(uid, p_shop_id) then
    raise exception 'You cannot earn points on bills from your own shop' using errcode = 'P0001';
  end if;
  perform private.bill_branch(uid, p_shop_id, p_branch_id, p_resubmit_of);
  if norm = '' or char_length(btrim(p_bill_number)) > 40 then
    raise exception 'Enter the bill number printed on the bill' using errcode = 'P0001';
  end if;
  if p_bill_date is null or p_bill_date > today then
    raise exception 'The bill date cannot be in the future' using errcode = 'P0001';
  end if;
  if p_bill_date < oldest then
    raise exception 'Bills must be added within % days of the bill date', s.bill_age_days using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < s.rupees_per_point then
    raise exception 'Bills under % do not earn points', private.rupees(s.rupees_per_point) using errcode = 'P0001';
  end if;
  if p_amount > 99999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter the bill amount in rupees' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bill_submissions
             where shop_id = p_shop_id and bill_number_norm = norm and bill_date = p_bill_date
               and status <> 'rejected') then
    raise exception 'This bill has already been added' using errcode = 'P0001';
  end if;
  return least(floor(p_amount / s.rupees_per_point), s.max_points_per_bill)::int;
end;
$$;

-- Admin: approve (from 20261008020000_points_redeem.sql) ---------------------------------------------

create or replace function public.approve_bill(p_bill_id bigint, p_amount numeric default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.points_settings := private.points_settings();
  b public.bill_submissions;
  amt numeric;
  pts int;
  before_bal int;
  shop text;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into b from public.bill_submissions where id = p_bill_id for update;
  if not found then
    raise exception 'Bill not found' using errcode = 'P0001';
  end if;
  if b.status <> 'pending' then
    raise exception 'This bill was already %', b.status using errcode = 'P0001';
  end if;
  amt := coalesce(p_amount, b.amount);
  if amt <> round(amt, 2) or amt > 99999999.99 then
    raise exception 'Enter the amount in rupees' using errcode = 'P0001';
  end if;
  if amt < s.rupees_per_point then
    raise exception 'Bills under % do not earn points. Reject it instead.', private.rupees(s.rupees_per_point)
      using errcode = 'P0001';
  end if;
  pts := least(floor(amt / s.rupees_per_point), s.max_points_per_bill)::int;
  before_bal := private.points_balance(b.customer_id);

  update public.bill_submissions
    set status = 'approved', approved_amount = amt, points = pts, reviewed_by = (select auth.uid()),
        decided_at = now()
    where id = b.id;
  insert into public.points_ledger (customer_id, kind, points, points_remaining, expires_at, bill_id)
    values (b.customer_id, 'earn', pts, pts, now() + make_interval(months => s.validity_months), b.id);

  select name into shop from public.shops where id = b.shop_id;
  perform private.notify(b.customer_id, 'points',
    'Bill approved: +' || private.points_text(pts),
    'Your ' || private.rupees(amt) || ' bill at ' || shop || ' is approved: +' || private.points_text(pts)
      || case when amt <> b.amount then ' (amount corrected from ' || private.rupees(b.amount) || ')' else '' end
      || '.',
    '/points');
  if before_bal < s.min_redeem_points and before_bal + pts >= s.min_redeem_points then
    perform private.notify(b.customer_id, 'points',
      'You reached ' || private.points_text(s.min_redeem_points) || '!',
      'You can now cash out ' || private.rupees(s.min_redeem_points * s.point_value) || ' to your UPI ID.',
      '/points/redeem');
  end if;
  return jsonb_build_object('points', pts, 'balance', before_bal + pts);
end;
$$;


-- Wallet (from 20261008030000_points_cashout_hold.sql) -----------------------------------------------

create or replace function public.points_wallet()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select * from private.points_settings()),
  me as (select (select auth.uid()) as uid),
  bal as (select private.points_balance((select uid from me)) as points),
  next_batch as (
    select l.expires_at from public.points_ledger l
    where l.customer_id = (select uid from me) and l.points_remaining > 0 and l.expires_at > now()
    order by l.expires_at limit 1
  ),
  pend as (
    select count(*) as n, coalesce(sum(least(floor(b.amount / s.rupees_per_point), s.max_points_per_bill)), 0)::int as pts
    from public.bill_submissions b, s
    where b.customer_id = (select uid from me) and b.status = 'pending'
  ),
  hold as (
    select coalesce(sum(r.points), 0)::int as points from public.redemptions r
    where r.customer_id = (select uid from me) and r.status = 'requested'
  )
  select jsonb_build_object(
    'balance', bal.points,
    'value', round(bal.points * s.point_value, 2),
    'on_hold', hold.points,
    'rupees_per_point', s.rupees_per_point,
    'max_points_per_bill', s.max_points_per_bill,
    'point_value', s.point_value,
    'min_redeem_points', s.min_redeem_points,
    'redeem_step_points', s.redeem_step_points,
    'validity_months', s.validity_months,
    'bill_age_days', s.bill_age_days,
    'next_expiry', (select jsonb_build_object(
        'expires_at', nb.expires_at,
        'points', (select sum(l.points_remaining) from public.points_ledger l
                   where l.customer_id = (select uid from me) and l.points_remaining > 0
                     and l.expires_at = nb.expires_at))
      from next_batch nb),
    'pending_bills', pend.n,
    'pending_points', pend.pts,
    'lifetime_points', (select coalesce(sum(points), 0) from public.points_ledger
                        where customer_id = (select uid from me) and kind = 'earn')
  )
  from s, bal, pend, hold
  where (select uid from me) is not null;
$$;
