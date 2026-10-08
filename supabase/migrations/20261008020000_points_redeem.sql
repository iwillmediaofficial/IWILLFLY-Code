-- Customer points, step B (redeem): customers cash out points to a UPI ID in steps of 1,000 points.
--
-- Requesting a cash-out takes the points straight away (oldest batches first), so they cannot be spent twice.
-- An admin sends the money by UPI within 2 business days (Sundays and the admin's holiday list do not count)
-- and records the UPI transaction ID (UTR), or rejects the request, which gives the points back with the
-- expiry dates they had. A new UPI ID can be used 24 hours after it is saved (protects hacked accounts).

-- Which batches each debit took points from, so a rejected cash-out can return them with their own expiry.
create table public.points_spends (
  debit_id bigint not null references public.points_ledger (id) on delete cascade,
  batch_id bigint not null references public.points_ledger (id) on delete cascade,
  points int not null check (points > 0),
  primary key (debit_id, batch_id)
);
create index points_spends_batch_idx on public.points_spends (batch_id);

-- The customer's saved UPI ID. previous_upi_id is null until it is first changed.
create table public.customer_upi (
  user_id uuid primary key references auth.users (id) on delete cascade,
  upi_id text not null check (upi_id ~ '^[a-z0-9._-]{2,200}@[a-z][a-z0-9]{1,63}$'),
  previous_upi_id text,
  changed_at timestamptz not null default now()
);
create index customer_upi_upi_idx on public.customer_upi (upi_id);

-- Days that do not count towards the 2-business-day payout promise (Sundays never count).
create table public.holidays (
  day date primary key,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create type public.redemption_status as enum ('requested', 'paid', 'rejected');

create table public.redemptions (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users (id) on delete cascade,
  points int not null check (points > 0),
  amount numeric(10,2) not null check (amount > 0),          -- rupees to send
  upi_id text not null,
  status public.redemption_status not null default 'requested',
  debit_id bigint references public.points_ledger (id) on delete set null,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null,                                -- end of the 2nd business day
  utr text check (utr ~ '^[A-Za-z0-9]{6,35}$'),
  reject_reason text check (char_length(reject_reason) between 2 and 300),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (utr is not null)),
  check ((status = 'rejected') = (reject_reason is not null)),
  check ((status = 'requested') = (decided_at is null))
);
-- one open request per customer
create unique index redemptions_one_open_idx on public.redemptions (customer_id) where status = 'requested';
create index redemptions_customer_idx on public.redemptions (customer_id, id desc);
create index redemptions_queue_idx on public.redemptions (status, id);
create index redemptions_upi_idx on public.redemptions (upi_id);
create index redemptions_debit_idx on public.redemptions (debit_id);
create index redemptions_decided_by_idx on public.redemptions (decided_by);

create trigger redemptions_updated_at before update on public.redemptions
  for each row execute function public.set_updated_at();

alter table public.points_spends enable row level security;
alter table public.customer_upi enable row level security;
alter table public.holidays enable row level security;
alter table public.redemptions enable row level security;

-- Customers see their own; admins see everyone's (UPI IDs of others are admin-only). Writes go through RPCs,
-- except the holiday list, which admins edit directly.
create policy "points_spends: admin read" on public.points_spends
  for select to authenticated using ((select private.is_admin()));
create policy "customer_upi: own or admin read" on public.customer_upi
  for select to authenticated using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "redemptions: own or admin read" on public.redemptions
  for select to authenticated using (customer_id = (select auth.uid()) or (select private.is_admin()));
create policy "holidays: public read" on public.holidays
  for select to anon, authenticated using (true);
create policy "holidays: admin insert" on public.holidays
  for insert to authenticated with check ((select private.is_admin()));
create policy "holidays: admin update" on public.holidays
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "holidays: admin delete" on public.holidays
  for delete to authenticated using ((select private.is_admin()));

create trigger redemptions_audit after insert or update or delete on public.redemptions
  for each row execute function private.audit_change();
create trigger holidays_audit after insert or update or delete on public.holidays
  for each row execute function private.audit_change();

-- Helpers -------------------------------------------------------------------------------------------

-- Spending now records which batches it used (points_spends). Oldest batches first, as before.
create or replace function private.spend_points(uid uuid, n int, k text, why text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  left_to_take int := n;
  b record;
  take int;
  debit_id bigint;
begin
  if n <= 0 then
    raise exception 'Points to spend must be more than 0' using errcode = 'check_violation';
  end if;
  insert into public.points_ledger (customer_id, kind, points, note)
    values (uid, k, -n, left(why, 200)) returning id into debit_id;
  for b in
    select id, points_remaining from public.points_ledger
    where customer_id = uid and points_remaining > 0 and expires_at > now()
    order by expires_at, id
    for update
  loop
    take := least(b.points_remaining, left_to_take);
    update public.points_ledger set points_remaining = points_remaining - take where id = b.id;
    insert into public.points_spends (debit_id, batch_id, points) values (debit_id, b.id, take);
    left_to_take := left_to_take - take;
    exit when left_to_take = 0;
  end loop;
  if left_to_take > 0 then
    raise exception 'Not enough points' using errcode = 'P0001';
  end if;
  return debit_id;
end;
$$;

-- The end (India time) of the n-th business day after `start`. Sundays and holidays are skipped.
create or replace function private.add_business_days(start timestamptz, n int)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d date := (start at time zone 'Asia/Kolkata')::date;
  k int := 0;
begin
  while k < n loop
    d := d + 1;
    if extract(isodow from d) <> 7 and not exists (select 1 from public.holidays h where h.day = d) then
      k := k + 1;
    end if;
  end loop;
  return (d + 1)::timestamp at time zone 'Asia/Kolkata';
end;
$$;

create or replace function private.clean_upi(p text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(regexp_replace(coalesce(p, ''), '\s', '', 'g')) $$;

revoke execute on function private.spend_points(uuid, int, text, text), private.add_business_days(timestamptz, int),
  private.clean_upi(text) from public, anon, authenticated;

-- Customer ------------------------------------------------------------------------------------------

-- The caller's saved UPI ID and when it can be used.
create or replace function public.my_upi()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'upi_id', u.upi_id,
    'usable_from', case when u.previous_upi_id is null then u.changed_at else u.changed_at + interval '24 hours' end)
  from public.customer_upi u where u.user_id = (select auth.uid());
$$;

-- Saves the UPI ID to pay to. Changing it means the new one can be used only after 24 hours.
create or replace function public.save_upi(p_upi_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  upi text := private.clean_upi(p_upi_id);
  cur public.customer_upi;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if upi !~ '^[a-z0-9._-]{2,200}@[a-z][a-z0-9]{1,63}$' then
    raise exception 'Enter a UPI ID like name@okicici or 9876543210@ybl' using errcode = 'P0001';
  end if;
  select * into cur from public.customer_upi where user_id = uid for update;
  if not found then
    insert into public.customer_upi (user_id, upi_id) values (uid, upi);
  elsif cur.upi_id <> upi then
    if exists (select 1 from public.redemptions where customer_id = uid and status = 'requested') then
      raise exception 'You have a cash-out waiting. Change your UPI ID after it is paid.' using errcode = 'P0001';
    end if;
    update public.customer_upi set upi_id = upi, previous_upi_id = cur.upi_id, changed_at = now()
      where user_id = uid;
  end if;
  return public.my_upi();
end;
$$;

-- Cash out p_points (a multiple of the step, at least the minimum) to the saved UPI ID.
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
  update public.redemptions
    set debit_id = private.spend_points(uid, p_points, 'redeem', 'Cash-out #' || r.id || ' to ' || u.upi_id)
    where id = r.id;

  perform private.notify(uid, 'points',
    'Cash-out requested: ' || private.rupees(r.amount),
    private.points_text(p_points) || ' (' || private.rupees(r.amount) || ') will be sent to ' || u.upi_id
      || ' by ' || to_char((r.due_at - interval '1 second') at time zone 'Asia/Kolkata', 'FMDD Mon') || '.',
    '/points/redeem');
  return r.id;
end;
$$;

create or replace function public.my_redemptions()
returns table (id bigint, points int, amount numeric, upi_id text, status public.redemption_status,
               requested_at timestamptz, due_at timestamptz, utr text, reject_reason text, decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.points, r.amount, r.upi_id, r.status, r.requested_at, r.due_at, r.utr, r.reject_reason,
    r.decided_at
  from public.redemptions r
  where r.customer_id = (select auth.uid())
  order by r.id desc
  limit 100;
$$;

-- Admin ---------------------------------------------------------------------------------------------

-- Payout queue: open requests oldest first; decided ones newest first. Flags are warnings, not limits.
create or replace function public.admin_redemptions(p_status public.redemption_status default 'requested')
returns table (id bigint, customer_id uuid, customer_name text, customer_email text, customer_phone text,
               points int, amount numeric, upi_id text, status public.redemption_status, requested_at timestamptz,
               due_at timestamptz, utr text, reject_reason text, decided_at timestamptz, decider_email text,
               upi_changed_at timestamptz, upi_first_set boolean, upi_other_accounts bigint,
               bills_approved bigint, points_earned bigint, previous_paid bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.id, r.customer_id, coalesce(pf.full_name, ''), u.email::text, pf.phone, r.points, r.amount, r.upi_id,
    r.status, r.requested_at, r.due_at, r.utr, r.reject_reason, r.decided_at, du.email::text,
    cu.changed_at, cu.previous_upi_id is null,
    -- the same UPI ID saved or paid to on other accounts
    (select count(distinct x.uid) from (
       select c.user_id as uid from public.customer_upi c where c.upi_id = r.upi_id
       union select o.customer_id from public.redemptions o where o.upi_id = r.upi_id) x
     where x.uid <> r.customer_id),
    (select count(*) from public.bill_submissions b where b.customer_id = r.customer_id and b.status = 'approved'),
    (select coalesce(sum(l.points), 0) from public.points_ledger l where l.customer_id = r.customer_id and l.kind = 'earn'),
    (select count(*) from public.redemptions o where o.customer_id = r.customer_id and o.status = 'paid' and o.id <> r.id)
  from public.redemptions r
  left join public.profiles pf on pf.id = r.customer_id
  left join auth.users u on u.id = r.customer_id
  left join auth.users du on du.id = r.decided_by
  left join public.customer_upi cu on cu.user_id = r.customer_id
  where p_status is null or r.status = p_status
  order by case when p_status = 'requested' then r.id end asc, r.id desc
  limit 200;
end;
$$;

create or replace function public.mark_redemption_paid(p_id bigint, p_utr text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.redemptions;
  ref text := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if ref !~ '^[A-Z0-9]{6,35}$' then
    raise exception 'Enter the UPI transaction ID (UTR) from your payment app' using errcode = 'P0001';
  end if;
  select * into r from public.redemptions where id = p_id for update;
  if not found then
    raise exception 'Cash-out not found' using errcode = 'P0001';
  end if;
  if r.status <> 'requested' then
    raise exception 'This cash-out was already %', r.status using errcode = 'P0001';
  end if;
  update public.redemptions
    set status = 'paid', utr = ref, decided_by = (select auth.uid()), decided_at = now()
    where id = r.id;
  perform private.notify(r.customer_id, 'points',
    'Cash-out sent: ' || private.rupees(r.amount),
    private.rupees(r.amount) || ' has been sent to ' || r.upi_id || '. UPI transaction ID (UTR): ' || ref || '.',
    '/points/redeem');
end;
$$;

-- Rejects a request and returns the points to the batches they came from, with their original expiry.
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
  a record;
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
  -- one returned batch per batch the points came from, expiring when that batch does
  for a in
    select sp.points, b.expires_at, b.bill_id from public.points_spends sp
    join public.points_ledger b on b.id = sp.batch_id
    where sp.debit_id = r.debit_id
    order by b.expires_at, b.id
  loop
    insert into public.points_ledger (customer_id, kind, points, points_remaining, expires_at, bill_id, note)
      values (r.customer_id, 'refund', a.points, a.points, a.expires_at, a.bill_id,
              'Returned from cash-out #' || r.id);
  end loop;
  perform private.notify(r.customer_id, 'points',
    'Cash-out not sent: points returned',
    'Your ' || private.rupees(r.amount) || ' cash-out to ' || r.upi_id || ' was not sent: ' || why || '. '
      || private.points_text(r.points) || ' are back in your wallet with their original expiry dates.',
    '/points/redeem');
end;
$$;

-- Monthly totals (India time) for the last p_months months, newest first.
create or replace function public.points_report(p_months int default 12)
returns table (month date, points_issued bigint, bills_approved bigint, points_redeemed bigint,
               rupees_paid numeric, payouts bigint, points_expired bigint, points_pending bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  first_month date := (date_trunc('month', now() at time zone 'Asia/Kolkata')
                       - make_interval(months => least(greatest(p_months, 1), 36) - 1))::date;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  with months as (
    select generate_series(first_month,
                           date_trunc('month', now() at time zone 'Asia/Kolkata')::date,
                           interval '1 month')::date as m
  ),
  led as (
    select date_trunc('month', l.created_at at time zone 'Asia/Kolkata')::date as m, l.kind, l.points
    from public.points_ledger l
    where l.created_at >= first_month::timestamp at time zone 'Asia/Kolkata'
  ),
  pay as (
    select date_trunc('month', r.decided_at at time zone 'Asia/Kolkata')::date as m, r.points, r.amount
    from public.redemptions r
    where r.status = 'paid' and r.decided_at >= first_month::timestamp at time zone 'Asia/Kolkata'
  )
  select months.m,
    coalesce((select sum(points) from led where led.m = months.m and kind = 'earn'), 0)::bigint,
    coalesce((select count(*) from led where led.m = months.m and kind = 'earn'), 0)::bigint,
    coalesce((select sum(points) from pay where pay.m = months.m), 0)::bigint,
    coalesce((select sum(amount) from pay where pay.m = months.m), 0)::numeric,
    coalesce((select count(*) from pay where pay.m = months.m), 0)::bigint,
    coalesce((select -sum(points) from led where led.m = months.m and kind = 'expire'), 0)::bigint,
    case when months.m = date_trunc('month', now() at time zone 'Asia/Kolkata')::date
      then (select coalesce(sum(points), 0) from public.redemptions where status = 'requested') else 0 end::bigint
  from months
  order by months.m desc;
end;
$$;

-- Reaching the cash-out minimum now says cash-out is open.
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
  pts := floor(amt / s.rupees_per_point)::int;
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

-- Grants ----------------------------------------------------------------------------------------------

revoke execute on function public.my_upi(), public.save_upi(text), public.request_redemption(int),
  public.my_redemptions(), public.admin_redemptions(public.redemption_status),
  public.mark_redemption_paid(bigint, text), public.reject_redemption(bigint, text), public.points_report(int)
  from public, anon, authenticated;
grant execute on function public.my_upi(), public.save_upi(text), public.request_redemption(int),
  public.my_redemptions(), public.admin_redemptions(public.redemption_status),
  public.mark_redemption_paid(bigint, text), public.reject_redemption(bigint, text), public.points_report(int)
  to authenticated;
