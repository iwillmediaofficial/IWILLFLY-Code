-- Customer points, step A (earn): customers add bills from IWILLFLY-listed shops, an admin checks each
-- bill by hand, and approval credits 1 point for every full ₹50 (1 point = ₹1). No caps.
--
-- Each credit is its own batch in points_ledger with an expiry date and the points still left in it;
-- spending takes the oldest points first and a nightly job expires leftovers. Points only change through
-- the security definer functions below (the same pattern as Scratch & Win). Bill photos live in a private
-- R2 bucket; the key is bills/<customer id>/<sha256 of the file>.webp, set by the upload Worker, so the
-- file fingerprint used for the duplicate check cannot be made up by the app.

-- Settings (one row) ------------------------------------------------------------------------------

create table public.points_settings (
  id int primary key default 1 check (id = 1),
  rupees_per_point int not null default 50 check (rupees_per_point between 1 and 100000),  -- earn rate
  point_value numeric(10,2) not null default 1 check (point_value > 0 and point_value <= 1000), -- ₹ per point
  min_redeem_points int not null default 1000 check (min_redeem_points between 1 and 10000000),
  redeem_step_points int not null default 1000 check (redeem_step_points between 1 and 10000000),
  validity_months int not null default 6 check (validity_months between 1 and 60),
  bill_age_days int not null default 7 check (bill_age_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.points_settings (id) values (1);

-- Bills ---------------------------------------------------------------------------------------------

create table public.bill_submissions (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users (id) on delete cascade,
  shop_id bigint not null references public.shops (id) on delete restrict,
  bill_number text not null check (char_length(btrim(bill_number)) between 1 and 40),
  -- "INV-0012", "inv 0012" and "INV0012" are the same bill
  bill_number_norm text generated always as (upper(regexp_replace(bill_number, '[^A-Za-z0-9]', '', 'g'))) stored,
  bill_date date not null,
  amount numeric(10,2) not null check (amount > 0),        -- as typed by the customer
  approved_amount numeric(10,2) check (approved_amount > 0), -- as approved (an admin may correct it)
  photo_key text not null check (photo_key ~ '^bills/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'),
  photo_sha256 text generated always as (substring(photo_key from '([0-9a-f]{64})\.webp$')) stored,
  source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'), -- the original file, before resizing
  photo_deleted_at timestamptz,
  status public.review_status not null default 'pending',
  reject_reason text check (reject_reason in ('blurry', 'wrong_shop', 'duplicate', 'amount_mismatch')),
  admin_note text check (char_length(admin_note) <= 300),
  points int check (points >= 0),
  resubmit_of bigint unique references public.bill_submissions (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (bill_number_norm <> ''),
  check ((status = 'rejected') = (reject_reason is not null)),
  check ((status = 'approved') = (points is not null and approved_amount is not null)),
  check ((status = 'pending') = (decided_at is null))
);
-- A bill (shop + number + date) and a photo can be claimed only once, by anyone. Rejected bills free them
-- again so a fixed bill can be sent once more.
create unique index bill_submissions_bill_uniq on public.bill_submissions (shop_id, bill_number_norm, bill_date)
  where status <> 'rejected';
create unique index bill_submissions_photo_uniq on public.bill_submissions (photo_sha256)
  where status <> 'rejected';
create unique index bill_submissions_source_uniq on public.bill_submissions (source_sha256)
  where status <> 'rejected' and source_sha256 is not null;
create index bill_submissions_customer_idx on public.bill_submissions (customer_id, created_at desc);
create index bill_submissions_shop_idx on public.bill_submissions (shop_id, created_at desc);
create index bill_submissions_queue_idx on public.bill_submissions (status, id);
create index bill_submissions_reviewed_by_idx on public.bill_submissions (reviewed_by);
create index bill_submissions_photo_cleanup_idx on public.bill_submissions (decided_at)
  where photo_deleted_at is null and decided_at is not null;

-- Points ledger -------------------------------------------------------------------------------------

-- Credits (earn, refund) are batches: points_remaining counts down as points are spent or expire.
-- Debits (expire, redeem) carry negative points. A customer's balance is the sum of points_remaining.
create table public.points_ledger (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('earn', 'expire', 'redeem', 'refund', 'adjust')),
  points int not null check (points <> 0),
  points_remaining int check (points_remaining >= 0),
  expires_at timestamptz,
  bill_id bigint references public.bill_submissions (id) on delete set null,
  note text check (char_length(note) <= 200),
  warned_30_at timestamptz,   -- "expiring in 30 days" alert sent
  warned_7_at timestamptz,    -- "expiring in 7 days" alert sent
  created_at timestamptz not null default now(),
  check ((points > 0) = (points_remaining is not null and expires_at is not null)),
  check (points_remaining is null or points_remaining <= points)
);
create index points_ledger_customer_idx on public.points_ledger (customer_id, id desc);
create index points_ledger_open_batches_idx on public.points_ledger (customer_id, expires_at, id)
  where points_remaining > 0;
create index points_ledger_expiry_idx on public.points_ledger (expires_at) where points_remaining > 0;
create index points_ledger_bill_idx on public.points_ledger (bill_id);

create trigger points_settings_updated_at before update on public.points_settings
  for each row execute function public.set_updated_at();
create trigger bill_submissions_updated_at before update on public.bill_submissions
  for each row execute function public.set_updated_at();

-- New inbox message kind for bill and points alerts.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('broadcast', 'offer_review', 'vendor_review', 'new_winner', 'festival_review',
                  'placement_review', 'billing', 'support_reply', 'staff', 'points'));

-- Row Level Security --------------------------------------------------------------------------------

alter table public.points_settings enable row level security;
alter table public.bill_submissions enable row level security;
alter table public.points_ledger enable row level security;

-- Everyone may read the rules (the wallet shows them); only admins change them.
create policy "points_settings: public read" on public.points_settings
  for select to anon, authenticated using (true);
create policy "points_settings: admin update" on public.points_settings
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Customers see their own bills and points; admins see all. Writes go through the functions below.
create policy "bill_submissions: own or admin read" on public.bill_submissions
  for select to authenticated using (customer_id = (select auth.uid()) or (select private.is_admin()));
create policy "points_ledger: own or admin read" on public.points_ledger
  for select to authenticated using (customer_id = (select auth.uid()) or (select private.is_admin()));

create trigger points_settings_audit after insert or update or delete on public.points_settings
  for each row execute function private.audit_change();
create trigger bill_submissions_audit after insert or update or delete on public.bill_submissions
  for each row execute function private.audit_change();

-- Helpers -------------------------------------------------------------------------------------------

create or replace function private.points_settings()
returns public.points_settings
language sql
stable
security definer
set search_path = ''
as $$ select * from public.points_settings where id = 1 $$;

-- Points still usable (unexpired batches).
create or replace function private.points_balance(uid uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points_remaining), 0)::int from public.points_ledger
  where customer_id = uid and points_remaining > 0 and expires_at > now();
