-- Cash-outs put points on hold instead of taking them straight away.
--
-- Requesting a cash-out still moves the points out of their batches (oldest first), so they cannot be used
-- twice and cannot expire while they wait, but the customer sees them as "Cash-out pending" and still in the
-- wallet total. Only when an admin marks the cash-out paid does it show as "Cashed out -1,000". Rejecting
-- puts the points back into the batches they came from, so nothing was ever taken.

-- The request no longer says the points were taken.
create or replace function public.request_redemption(p_points int)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  s public.points_settings := private.points_settings();
  u public.customer_upi;
  r public.redemptions;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_points is null or p_points < s.min_redeem_points or p_points % s.redeem_step_points <> 0 then
    raise exception 'Cash out at least % points, in steps of %', s.min_redeem_points, s.redeem_step_points
      using errcode = 'P0001';
  end if;
  select * into u from public.customer_upi where user_id = uid;
  if not found then
    raise exception 'Add your UPI ID first' using errcode = 'P0001';
  end if;
  if u.previous_upi_id is not null and u.changed_at > now() - interval '24 hours' then
    raise exception 'For your safety, a new UPI ID can be used 24 hours after it is added (from %)',
      to_char((u.changed_at + interval '24 hours') at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM')
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.redemptions where customer_id = uid and status = 'requested') then
    raise exception 'You already have a cash-out waiting to be paid' using errcode = 'P0001';
  end if;
  if private.points_balance(uid) < p_points then
    raise exception 'You do not have enough points' using errcode = 'P0001';
  end if;

  begin
    insert into public.redemptions (customer_id, points, amount, upi_id, due_at)
      values (uid, p_points, round(p_points * s.point_value, 2), u.upi_id, private.add_business_days(now(), 2))
      returning * into r;
  exception when unique_violation then
    raise exception 'You already have a cash-out waiting to be paid' using errcode = 'P0001';
  end;
  -- hold the points: out of their batches, shown as pending until paid
  update public.redemptions
    set debit_id = private.spend_points(uid, p_points, 'redeem', 'Cash-out #' || r.id || ' to ' || u.upi_id)
    where id = r.id;

  perform private.notify(uid, 'points',
    'Cash-out requested: ' || private.rupees(r.amount),
    'Your request was successful. ' || private.rupees(r.amount) || ' will reach ' || u.upi_id
      || ' within 2 business days (by ' || to_char((r.due_at - interval '1 second') at time zone 'Asia/Kolkata', 'FMDD Mon')
      || '). Your ' || private.points_text(p_points) || ' are on hold until then.',
    '/points/redeem');
  return r.id;
end;
$$;

-- Rejecting releases the hold: the points go back into the batches they came from, with their own expiry.
create or replace function public.reject_redemption(p_id bigint, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.redemptions;
  why text := left(nullif(btrim(p_reason), ''), 300);
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if why is null or char_length(why) < 2 then
    raise exception 'Give a reason the customer will see' using errcode = 'P0001';
  end if;
  select * into r from public.redemptions where id = p_id for update;
  if not found then
    raise exception 'Cash-out not found' using errcode = 'P0001';
  end if;
  if r.status <> 'requested' then
    raise exception 'This cash-out was already %', r.status using errcode = 'P0001';
  end if;
  update public.redemptions
    set status = 'rejected', reject_reason = why, decided_by = (select auth.uid()), decided_at = now()
    where id = r.id;
  update public.points_ledger b
    set points_remaining = b.points_remaining + sp.points
    from public.points_spends sp
    where sp.debit_id = r.debit_id and b.id = sp.batch_id;
  update public.points_ledger set note = left('Released: cash-out #' || r.id || ' not sent', 200)
    where id = r.debit_id;
  perform private.notify(r.customer_id, 'points',
    'Cash-out not sent',
    'Your ' || private.rupees(r.amount) || ' cash-out to ' || r.upi_id || ' was not sent: ' || why || '. Your '
      || private.points_text(r.points) || ' are no longer on hold and can be used again.',
    '/points/redeem');
end;
$$;

-- History: a cash-out shows as kind 'redeem_pending' (on hold) until it is paid, then as 'redeem' dated when
-- it was paid. A rejected cash-out's hold is left out, since nothing was taken.
create or replace function public.my_points_history(p_before bigint default null, p_limit int default 50)
returns table (id bigint, kind text, points int, points_remaining int, expires_at timestamptz,
               bill_id bigint, shop_name text, bill_amount numeric, note text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
    case when r.status = 'requested' then 'redeem_pending' else l.kind end,
    l.points, l.points_remaining, l.expires_at, l.bill_id, sh.name, b.approved_amount,
    case when r.status = 'paid' then 'UTR ' || r.utr else l.note end,
    case when r.status = 'paid' then r.decided_at else l.created_at end
  from public.points_ledger l
  left join public.bill_submissions b on b.id = l.bill_id
  left join public.shops sh on sh.id = b.shop_id
  left join public.redemptions r on r.debit_id = l.id
  where l.customer_id = (select auth.uid()) and (p_before is null or l.id < p_before)
    and r.status is distinct from 'rejected'
  order by l.id desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- The wallet also reports points on hold for a pending cash-out. 'balance' stays the usable points.
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
    select count(*) as n, coalesce(sum(floor(b.amount / s.rupees_per_point)), 0)::int as pts
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
