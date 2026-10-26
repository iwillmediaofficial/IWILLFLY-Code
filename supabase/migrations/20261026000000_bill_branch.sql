-- Bills name the branch, not just the shop. A shop with more than one live branch needs the customer to pick
-- the branch the bill is from; a shop with one live branch gets it filled in by the server. Old bills keep
-- branch_id null. The duplicate-bill rule stays per shop (one bill number + date per shop), and the "own shop"
-- rule already covers every member of the business, branch staff included (private.works_at_shop).
--
-- my_bills, admin_bills and points_shops return new columns and check_bill / submit_bill take a new trailing
-- p_branch_id (default null, so the app before this change keeps working). Postgres cannot change a function's
-- result columns or argument list in place, so they are dropped and created again below. Nothing else
-- depends on them; this file runs in one transaction.

alter table public.bill_submissions
  add column if not exists branch_id bigint references public.branches (id) on delete set null;
create index if not exists bill_submissions_branch_idx on public.bill_submissions (branch_id);

-- Which branch a bill is from. p_branch_id as picked (null = not picked); p_resubmit_of = the rejected bill
-- being fixed, whose branch is kept unless it was rejected for the wrong shop. Raises a message the customer
-- can read; returns the branch to store (null only for a shop with no live branch).
create or replace function private.bill_branch(uid uuid, p_shop_id bigint, p_branch_id bigint,
                                               p_resubmit_of bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  live bigint[];
  kept bigint;
begin
  select coalesce(array_agg(b.id order by b.id), '{}') into live
  from public.branches b
  where b.shop_id = p_shop_id and private.branch_is_live(b.id);

  if p_branch_id is not null then
    if not (p_branch_id = any (live)) then
      raise exception 'Pick a branch of this shop listed on IWILLFLY' using errcode = 'P0001';
    end if;
    return p_branch_id;
  end if;

  if p_resubmit_of is not null then
    select prev.branch_id into kept from public.bill_submissions prev
    where prev.id = p_resubmit_of and prev.customer_id = uid and prev.shop_id = p_shop_id
      and prev.reject_reason is distinct from 'wrong_shop';
    if kept = any (live) then
      return kept;
    end if;
  end if;

  if cardinality(live) > 1 then
    raise exception 'Pick the branch the bill is from' using errcode = 'P0001';
  end if;
  return live[1];
end;
$$;
revoke execute on function private.bill_branch(uuid, bigint, bigint, bigint) from public, anon, authenticated;

-- Customer: bills ------------------------------------------------------------------------------------

drop function if exists public.points_shops(text, int);
drop function if exists public.check_bill(bigint, text, date, numeric, bigint);
drop function if exists public.submit_bill(bigint, text, date, numeric, text, text, bigint);
drop function if exists public.my_bills(int);
drop function if exists public.admin_bills(public.review_status, bigint, int, bigint);

-- Live shops for the "Which shop?" picker, matched by name. branch_count = live branches, so the app knows
-- whether to ask "Which branch?".
create or replace function public.points_shops(p_q text default null, p_limit int default 20)
returns table (id bigint, name text, logo_key text, area text, branch_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select sh.id, sh.name, sh.logo_key,
    (select coalesce(l.name, b.address) from public.branches b left join public.locations l on l.id = b.location_id
     where b.shop_id = sh.id order by private.branch_is_live(b.id) desc, b.id limit 1),
    (select count(*)::int from public.branches b where b.shop_id = sh.id and private.branch_is_live(b.id))
  from public.shops sh
  join public.vendors v on v.id = sh.vendor_id
  where sh.is_active and v.status = 'approved'
    and (nullif(btrim(p_q), '') is null
         or sh.name ilike '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by sh.name, sh.id
  limit least(greatest(p_limit, 1), 50);
$$;

-- Live branches of a live shop for the "Which branch?" list. area = the locality the branch sits in.
create or replace function public.points_shop_branches(p_shop_id bigint)
returns table (id bigint, name text, area text, address text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, l.name, b.address, b.lat, b.lng
  from public.branches b
  left join public.locations l on l.id = b.location_id
  where b.shop_id = p_shop_id and private.shop_is_live(p_shop_id) and private.branch_is_live(b.id)
  order by b.name, b.id;
$$;

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
  return floor(p_amount / s.rupees_per_point)::int;
end;
$$;

-- Adds a bill for checking. p_photo_key comes from the upload Worker (bills/<your id>/<sha256>.webp).
create or replace function public.submit_bill(p_shop_id bigint, p_bill_number text, p_bill_date date,
                                              p_amount numeric, p_photo_key text,
                                              p_source_sha256 text default null,
                                              p_resubmit_of bigint default null,
                                              p_branch_id bigint default null)
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
  br bigint;
begin
  perform public.check_bill(p_shop_id, p_bill_number, p_bill_date, p_amount, p_resubmit_of, p_branch_id);
  br := private.bill_branch(uid, p_shop_id, p_branch_id, p_resubmit_of);
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
    insert into public.bill_submissions (customer_id, shop_id, branch_id, bill_number, bill_date, amount,
                                         photo_key, source_sha256, resubmit_of)
    values (uid, p_shop_id, br, btrim(p_bill_number), p_bill_date, p_amount, p_photo_key, src, p_resubmit_of)
    returning id into new_id;
  exception when unique_violation then
    -- someone added the same bill or photo a moment ago
    raise exception 'This bill has already been added' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

-- The caller's bills, newest first, with the shop, the branch and whether a rejected one can still be fixed.
create or replace function public.my_bills(p_limit int default 100)
returns table (id bigint, shop_id bigint, shop_name text, bill_number text, bill_date date, amount numeric,
               approved_amount numeric, status public.review_status, reject_reason text, admin_note text,
               points int, resubmit_of bigint, can_resubmit boolean, created_at timestamptz,
               decided_at timestamptz, branch_id bigint, branch_name text, branch_area text)
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
    b.created_at, b.decided_at, b.branch_id, br.name, l.name
  from public.bill_submissions b
  join public.shops sh on sh.id = b.shop_id
  left join public.branches br on br.id = b.branch_id
  left join public.locations l on l.id = br.location_id
  where b.customer_id = (select auth.uid())
  order by b.id desc
  limit least(greatest(p_limit, 1), 500);
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
               same_shop_week bigint, customer_bills bigint, customer_rejected bigint,
               branch_id bigint, branch_name text, branch_area text)
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
    (select count(*) from public.bill_submissions x where x.customer_id = b.customer_id and x.status = 'rejected'),
    b.branch_id, br.name, l.name
  from public.bill_submissions b
  join public.shops sh on sh.id = b.shop_id
  left join public.branches br on br.id = b.branch_id
  left join public.locations l on l.id = br.location_id
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

-- Grants ----------------------------------------------------------------------------------------------

revoke execute on function public.points_shops(text, int), public.points_shop_branches(bigint),
  public.check_bill(bigint, text, date, numeric, bigint, bigint),
  public.submit_bill(bigint, text, date, numeric, text, text, bigint, bigint),
  public.my_bills(int), public.admin_bills(public.review_status, bigint, int, bigint)
  from public, anon, authenticated;
grant execute on function public.points_shops(text, int), public.points_shop_branches(bigint),
  public.check_bill(bigint, text, date, numeric, bigint, bigint),
  public.submit_bill(bigint, text, date, numeric, text, text, bigint, bigint),
  public.my_bills(int), public.admin_bills(public.review_status, bigint, int, bigint)
  to authenticated;