$$;

-- "₹1,234" (Indian digit grouping), for alert texts.
create or replace function private.rupees(n numeric)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  whole text := trunc(abs(n))::bigint::text;
  paise int := round((abs(n) - trunc(abs(n))) * 100)::int;
  out text;
begin
  if char_length(whole) > 3 then
    out := right(whole, 3);
    whole := left(whole, -3);
    while char_length(whole) > 2 loop
      out := right(whole, 2) || ',' || out;
      whole := left(whole, -2);
    end loop;
    out := whole || ',' || out;
  else
    out := whole;
  end if;
  return '₹' || out || case when paise > 0 then '.' || lpad(paise::text, 2, '0') else '' end;
end;
$$;

create or replace function private.points_text(n int)
returns text
language sql
immutable
set search_path = ''
as $$ select to_char(n, 'FM9,99,99,99,999') || case when n = 1 then ' point' else ' points' end $$;

-- Is the shop run by this user's business (owner or staff)? They cannot earn on their own bills.
create or replace function private.works_at_shop(uid uuid, s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops sh join public.vendors v on v.id = sh.vendor_id
    where sh.id = s
      and (v.owner_id = uid
           or exists (select 1 from public.vendor_staff st
                      where st.vendor_id = v.id and st.user_id = uid and st.removed_at is null))
  );
$$;

-- Takes points from a customer's oldest unexpired batches first (for cash-outs in step B).
-- Returns the debit row's id; raises when the balance is too low.
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
  for b in
    select id, points_remaining from public.points_ledger
    where customer_id = uid and points_remaining > 0 and expires_at > now()
    order by expires_at, id
    for update
  loop
    take := least(b.points_remaining, left_to_take);
    update public.points_ledger set points_remaining = points_remaining - take where id = b.id;
    left_to_take := left_to_take - take;
    exit when left_to_take = 0;
  end loop;
  if left_to_take > 0 then
    raise exception 'Not enough points' using errcode = 'P0001';
  end if;
  insert into public.points_ledger (customer_id, kind, points, note)
    values (uid, k, -n, left(why, 200)) returning id into debit_id;
  return debit_id;
end;
$$;

revoke execute on function private.points_settings(), private.points_balance(uuid), private.rupees(numeric),
  private.points_text(int), private.works_at_shop(uuid, bigint), private.spend_points(uuid, int, text, text)
  from public, anon, authenticated;

-- Customer: bills ------------------------------------------------------------------------------------

-- Live shops for the "Which shop?" picker, matched by name.
create or replace function public.points_shops(p_q text default null, p_limit int default 20)
returns table (id bigint, name text, logo_key text, area text)
language sql
stable
security definer
set search_path = ''
as $$
  select sh.id, sh.name, sh.logo_key,
    (select coalesce(l.name, b.address) from public.branches b left join public.locations l on l.id = b.location_id
     where b.shop_id = sh.id order by b.id limit 1)
  from public.shops sh
  join public.vendors v on v.id = sh.vendor_id
  where sh.is_active and v.status = 'approved'
    and (nullif(btrim(p_q), '') is null
         or sh.name ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by sh.name, sh.id
  limit least(greatest(p_limit, 1), 50);
$$;

-- Checks a bill before its photo is uploaded, so a bill that will be refused is never sent. Raises a
-- message the customer can read; returns the points it would earn. submit_bill runs the same checks.
create or replace function public.check_bill(p_shop_id bigint, p_bill_number text, p_bill_date date,
                                             p_amount numeric, p_resubmit_of bigint default null)
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
  return floor(p_amount / s.rupees_per_point)::int;
end;
$$;

-- Adds a bill for checking. p_photo_key comes from the upload Worker (bills/<your id>/<sha256>.webp).
create or replace function public.submit_bill(p_shop_id bigint, p_bill_number text, p_bill_date date,
                                              p_amount numeric, p_photo_key text,
                                              p_source_sha256 text default null,
                                              p_resubmit_of bigint default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id bigint;
  hash text := substring(coalesce(p_photo_key, '') from '^bills/[0-9a-f-]{36}/([0-9a-f]{64})\.webp$');
  src text := lower(nullif(btrim(p_source_sha256), ''));
begin
  perform public.check_bill(p_shop_id, p_bill_number, p_bill_date, p_amount, p_resubmit_of);
  if hash is null or not starts_with(p_photo_key, 'bills/' || uid::text || '/') then
    raise exception 'Upload a photo of the bill' using errcode = 'P0001';
  end if;
  if src is not null and src !~ '^[0-9a-f]{64}$' then
    src := null;
  end if;
  if exists (select 1 from public.bill_submissions
             where status <> 'rejected'
               and (photo_sha256 = hash or (src is not null and source_sha256 = src))) then
    raise exception 'This photo has already been used for a bill' using errcode = 'P0001';
  end if;
  begin
    insert into public.bill_submissions (customer_id, shop_id, bill_number, bill_date, amount, photo_key,
                                         source_sha256, resubmit_of)
    values (uid, p_shop_id, btrim(p_bill_number), p_bill_date, p_amount, p_photo_key, src, p_resubmit_of)
    returning id into new_id;
  exception when unique_violation then
    -- someone added the same bill or photo a moment ago
    raise exception 'This bill has already been added' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

-- Customer: wallet ---------------------------------------------------------------------------------

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
  )
  select jsonb_build_object(
    'balance', bal.points,
    'value', round(bal.points * s.point_value, 2),
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
  from s, bal, pend
  where (select uid from me) is not null;
$$;

-- The caller's bills, newest first, with the shop and whether a rejected one can still be fixed.
create or replace function public.my_bills(p_limit int default 100)
returns table (id bigint, shop_id bigint, shop_name text, bill_number text, bill_date date, amount numeric,
               approved_amount numeric, status public.review_status, reject_reason text, admin_note text,
               points int, resubmit_of bigint, can_resubmit boolean, created_at timestamptz,
               decided_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.shop_id, sh.name, b.bill_number, b.bill_date, b.amount, b.approved_amount, b.status,
    b.reject_reason, b.admin_note, b.points, b.resubmit_of,
    b.status = 'rejected' and b.reject_reason <> 'duplicate' and b.resubmit_of is null
      and not exists (select 1 from public.bill_submissions r where r.resubmit_of = b.id)
      and b.decided_at >= now() - make_interval(days => (select bill_age_days from private.points_settings())),
    b.created_at, b.decided_at
  from public.bill_submissions b
  join public.shops sh on sh.id = b.shop_id
  where b.customer_id = (select auth.uid())
  order by b.id desc
  limit least(greatest(p_limit, 1), 500);
$$;

-- Every credit and debit, newest first.
create or replace function public.my_points_history(p_before bigint default null, p_limit int default 50)
returns table (id bigint, kind text, points int, points_remaining int, expires_at timestamptz,
               bill_id bigint, shop_name text, bill_amount numeric, note text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.kind, l.points, l.points_remaining, l.expires_at, l.bill_id, sh.name, b.approved_amount,
    l.note, l.created_at
  from public.points_ledger l
  left join public.bill_submissions b on b.id = l.bill_id
  left join public.shops sh on sh.id = b.shop_id
  where l.customer_id = (select auth.uid()) and (p_before is null or l.id < p_before)
  order by l.id desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- Admin: bill queue ---------------------------------------------------------------------------------

-- p_status null = every status; p_id picks one bill. The queue pages forward from p_before (oldest first);
-- decided bills page backwards (newest first).
create or replace function public.admin_bills(p_status public.review_status default 'pending',
                                              p_before bigint default null, p_limit int default 50,
                                              p_id bigint default null)
returns table (id bigint, customer_id uuid, customer_name text, customer_email text, customer_phone text,
               shop_id bigint, shop_name text, bill_number text, bill_date date, amount numeric,
               approved_amount numeric, photo_key text, photo_deleted boolean, status public.review_status,
               reject_reason text, admin_note text, points int, resubmit_of bigint,
               previous_reason text, created_at timestamptz, decided_at timestamptz, reviewer_email text,
               same_shop_week bigint, customer_bills bigint, customer_rejected bigint)
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
  select b.id, b.customer_id, coalesce(pf.full_name, ''), u.email::text, pf.phone, b.shop_id, sh.name,
    b.bill_number, b.bill_date, b.amount, b.approved_amount, b.photo_key, b.photo_deleted_at is not null,
    b.status, b.reject_reason, b.admin_note, b.points, b.resubmit_of, prev.reject_reason, b.created_at,
    b.decided_at, ru.email::text,
    -- warnings, not limits: many bills from one shop in a short time
    (select count(*) from public.bill_submissions x
     where x.customer_id = b.customer_id and x.shop_id = b.shop_id
       and x.created_at > b.created_at - interval '7 days' and x.id <= b.id),
    (select count(*) from public.bill_submissions x where x.customer_id = b.customer_id),
    (select count(*) from public.bill_submissions x where x.customer_id = b.customer_id and x.status = 'rejected')
  from public.bill_submissions b
  join public.shops sh on sh.id = b.shop_id
  left join public.profiles pf on pf.id = b.customer_id
  left join auth.users u on u.id = b.customer_id
  left join auth.users ru on ru.id = b.reviewed_by
  left join public.bill_submissions prev on prev.id = b.resubmit_of
  where (p_status is null or b.status = p_status)
    and (p_id is null or b.id = p_id)
    and (p_before is null or (case when p_status = 'pending' then b.id > p_before else b.id < p_before end))
  -- the queue shows the oldest bill first; decided bills newest first
  order by case when p_status = 'pending' then b.id end asc, b.id desc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

-- Approves a pending bill and credits its points as one batch. p_amount corrects the typed amount.
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
      'Your points are worth ' || private.rupees((before_bal + pts) * s.point_value)
        || '. Cash-out to UPI is coming soon.',
      '/points');
  end if;
  return jsonb_build_object('points', pts, 'balance', before_bal + pts);
end;
$$;

create or replace function public.reject_bill(p_bill_id bigint, p_reason text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bill_submissions;
  shop text;
  why text := case p_reason
    when 'blurry' then 'the photo is blurry or the bill cannot be read'
    when 'wrong_shop' then 'the bill is not from the shop you picked'
    when 'duplicate' then 'this bill was already added'
    when 'amount_mismatch' then 'the amount does not match the bill' end;
  can_fix boolean;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if why is null then
    raise exception 'Pick a reason' using errcode = 'P0001';
  end if;
  select * into b from public.bill_submissions where id = p_bill_id for update;
  if not found then
    raise exception 'Bill not found' using errcode = 'P0001';
  end if;
  if b.status <> 'pending' then
    raise exception 'This bill was already %', b.status using errcode = 'P0001';
  end if;
  update public.bill_submissions
    set status = 'rejected', reject_reason = p_reason, admin_note = left(nullif(btrim(p_note), ''), 300),
        reviewed_by = (select auth.uid()), decided_at = now()
    where id = b.id;

  -- a duplicate cannot be fixed; anything else can be sent again once
  can_fix := b.resubmit_of is null and p_reason <> 'duplicate';
  select name into shop from public.shops where id = b.shop_id;
  perform private.notify(b.customer_id, 'points',
    'Bill not approved',
    'Your ' || private.rupees(b.amount) || ' bill at ' || shop || ' was not approved: ' || why
      || coalesce(' (' || left(nullif(btrim(p_note), ''), 120) || ')', '') || '.'
      || case when can_fix then ' Tap to fix it and send it again.' else '' end,
    case when can_fix then '/points/add?fix=' || b.id else '/points/bills' end);
end;
$$;

-- Vendors whose shops have customer bills cannot be deleted either: the bills back customers' points.
create or replace function public.admin_delete_vendor(p_vendor_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  members uuid[];
begin
  if not private.has_role('super_admin') then
    raise exception 'Only a super admin can delete vendors' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.invoices where vendor_id = p_vendor_id) then
    raise exception 'This vendor has invoices, which must be kept. Block the vendor instead.'
      using errcode = '23503';
  end if;
  if exists (select 1 from public.bill_submissions b join public.shops s on s.id = b.shop_id
             where s.vendor_id = p_vendor_id) then
    raise exception 'Customers have added bills from this vendor''s shops for points, which must be kept. Block the vendor instead.'
      using errcode = '23503';
  end if;
  select array_agg(distinct m) into members from (
    select owner_id as m from public.vendors where id = p_vendor_id
    union all
    select user_id from public.vendor_staff where vendor_id = p_vendor_id and removed_at is null
  ) x;
  delete from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  delete from public.user_roles r
  where r.role = 'vendor' and r.user_id = any (members)
    and not exists (select 1 from public.vendors v where v.owner_id = r.user_id)
    and not exists (select 1 from public.vendor_staff s where s.user_id = r.user_id and s.removed_at is null);
end;
$$;

-- Housekeeping --------------------------------------------------------------------------------------

-- Run daily by pg_cron: expire leftover points and warn 30 and 7 days before a batch expires.
create or replace function public.points_daily()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.points_settings := private.points_settings();
  expired int := 0;
  warned int := 0;
  r record;
begin
  -- 1. expire
  for r in
    select id, customer_id, points_remaining from public.points_ledger
    where points_remaining > 0 and expires_at <= now()
    order by id
    for update skip locked
  loop
    update public.points_ledger set points_remaining = 0 where id = r.id;
    insert into public.points_ledger (customer_id, kind, points, note)
      values (r.customer_id, 'expire', -r.points_remaining, 'Batch #' || r.id || ' expired');
    expired := expired + 1;
  end loop;

  -- 2. warn, one message per customer and window (7-day warnings first, so a batch never gets both today)
  for r in
    with due as (
      update public.points_ledger set warned_7_at = now(), warned_30_at = coalesce(warned_30_at, now())
      where points_remaining > 0 and warned_7_at is null and expires_at > now()
        and expires_at <= now() + interval '7 days'
      returning customer_id, points_remaining, expires_at
    )
    select customer_id, sum(points_remaining)::int as pts, min(expires_at) as first_at from due group by customer_id
  loop
    perform private.notify(r.customer_id, 'points',
      private.points_text(r.pts) || ' expire this week',
      private.points_text(r.pts) || ' (' || private.rupees(r.pts * s.point_value) || ') expire on '
        || to_char(r.first_at at time zone 'Asia/Kolkata', 'FMDD Mon') || '. Add bills to keep growing your balance.',
      '/points');
    warned := warned + 1;
  end loop;
  for r in
    with due as (
      update public.points_ledger set warned_30_at = now()
      where points_remaining > 0 and warned_30_at is null and expires_at > now() + interval '7 days'
        and expires_at <= now() + interval '30 days'
      returning customer_id, points_remaining, expires_at
    )
    select customer_id, sum(points_remaining)::int as pts, min(expires_at) as first_at from due group by customer_id
  loop
    perform private.notify(r.customer_id, 'points',
      private.points_text(r.pts) || ' expire in 30 days',
      private.points_text(r.pts) || ' (' || private.rupees(r.pts * s.point_value) || ') expire on '
        || to_char(r.first_at at time zone 'Asia/Kolkata', 'FMDD Mon YYYY') || '.',
      '/points');
    warned := warned + 1;
  end loop;
  return jsonb_build_object('expired_batches', expired, 'warnings', warned);
end;
$$;

-- For the Worker (service role): bill photos to delete from R2, 90 days after the bill was decided.
-- A photo shared with a later "fixed" bill waits until that one is old enough too.
create or replace function public.bill_photos_due(p_limit int default 200)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.photo_key from public.bill_submissions b
  where b.photo_deleted_at is null and b.decided_at < now() - interval '90 days'
    and not exists (select 1 from public.bill_submissions o
                    where o.photo_key = b.photo_key
                      and (o.decided_at is null or o.decided_at >= now() - interval '90 days'))
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.mark_bill_photos_deleted(p_keys text[])
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with done as (
    update public.bill_submissions set photo_deleted_at = now()
    where photo_key = any (p_keys) and photo_deleted_at is null
    returning 1
  )
  select count(*)::int from done;
$$;

-- Grants ----------------------------------------------------------------------------------------------

revoke execute on function public.points_shops(text, int),
  public.check_bill(bigint, text, date, numeric, bigint),
  public.submit_bill(bigint, text, date, numeric, text, text, bigint), public.points_wallet(),
  public.my_bills(int), public.my_points_history(bigint, int),
  public.admin_bills(public.review_status, bigint, int, bigint), public.approve_bill(bigint, numeric),
  public.reject_bill(bigint, text, text), public.points_daily(), public.bill_photos_due(int),
  public.mark_bill_photos_deleted(text[])
  from public, anon, authenticated;
grant execute on function public.points_shops(text, int),
  public.check_bill(bigint, text, date, numeric, bigint),
  public.submit_bill(bigint, text, date, numeric, text, text, bigint), public.points_wallet(),
  public.my_bills(int), public.my_points_history(bigint, int),
  public.admin_bills(public.review_status, bigint, int, bigint), public.approve_bill(bigint, numeric),
  public.reject_bill(bigint, text, text)
  to authenticated;
grant execute on function public.bill_photos_due(int), public.mark_bill_photos_deleted(text[]) to service_role;

-- Daily points job at 00:10 India time. Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('points-daily', '40 18 * * *', 'select public.points_daily()');
  end if;
end $$;
