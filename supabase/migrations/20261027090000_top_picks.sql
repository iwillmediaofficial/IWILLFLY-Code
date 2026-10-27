-- IWILLFLY Top Picks: vendors (and branch managers) pay to show one of their approved offers in a district's
-- "Top Picks" row on Home. No admin approval: the offer was already approved. First come, first shown; a
-- sponsorship that is not renewed by its last day loses its place. The old "Promoted offer" add-on is retired.

-- Settings and prices --------------------------------------------------------------------------------------

create table public.top_pick_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  places_per_district int not null default 10 check (places_per_district between 1 and 50),
  updated_at timestamptz not null default now()
);
insert into public.top_pick_settings (id) values (1);

-- One row per length a vendor can buy (7, 15, 30 days...). Start switched off so nothing sells at Rs 0.
create table public.top_pick_lengths (
  id bigint generated always as identity primary key,
  days int not null unique check (days between 1 and 366),
  price numeric(10,2) not null default 0 check (price >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.top_pick_lengths (days) values (7), (15), (30);

-- The owner can stop branch managers from buying Top Picks.
alter table public.vendors add column managers_can_sponsor boolean not null default true;

-- Sponsorships ---------------------------------------------------------------------------------------------

-- status: awaiting_payment (invoice not paid yet), waiting (paid, district full), live (holds a place),
-- ended (ran out or not renewed in time), removed (by an admin), cancelled (invoice cancelled before paying).
create table public.top_picks (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  shop_id bigint not null references public.shops (id) on delete cascade,
  offer_id bigint not null references public.offers (id) on delete cascade,
  district_id bigint not null references public.locations (id) on delete restrict,
  branch_id bigint references public.branches (id) on delete set null,  -- set when a branch manager bought it
  bought_by uuid references auth.users (id) on delete set null,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'waiting', 'live', 'ended', 'removed', 'cancelled')),
  queued_at timestamptz,          -- when it was paid: the order in the waiting list
  live_since timestamptz,         -- the order in the row: first come, first shown
  starts_on date,
  ends_on date,
  waiting_days int not null default 0 check (waiting_days >= 0), -- paid days not started yet (waiting list)
  reminded_2 boolean not null default false,
  reminded_0 boolean not null default false,
  removed_reason text check (char_length(removed_reason) <= 300),
  removed_by uuid references auth.users (id) on delete set null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One running sponsorship per offer per district.
create unique index top_picks_one_per_offer_idx on public.top_picks (offer_id, district_id)
  where status in ('awaiting_payment', 'waiting', 'live');
create index top_picks_district_idx on public.top_picks (district_id, status, live_since);
create index top_picks_vendor_idx on public.top_picks (vendor_id, created_at desc);
create index top_picks_shop_idx on public.top_picks (shop_id);
create index top_picks_branch_idx on public.top_picks (branch_id);
create index top_picks_bought_by_idx on public.top_picks (bought_by);
create index top_picks_removed_by_idx on public.top_picks (removed_by);

create trigger top_picks_updated_at before update on public.top_picks
  for each row execute function public.set_updated_at();
create trigger top_pick_lengths_updated_at before update on public.top_pick_lengths
  for each row execute function public.set_updated_at();
create trigger top_picks_audit after insert or update or delete on public.top_picks
  for each row execute function private.audit_change();
create trigger top_pick_settings_audit after insert or update or delete on public.top_pick_settings
  for each row execute function private.audit_change();
create trigger top_pick_lengths_audit after insert or update or delete on public.top_pick_lengths
  for each row execute function private.audit_change();

-- Views and taps from the Top Picks row, per sponsorship per day.
create table public.top_pick_stats_daily (
  day date not null,
  top_pick_id bigint not null references public.top_picks (id) on delete cascade,
  views int not null default 0,
  taps int not null default 0,
  primary key (top_pick_id, day)
);

-- Invoice lines can pay for a sponsorship (new or renewal).
alter table public.invoice_items add column top_pick_id bigint references public.top_picks (id) on delete set null;
create index invoice_items_top_pick_idx on public.invoice_items (top_pick_id);
alter table public.invoice_items drop constraint if exists invoice_items_check;
alter table public.invoice_items add constraint invoice_items_check
  check (num_nonnulls(plan_id, addon_id) + branch_charge::int + (top_pick_id is not null)::int = 1);

-- Retire "Promoted offer": no new purchases; ones already running keep going until they end.
update public.addons set is_active = false where kind = 'promoted_offer' and is_active;

-- RLS ------------------------------------------------------------------------------------------------------

alter table public.top_pick_settings enable row level security;
alter table public.top_pick_lengths enable row level security;
alter table public.top_picks enable row level security;
alter table public.top_pick_stats_daily enable row level security;

create policy "top_pick_settings: signed-in read" on public.top_pick_settings
  for select to authenticated using (true);
create policy "top_pick_settings: admin update" on public.top_pick_settings
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "top_pick_lengths: read active or admin" on public.top_pick_lengths
  for select to authenticated using (is_active or (select private.is_admin()));
create policy "top_pick_lengths: admin insert" on public.top_pick_lengths
  for insert to authenticated with check ((select private.is_admin()));
create policy "top_pick_lengths: admin update" on public.top_pick_lengths
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "top_pick_lengths: admin delete" on public.top_pick_lengths
  for delete to authenticated using ((select private.is_admin()));

-- Changes go through the functions below; reading is for the team (a branch member sees their branch's).
create policy "top_picks: team or support read" on public.top_picks
  for select to authenticated using (
    (select private.is_support())
    or (vendor_id = (select private.my_member_vendor_id())
        and ((select private.my_member_branch_id()) is null or branch_id = (select private.my_member_branch_id()))));

create policy "top_pick_stats_daily: team or support read" on public.top_pick_stats_daily
  for select to authenticated using (
    exists (select 1 from public.top_picks t where t.id = top_pick_id));

revoke insert, update, delete on public.top_picks, public.top_pick_stats_daily from anon, authenticated;
revoke all on public.top_pick_settings, public.top_pick_lengths, public.top_picks, public.top_pick_stats_daily
  from anon;

-- A branch manager pays the invoices they made themselves -------------------------------------------------

create or replace function private.can_pay_invoice(i public.invoices, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.vendors v where v.id = i.vendor_id and v.owner_id = uid)
    or (i.created_by = uid and exists (
          select 1 from public.vendor_staff s
          where s.vendor_id = i.vendor_id and s.user_id = uid and s.removed_at is null and s.disabled_at is null));
$$;

drop policy "invoices: owner or support read" on public.invoices;
create policy "invoices: owner, buyer or support read" on public.invoices
  for select to authenticated using (
    (select private.is_vendor_owner(vendor_id)) or (select private.is_support())
    or (created_by = (select auth.uid()) and vendor_id = (select private.my_member_vendor_id())));
drop policy "invoice_items: owner or support read" on public.invoice_items;
create policy "invoice_items: owner, buyer or support read" on public.invoice_items
  for select to authenticated using (exists (select 1 from public.invoices i where i.id = invoice_id));

create or replace function public.submit_payment(p_invoice_id bigint, p_ref text default null, p_note text default null,
                                                 p_proof_key text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref text := nullif(trim(coalesce(p_ref, '')), '');
  proof text := nullif(trim(coalesce(p_proof_key, '')), '');
  i public.invoices;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce((select pay_upi from public.billing_settings where id = 1), true) then
    raise exception 'UPI payment is switched off' using errcode = 'P0001';
  end if;
  if ref is null and proof is null then
    raise exception 'Enter the UPI transaction ID or add a screenshot of the payment' using errcode = '22023';
  end if;
  if ref is not null and char_length(ref) > 60 then
    raise exception 'Transaction ID is too long (60 characters max)' using errcode = '22023';
  end if;
  -- Only a screenshot this person uploaded (the Worker names it after their user id).
  if proof is not null and (proof !~ '^payments/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
                            or split_part(proof, '/', 2) <> (select auth.uid())::text) then
    raise exception 'Please add the screenshot again' using errcode = '22023';
  end if;

  select * into i from public.invoices where id = p_invoice_id and status in ('unpaid', 'submitted') for update;
  if i.id is null or not private.can_pay_invoice(i, (select auth.uid())) then
    raise exception 'Invoice not found or already settled' using errcode = 'P0002';
  end if;
  update public.invoices
    set status = 'submitted',
        payer_ref = ref,
        payer_note = left(nullif(trim(coalesce(p_note, '')), ''), 300),
        payer_proof_key = proof,
        submitted_at = now()
    where id = i.id
    returning * into i;

  -- Tell the admins there is a UPI payment to check.
  perform private.notify(u.user_id, 'billing', 'UPI payment to check: ' || i.number,
    coalesce(i.bill_to->>'business_name', 'A vendor') || ' says they paid ' || i.total::text
      || ' by UPI' || coalesce(' (ref ' || ref || ')', ' (screenshot added)') || '.',
    '/admin/billing/invoices/' || i.id)
  from (select distinct user_id from public.user_roles where role in ('admin', 'super_admin')) u;
end;
$$;

create or replace function public.gateway_invoice_for(p_invoice_id bigint, p_user uuid, p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  v public.vendors;
  s public.billing_settings;
  recent public.gateway_payments;
begin
  select * into s from public.billing_settings where id = 1;
  if p_provider = 'instamojo' then
    if not coalesce(s.pay_instamojo, true) then
      raise exception 'Online payment is switched off' using errcode = 'P0001';
    end if;
  elsif p_provider = 'razorpay' then
    if not coalesce(s.pay_razorpay, false) then
      raise exception 'Razorpay payment is switched off' using errcode = 'P0001';
    end if;
  else
    raise exception 'Unknown payment provider' using errcode = '22023';
  end if;
  select * into i from public.invoices where id = p_invoice_id;
  select * into v from public.vendors where id = i.vendor_id;
  if i.id is null or not private.can_pay_invoice(i, p_user) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if v.status = 'blocked' then
    raise exception 'This account is blocked' using errcode = 'insufficient_privilege';
  end if;
  if i.status not in ('unpaid', 'submitted') then
    raise exception 'This invoice is already settled' using errcode = 'P0001';
  end if;
  if p_provider = 'instamojo' and i.total < 9 then
    raise exception 'Online payment needs at least Rs 9' using errcode = 'P0001';
  end if;
  if p_provider = 'razorpay' and i.total < 1 then
    raise exception 'Online payment needs at least Rs 1' using errcode = 'P0001';
  end if;
  -- A payment page opened in the last 20 minutes for the same amount is offered again instead of a new one.
  select * into recent from public.gateway_payments
    where invoice_id = i.id and provider = p_provider and status = 'created' and amount = i.total
      and created_at > now() - interval '20 minutes'
    order by created_at desc, id desc limit 1;
  return jsonb_build_object(
    'invoice_id', i.id, 'number', i.number, 'amount', i.total, 'vendor_id', v.id,
    'business_name', v.business_name,
    'email', (select u.email from auth.users u where u.id = p_user),
    'phone', coalesce(v.contact_phone, (select p.phone from public.profiles p where p.id = v.owner_id)),
    'reuse_url', recent.longurl,
    'open_requests', coalesce((select jsonb_agg(g.request_id order by g.created_at) from public.gateway_payments g
                               where g.invoice_id = i.id and g.provider = p_provider and g.status = 'created'),
                              '[]'::jsonb));
end;
$$;

-- Districts ------------------------------------------------------------------------------------------------

-- The district an area (or city) belongs to, walking up Admin > Locations.
create or replace function private.district_of(loc bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select id, parent_id, kind, 0 as depth from public.locations where id = loc
    union all
    select l.id, l.parent_id, l.kind, up.depth + 1 from public.locations l join up on l.id = up.parent_id
    where up.kind <> 'district' and up.depth < 6
  )
  select id from up where kind = 'district' limit 1;
$$;

-- Live branches of the offer's shop that have the offer, in a district (any district when d is null).
create or replace function private.offer_branches_in(o bigint, d bigint)
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select br.id
  from public.offers x
  join public.branches br on br.shop_id = x.shop_id
  where x.id = o and br.review_status = 'approved' and not br.awaiting_payment
    and private.offer_at_branch(x.all_branches, x.id, br.id)
    and (d is null or private.district_of(br.location_id) = d);
$$;

-- Who may sponsor an offer: the owner, or a branch manager whose branch has the offer (if the owner allows).
-- Returns the manager's branch id, 0 for the owner, null when not allowed.
create or replace function private.sponsor_branch(o bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.offers x join public.shops sh on sh.id = x.shop_id
                 join public.vendors v on v.id = sh.vendor_id
                 where x.id = o and v.owner_id = (select auth.uid()) and v.status <> 'blocked') then 0
    when private.my_branch_id() is not null and exists (
           select 1 from public.offers x join public.shops sh on sh.id = x.shop_id
           join public.vendors v on v.id = sh.vendor_id join public.branches br on br.id = private.my_branch_id()
           where x.id = o and br.shop_id = x.shop_id and v.managers_can_sponsor and v.status <> 'blocked'
             and private.offer_at_branch(x.all_branches, x.id, br.id)) then private.my_branch_id()
  end;
$$;

-- Places --------------------------------------------------------------------------------------------------

create or replace function private.top_pick_places()
returns int
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select places_per_district from public.top_pick_settings where id = 1), 10) $$;

-- Moves sponsorships from the waiting list into free places, oldest payment first.
create or replace function private.fill_top_picks(d bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  free int;
  t public.top_picks;
  today date := private.today_ist();
begin
  perform pg_advisory_xact_lock(hashtextextended('top_picks:' || d, 0));
  free := private.top_pick_places() - (select count(*) from public.top_picks where district_id = d and status = 'live');
  for t in select * from public.top_picks where district_id = d and status = 'waiting'
           order by queued_at, id limit greatest(free, 0) loop
    update public.top_picks
      set status = 'live', live_since = now(), starts_on = today, ends_on = today + t.waiting_days - 1,
          waiting_days = 0, reminded_2 = false, reminded_0 = false
      where id = t.id;
    perform private.top_pick_notify(t.id, 'Your Top Pick is live',
      'A place opened up. Your offer is now in Top Picks for ' || private.top_pick_days_text(t.waiting_days) || '.');
  end loop;
end;
$$;

create or replace function private.top_pick_days_text(n int)
returns text
language sql
immutable
set search_path = ''
as $$ select n || case when n = 1 then ' day' else ' days' end $$;

-- Inbox message to the owner, and to the branch manager who bought it.
create or replace function private.top_pick_notify(p_id bigint, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.top_picks;
  label text;
begin
  select * into t from public.top_picks where id = p_id;
  select o.title || ' · ' || coalesce(l.name, 'district') into label
    from public.offers o, public.locations l where o.id = t.offer_id and l.id = t.district_id;
  perform private.notify(u, 'billing', p_title, coalesce(label || '. ', '') || p_body, '/vendor/top-picks')
  from (select distinct u from unnest(array[private.vendor_owner(t.vendor_id),
          case when t.branch_id is not null then t.bought_by end]) u where u is not null) x;
end;
$$;

-- Paid: a new sponsorship goes live (or waits for a place); a renewal adds days to the end.
create or replace function private.top_pick_paid(p_id bigint, p_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.top_picks;
  running bigint;
  today date := private.today_ist();
begin
  select * into t from public.top_picks where id = p_id for update;
  if t.id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('top_picks:' || t.district_id, 0));
  if t.status = 'awaiting_payment' then
    if (select count(*) from public.top_picks where district_id = t.district_id and status = 'live')
         < private.top_pick_places()
       and not exists (select 1 from public.top_picks where district_id = t.district_id and status = 'waiting') then
      update public.top_picks
        set status = 'live', queued_at = now(), live_since = now(), starts_on = today, ends_on = today + p_days - 1
        where id = t.id;
    else
      update public.top_picks set status = 'waiting', queued_at = now(), waiting_days = p_days where id = t.id;
      perform private.top_pick_notify(t.id, 'You are on the Top Picks waiting list',
        'All places in this district are taken. Your ' || private.top_pick_days_text(p_days)
          || ' start the day a place opens. We will tell you.');
    end if;
  elsif t.status = 'live' then
    update public.top_picks
      set ends_on = greatest(ends_on, today - 1) + p_days, reminded_2 = false, reminded_0 = false
      where id = t.id;
  elsif t.status = 'waiting' then
    update public.top_picks set waiting_days = waiting_days + p_days where id = t.id;
  elsif t.status in ('ended', 'removed', 'cancelled') then
    -- Paid after it had already ended (for example an online payment that came in late): start again at the back.
    -- If the same offer is running here again by now, the days go to that one.
    select id into running from public.top_picks where offer_id = t.offer_id and district_id = t.district_id
      and status in ('waiting', 'live');
    if running is not null then
      perform private.top_pick_paid(running, p_days);
      return;
    end if;
    if exists (select 1 from public.top_picks where offer_id = t.offer_id and district_id = t.district_id
               and status = 'awaiting_payment') then
      update public.top_picks set status = 'cancelled', ended_at = now()
        where offer_id = t.offer_id and district_id = t.district_id and status = 'awaiting_payment';
    end if;
    update public.top_picks
      set status = 'waiting', queued_at = now(), waiting_days = p_days, live_since = null, starts_on = null,
          ends_on = null, ended_at = null, removed_reason = null, removed_by = null
      where id = t.id;
    perform private.fill_top_picks(t.district_id);
  end if;
end;
$$;

-- activate_invoice also settles Top Picks lines.
create or replace function private.activate_invoice(p_invoice_id bigint, p_method text, p_ref text,
                                                    p_paid_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  it public.invoice_items;
  k public.addon_kind;
  st date;
  today date := private.today_ist();
begin
  update public.invoices
    set status = 'paid', payment_method = p_method, payment_ref = coalesce(nullif(trim(p_ref), ''), payer_ref),
        paid_on = coalesce(p_paid_on, today), recorded_by = (select auth.uid())
    where id = p_invoice_id
    returning * into i;
  for it in select * from public.invoice_items where invoice_id = i.id order by id loop
    if it.plan_id is not null then
      st := greatest(today, coalesce(
        (select max(ends_on) + 1 from public.subscriptions
         where vendor_id = i.vendor_id and plan_id = it.plan_id and cancelled_at is null and ends_on >= today),
        today));
      insert into public.subscriptions (vendor_id, plan_id, invoice_item_id, starts_on, ends_on)
      values (i.vendor_id, it.plan_id, it.id, st, st + it.days - 1);
      update public.branches br set awaiting_payment = false
        from public.shops s
        where s.id = br.shop_id and s.vendor_id = i.vendor_id and br.awaiting_payment
          and br.payment_invoice_id is null;
    elsif it.branch_charge then
      update public.branches set awaiting_payment = false, payment_invoice_id = i.id
        where id = it.branch_id and payment_invoice_id = i.id;
    elsif it.top_pick_id is not null then
      perform private.top_pick_paid(it.top_pick_id, it.days);
    else
      k := (select kind from public.addons where id = it.addon_id);
      st := greatest(today, coalesce(
        (select max(ends_on) + 1 from public.addon_purchases
         where vendor_id = i.vendor_id and kind = k and cancelled_at is null and ends_on >= today
           and shop_id is not distinct from it.shop_id and offer_id is not distinct from it.offer_id),
        today));
      insert into public.addon_purchases (vendor_id, addon_id, kind, shop_id, offer_id, invoice_item_id,
                                          starts_on, ends_on)
      values (i.vendor_id, it.addon_id, k, it.shop_id, it.offer_id, it.id, st, st + it.days - 1);
    end if;
  end loop;
  perform private.apply_addon_flags();
  perform private.notify(private.vendor_owner(i.vendor_id), 'billing', 'Payment received: ' || i.number,
    'Thank you. What you bought is now active.', '/vendor/billing');
  -- A branch manager who bought a Top Pick hears about their own payment too.
  if i.created_by is distinct from private.vendor_owner(i.vendor_id)
     and exists (select 1 from public.vendor_staff s where s.vendor_id = i.vendor_id and s.user_id = i.created_by
                 and s.removed_at is null) then
    perform private.notify(i.created_by, 'billing', 'Payment received: ' || i.number,
      'Thank you. What you bought is now active.', '/vendor/top-picks');
  end if;
end;
$$;

-- A cancelled invoice cancels the new sponsorship it was for (renewals just don't happen).
create or replace function public.cancel_unpaid_top_picks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.top_picks t set status = 'cancelled', ended_at = now()
    from public.invoice_items it
    where it.invoice_id = new.id and it.top_pick_id = t.id and t.status = 'awaiting_payment';
  return null;
end;
$$;
create trigger invoices_cancel_top_picks after update of status on public.invoices
  for each row when (new.status = 'void' and old.status is distinct from 'void')
  execute function public.cancel_unpaid_top_picks();

-- Vendor side ----------------------------------------------------------------------------------------------

-- Lengths are checked against the offer's end date: a sponsorship can't run past the offer.
create or replace function private.top_pick_check_offer(o public.offers, last_day date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if o.id is null or o.status <> 'approved' then
    raise exception 'Only approved offers can be Top Picks' using errcode = '22023';
  end if;
  if o.ends_on is not null and o.ends_on < private.today_ist() then
    raise exception 'This offer has ended' using errcode = '22023';
  end if;
  if o.ends_on is not null and last_day > o.ends_on then
    raise exception 'The offer ends on %. Choose a shorter length, or extend the offer first.',
      to_char(o.ends_on, 'DD Mon YYYY') using errcode = '22023';
  end if;
end;
$$;

-- Makes an invoice for one Top Picks line. Returns the invoice id (already paid when the price is 0).
create or replace function private.top_pick_invoice(v public.vendors, p_pick bigint, len public.top_pick_lengths,
                                                    label text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.billing_settings;
  inv bigint;
begin
  if (select count(*) from public.invoices
      where vendor_id = v.id and status in ('unpaid', 'submitted') and created_by = (select auth.uid())) >= 5 then
    raise exception 'You have 5 unpaid invoices. Pay or ask us to cancel one first.' using errcode = 'P0001';
  end if;
  select * into s from public.billing_settings where id = 1;
  insert into public.invoices (number, vendor_id, gst_percent, bill_to, bill_from, created_by)
  values (s.invoice_prefix || '-' || to_char(private.today_ist(), 'YYYY') || '-'
            || lpad(nextval('public.invoice_number_seq')::text, 5, '0'),
          v.id, s.gst_percent,
          jsonb_build_object('business_name', v.business_name, 'phone', v.contact_phone, 'vendor_id', v.id),
          jsonb_build_object('name', s.business_name, 'address', s.business_address, 'gstin', s.gstin,
                             'upi_id', s.upi_id, 'payee_name', s.payee_name, 'note', s.payment_note),
          (select auth.uid()))
  returning id into inv;
  insert into public.invoice_items (invoice_id, top_pick_id, shop_id, offer_id, branch_id, description, days, amount)
  select inv, t.id, t.shop_id, t.offer_id, t.branch_id, left(label, 200), len.days, len.price
  from public.top_picks t where t.id = p_pick;
  perform private.invoice_totals(inv);
  if len.price = 0 then
    perform private.activate_invoice(inv, 'free', null, null);
  end if;
  return inv;
end;
$$;

create or replace function private.top_pick_length(p_length_id bigint)
returns public.top_pick_lengths
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  len public.top_pick_lengths;
begin
  select * into len from public.top_pick_lengths where id = p_length_id and is_active;
  if len.id is null then
    raise exception 'That length is not available' using errcode = 'P0002';
  end if;
  return len;
end;
$$;

create or replace function private.top_picks_open()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select enabled from public.top_pick_settings where id = 1), false) then
    raise exception 'Top Picks is not open yet' using errcode = 'P0001';
  end if;
end;
$$;

-- Start a sponsorship: makes the invoice to pay. Returns the invoice id.
create or replace function public.buy_top_pick(p_offer_id bigint, p_district_id bigint, p_length_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  v public.vendors;
  len public.top_pick_lengths;
  br bigint;
  old public.top_picks;
  old_inv public.invoices;
  pick bigint;
  waiting boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  perform private.top_picks_open();
  br := private.sponsor_branch(p_offer_id);
  if br is null then
    raise exception 'You can''t make this offer a Top Pick' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.offers where id = p_offer_id;
  select v2.* into v from public.vendors v2 join public.shops sh on sh.vendor_id = v2.id where sh.id = o.shop_id;
  if v.status <> 'approved' then
    raise exception 'Your business must be approved first' using errcode = 'P0001';
  end if;
  len := private.top_pick_length(p_length_id);
  if not exists (select 1 from public.locations where id = p_district_id and kind = 'district' and is_active)
     or not exists (select 1 from private.offer_branches_in(o.id, p_district_id) b
                    where br = 0 or b = br) then
    raise exception 'This offer has no branch in that district' using errcode = '22023';
  end if;
  waiting := (select count(*) from public.top_picks where district_id = p_district_id and status = 'live')
               >= private.top_pick_places()
             or exists (select 1 from public.top_picks where district_id = p_district_id and status = 'waiting');
  perform private.top_pick_check_offer(o, private.today_ist() + len.days - 1);

  -- A Top Pick already running for this offer here is renewed instead; an unpaid one is replaced.
  select * into old from public.top_picks
    where offer_id = o.id and district_id = p_district_id and status in ('awaiting_payment', 'waiting', 'live')
    for update;
  if old.status in ('waiting', 'live') then
    raise exception 'This offer is already a Top Pick here. Use Renew to add days.' using errcode = 'P0001';
  elsif old.id is not null then
    select i.* into old_inv from public.invoices i join public.invoice_items it on it.invoice_id = i.id
      where it.top_pick_id = old.id and i.status in ('unpaid', 'submitted') limit 1;
    if old_inv.status = 'submitted' then
      raise exception 'A payment for this Top Pick is already being checked' using errcode = 'P0001';
    end if;
    update public.invoices set status = 'void', void_reason = 'Replaced by a new Top Picks choice'
      where id = old_inv.id;
    update public.top_picks set status = 'cancelled', ended_at = now() where id = old.id;
  end if;

  insert into public.top_picks (vendor_id, shop_id, offer_id, district_id, branch_id, bought_by)
  values (v.id, o.shop_id, o.id, p_district_id, nullif(br, 0), (select auth.uid()))
  returning id into pick;
  return private.top_pick_invoice(v, pick, len,
    'Top Picks: ' || o.title || ' in ' || (select name from public.locations where id = p_district_id)
      || ' (' || private.top_pick_days_text(len.days) || case when waiting then ', waiting list' else '' end || ')');
end;
$$;

-- Add days to a running (or waiting) sponsorship, keeping its place. Returns the invoice id.
create or replace function public.renew_top_pick(p_id bigint, p_length_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.top_picks;
  o public.offers;
  v public.vendors;
  len public.top_pick_lengths;
  open_inv bigint;
  last_day date;
begin
  perform private.top_picks_open();
  select * into t from public.top_picks where id = p_id;
  if t.id is null or private.sponsor_branch(t.offer_id) is null
     or (private.sponsor_branch(t.offer_id) <> 0 and t.branch_id is distinct from private.my_branch_id()) then
    raise exception 'Top Pick not found' using errcode = 'P0002';
  end if;
  if t.status not in ('waiting', 'live') then
    raise exception 'This Top Pick has ended. Start a new one.' using errcode = 'P0001';
  end if;
  select i.id into open_inv from public.invoices i join public.invoice_items it on it.invoice_id = i.id
    where it.top_pick_id = t.id and i.status in ('unpaid', 'submitted') limit 1;
  if open_inv is not null then
    raise exception 'There is already a renewal invoice for this Top Pick. Pay or cancel it first.'
      using errcode = 'P0001';
  end if;
  len := private.top_pick_length(p_length_id);
  select * into o from public.offers where id = t.offer_id;
  last_day := case when t.status = 'live' then greatest(t.ends_on, private.today_ist() - 1)
                   else private.today_ist() + t.waiting_days - 1 end + len.days;
  perform private.top_pick_check_offer(o, last_day);
  select * into v from public.vendors where id = t.vendor_id;
  return private.top_pick_invoice(v, t.id, len,
    'Top Picks renewal: ' || o.title || ' in ' || (select name from public.locations where id = t.district_id)
      || ' (' || private.top_pick_days_text(len.days) || ')');
end;
$$;

-- Show another approved offer of the same shop in the same place.
create or replace function public.swap_top_pick_offer(p_id bigint, p_offer_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.top_picks;
  o public.offers;
  br bigint;
begin
  select * into t from public.top_picks where id = p_id for update;
  br := private.sponsor_branch(p_offer_id);
  if t.id is null or br is null or private.sponsor_branch(t.offer_id) is null
     or (br <> 0 and t.branch_id is distinct from br) then
    raise exception 'Top Pick not found' using errcode = 'P0002';
  end if;
  if t.status not in ('awaiting_payment', 'waiting', 'live') then
    raise exception 'This Top Pick has ended' using errcode = 'P0001';
  end if;
  select * into o from public.offers where id = p_offer_id;
  if o.shop_id <> t.shop_id then
    raise exception 'Choose an offer from the same shop' using errcode = '22023';
  end if;
  perform private.top_pick_check_offer(o, coalesce(t.ends_on, private.today_ist()));
  if not exists (select 1 from private.offer_branches_in(o.id, t.district_id) b where br = 0 or b = br) then
    raise exception 'That offer has no branch in this district' using errcode = '22023';
  end if;
  if exists (select 1 from public.top_picks where offer_id = o.id and district_id = t.district_id and id <> t.id
             and status in ('awaiting_payment', 'waiting', 'live')) then
    raise exception 'That offer is already a Top Pick here' using errcode = 'P0001';
  end if;
  update public.top_picks set offer_id = o.id where id = t.id;
end;
$$;

-- Everything the vendor's Top Picks page needs.
create or replace function public.my_top_picks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.vendors;
  my_branch bigint := private.my_branch_id();
  owner boolean;
  today date := private.today_ist();
begin
  select * into v from public.vendors where id = private.my_member_vendor_id();
  if v.id is null then
    raise exception 'Not a vendor' using errcode = 'insufficient_privilege';
  end if;
  owner := v.owner_id = (select auth.uid());
  if not owner and (my_branch is null) then
    raise exception 'Only the owner or a branch manager can use Top Picks' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'enabled', coalesce((select enabled from public.top_pick_settings where id = 1), false),
    'places', private.top_pick_places(),
    'is_owner', owner,
    'managers_can_sponsor', v.managers_can_sponsor,
    'allowed', owner or v.managers_can_sponsor,
    'lengths', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'days', days, 'price', price) order by days)
                         from public.top_pick_lengths where is_active), '[]'::jsonb),
    -- Approved offers this person can sponsor, with the districts they can pick.
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'discount_label', o.discount_label, 'image_key', o.image_keys[1],
        'ends_on', o.ends_on, 'shop_id', o.shop_id, 'is_paused', o.is_paused,
        'districts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', d.id, 'name', d.name,
            'live', (select count(*) from public.top_picks t where t.district_id = d.id and t.status = 'live'),
            'waiting', (select count(*) from public.top_picks t where t.district_id = d.id and t.status = 'waiting'),
            -- The day the next place opens if nobody renews (the earliest end among live ones).
            'next_free_on', (select min(t.ends_on) + 1 from public.top_picks t
                             where t.district_id = d.id and t.status = 'live'),
            'taken', exists (select 1 from public.top_picks t where t.offer_id = o.id and t.district_id = d.id
                             and t.status in ('waiting', 'live')))
            order by d.name)
          from public.locations d
          where d.kind = 'district' and d.is_active and d.id in (
            select private.district_of(br.location_id) from public.branches br
            where br.id in (select private.offer_branches_in(o.id, null))
              and (owner or br.id = my_branch))), '[]'::jsonb))
        order by o.created_at desc)
      from public.offers o join public.shops sh on sh.id = o.shop_id
      where sh.vendor_id = v.id and o.status = 'approved' and (o.ends_on is null or o.ends_on >= today)
        and (owner or private.offer_at_branch(o.all_branches, o.id, my_branch))), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'status', t.status, 'offer_id', t.offer_id, 'offer_title', o.title,
        'offer_image_key', o.image_keys[1], 'offer_live', exists (select 1 from public.live_offers lo where lo.id = o.id),
        'offer_ends_on', o.ends_on, 'shop_id', t.shop_id,
        'district_id', t.district_id, 'district_name', d.name, 'branch_name', b.name,
        'starts_on', t.starts_on, 'ends_on', t.ends_on, 'waiting_days', t.waiting_days,
        'removed_reason', t.removed_reason, 'ended_at', t.ended_at,
        'position', case when t.status = 'live' then (
          select count(*) from public.top_picks x where x.district_id = t.district_id and x.status = 'live'
            and (x.live_since, x.id) <= (t.live_since, t.id)) end,
        'waiting_position', case when t.status = 'waiting' then (
          select count(*) from public.top_picks x where x.district_id = t.district_id and x.status = 'waiting'
            and (x.queued_at, x.id) <= (t.queued_at, t.id)) end,
        'views', coalesce((select sum(s.views) from public.top_pick_stats_daily s where s.top_pick_id = t.id), 0),
        'taps', coalesce((select sum(s.taps) from public.top_pick_stats_daily s where s.top_pick_id = t.id), 0),
        'open_invoice', (select jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'total', i.total)
                         from public.invoices i join public.invoice_items it on it.invoice_id = i.id
                         where it.top_pick_id = t.id and i.status in ('unpaid', 'submitted')
                         order by i.id desc limit 1))
        order by case t.status when 'live' then 0 when 'waiting' then 1 when 'awaiting_payment' then 2 else 3 end,
                 t.ends_on desc nulls last, t.id desc)
      from public.top_picks t
      join public.offers o on o.id = t.offer_id
      join public.locations d on d.id = t.district_id
      left join public.branches b on b.id = t.branch_id
      where t.vendor_id = v.id and (owner or t.branch_id = my_branch)
        and (t.status in ('awaiting_payment', 'waiting', 'live')
             or (t.status in ('ended', 'removed') and t.ended_at > now() - interval '60 days'))), '[]'::jsonb));
end;
$$;

create or replace function public.set_managers_can_sponsor(p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.vendors set managers_can_sponsor = coalesce(p_allowed, true)
    where owner_id = (select auth.uid());
  if not found then
    raise exception 'Only the business owner can change this' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Customer side --------------------------------------------------------------------------------------------

-- The Top Picks row for an area's district (the customer's saved area when none is given), first come first.
create or replace function public.top_picks_for(p_area_id bigint default null)
returns table (top_pick_id bigint, offer_id bigint, title text, discount_label text, image_key text,
               shop_id bigint, shop_name text, shop_slug text, branch_slug text, branch_name text,
               category_slug text, category_icon text, district_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select private.district_of(coalesce(p_area_id,
      (select location_id from public.profiles where id = (select auth.uid())))) as id
  )
  select t.id, lo.id, lo.title, lo.discount_label, lo.image_keys[1], s.id, s.name, s.slug, b.slug, b.name,
         coalesce(oc.slug, sc.slug), coalesce(oc.icon, sc.icon), dl.name
  from d
  join public.top_picks t on t.district_id = d.id and t.status = 'live'
  join public.live_offers lo on lo.id = t.offer_id
  join public.shops s on s.id = lo.shop_id
  join public.locations dl on dl.id = d.id
  left join public.categories oc on oc.id = lo.category_id
  left join public.categories sc on sc.id = s.category_id
  -- the offer's first live branch in this district
  join lateral (
    select br.slug, br.name from public.branches br
    where br.id in (select private.offer_branches_in(lo.id, d.id)) order by br.id limit 1
  ) b on true
  where coalesce((select enabled from public.top_pick_settings where id = 1), false)
    and (select auth.uid()) is not null
  order by t.live_since, t.id
  limit private.top_pick_places();
$$;

-- Counts views (the row was shown) and taps for the vendor's numbers.
create or replace function public.track_top_picks(p_event text, p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event not in ('view', 'tap') then
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or coalesce(cardinality(p_ids), 0) = 0 then
    return;
  end if;
  insert into public.top_pick_stats_daily as s (day, top_pick_id, views, taps)
  select private.today_ist(), t.id, (p_event = 'view')::int, (p_event = 'tap')::int
  from public.top_picks t
  where t.id = any (p_ids[1:20]) and t.status = 'live'
  on conflict (top_pick_id, day) do update
    set views = s.views + excluded.views, taps = s.taps + excluded.taps;
end;
$$;

-- Daily job: end, fill, remind -----------------------------------------------------------------------------

create or replace function public.top_picks_daily()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  t record;
  d bigint;
begin
  -- Ended without a renewal. A UPI renewal sent before the end and still being checked keeps the place.
  for t in
    select x.* from public.top_picks x
    where x.status = 'live' and x.ends_on < today
      and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id
                      where it.top_pick_id = x.id and i.status = 'submitted'
                        and (i.submitted_at at time zone 'Asia/Kolkata')::date <= x.ends_on)
    for update
  loop
    update public.top_picks set status = 'ended', ended_at = now() where id = t.id;
    perform private.top_pick_notify(t.id, 'Your Top Pick has ended',
      'It was not renewed in time, so its place went to the next shop. You can start a new one any time.');
  end loop;

  for d in select distinct district_id from public.top_picks where status = 'waiting' loop
    perform private.fill_top_picks(d);
  end loop;

  for t in
    select x.* from public.top_picks x
    where x.status = 'live' and ((x.ends_on - today = 2 and not x.reminded_2) or (x.ends_on = today and not x.reminded_0))
      and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id
                      where it.top_pick_id = x.id and i.status = 'submitted')
  loop
    perform private.top_pick_notify(t.id,
      case when t.ends_on = today then 'Your Top Pick ends today' else 'Your Top Pick ends in 2 days' end,
      'Renew before the end to keep your place in the row. If it lapses, the place goes to the next shop.');
    update public.top_picks
      set reminded_2 = reminded_2 or t.ends_on - today = 2, reminded_0 = reminded_0 or t.ends_on = today
      where id = t.id;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'top-picks-daily') then
    perform cron.unschedule('top-picks-daily');
  end if;
  -- 00:05 India time, after the day changes.
  perform cron.schedule('top-picks-daily', '35 18 * * *', 'select public.top_picks_daily()');
end $$;

-- Admin side -----------------------------------------------------------------------------------------------

create or replace function public.admin_top_picks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'status', t.status, 'district_id', t.district_id, 'district_name', d.name,
      'vendor_id', t.vendor_id, 'business_name', v.business_name, 'shop_name', s.name, 'branch_name', b.name,
      'offer_id', t.offer_id, 'offer_title', o.title,
      'offer_live', exists (select 1 from public.live_offers lo where lo.id = o.id),
      'live_since', t.live_since, 'queued_at', t.queued_at, 'starts_on', t.starts_on, 'ends_on', t.ends_on,
      'waiting_days', t.waiting_days, 'removed_reason', t.removed_reason, 'ended_at', t.ended_at,
      'views', coalesce((select sum(x.views) from public.top_pick_stats_daily x where x.top_pick_id = t.id), 0),
      'taps', coalesce((select sum(x.taps) from public.top_pick_stats_daily x where x.top_pick_id = t.id), 0),
      'open_invoice', (select jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status)
                       from public.invoices i join public.invoice_items it on it.invoice_id = i.id
                       where it.top_pick_id = t.id and i.status in ('unpaid', 'submitted')
                       order by i.id desc limit 1))
      order by d.name, case t.status when 'live' then 0 when 'waiting' then 1 when 'awaiting_payment' then 2 else 3 end,
               coalesce(t.live_since, t.queued_at, t.created_at), t.id)
    from public.top_picks t
    join public.locations d on d.id = t.district_id
    join public.vendors v on v.id = t.vendor_id
    join public.shops s on s.id = t.shop_id
    join public.offers o on o.id = t.offer_id
    left join public.branches b on b.id = t.branch_id
    where t.status in ('awaiting_payment', 'waiting', 'live')
       or (t.status in ('ended', 'removed') and t.ended_at > now() - interval '30 days')), '[]'::jsonb);
end;
$$;

create or replace function public.admin_remove_top_pick(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.top_picks;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if reason is null then
    raise exception 'Give a reason; the vendor will see it' using errcode = '22023';
  end if;
  update public.top_picks
    set status = 'removed', removed_reason = left(reason, 300), removed_by = (select auth.uid()), ended_at = now()
    where id = p_id and status in ('waiting', 'live')
    returning * into t;
  if t.id is null then
    raise exception 'Only running or waiting Top Picks can be removed' using errcode = 'P0002';
  end if;
  perform private.top_pick_notify(t.id, 'Your Top Pick was removed', 'Reason: ' || left(reason, 200));
  perform private.fill_top_picks(t.district_id);
end;
$$;

-- A free sponsorship (launch partner, or days given back after a removal). Adds days if already running.
create or replace function public.admin_give_top_pick(p_offer_id bigint, p_district_id bigint, p_days int,
                                                      p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  v public.vendors;
  t public.top_picks;
  inv bigint;
  s public.billing_settings;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Days must be between 1 and 366' using errcode = '22023';
  end if;
  select * into o from public.offers where id = p_offer_id;
  if o.id is null or o.status <> 'approved' then
    raise exception 'Only approved offers can be Top Picks' using errcode = '22023';
  end if;
  if not exists (select 1 from private.offer_branches_in(o.id, p_district_id)) then
    raise exception 'This offer has no branch in that district' using errcode = '22023';
  end if;
  select v2.* into v from public.vendors v2 join public.shops sh on sh.vendor_id = v2.id where sh.id = o.shop_id;
  select * into t from public.top_picks
    where offer_id = o.id and district_id = p_district_id and status in ('awaiting_payment', 'waiting', 'live');
  if t.id is null then
    insert into public.top_picks (vendor_id, shop_id, offer_id, district_id, bought_by)
    values (v.id, o.shop_id, o.id, p_district_id, (select auth.uid()))
    returning * into t;
  end if;
  select * into s from public.billing_settings where id = 1;
  insert into public.invoices (number, vendor_id, gst_percent, bill_to, bill_from, created_by, admin_note)
  values (s.invoice_prefix || '-' || to_char(private.today_ist(), 'YYYY') || '-'
            || lpad(nextval('public.invoice_number_seq')::text, 5, '0'),
          v.id, s.gst_percent,
          jsonb_build_object('business_name', v.business_name, 'phone', v.contact_phone, 'vendor_id', v.id),
          jsonb_build_object('name', s.business_name, 'address', s.business_address, 'gstin', s.gstin,
                             'upi_id', s.upi_id, 'payee_name', s.payee_name, 'note', s.payment_note),
          (select auth.uid()), left(nullif(trim(coalesce(p_note, '')), ''), 500))
  returning id into inv;
  insert into public.invoice_items (invoice_id, top_pick_id, shop_id, offer_id, description, days, amount)
  values (inv, t.id, o.shop_id, o.id,
          left('Top Picks (free): ' || o.title || ' in ' || (select name from public.locations where id = p_district_id)
               || ' (' || private.top_pick_days_text(p_days) || ')', 200),
          p_days, 0);
  perform private.activate_invoice(inv, 'free', null, null);
  return t.id;
end;
$$;

-- Grants ---------------------------------------------------------------------------------------------------

revoke execute on function
  private.can_pay_invoice(public.invoices, uuid),
  private.district_of(bigint),
  private.offer_branches_in(bigint, bigint),
  private.sponsor_branch(bigint),
  private.top_pick_places(),
  private.fill_top_picks(bigint),
  private.top_pick_days_text(int),
  private.top_pick_notify(bigint, text, text),
  private.top_pick_paid(bigint, int),
  private.top_pick_check_offer(public.offers, date),
  private.top_pick_invoice(public.vendors, bigint, public.top_pick_lengths, text),
  private.top_pick_length(bigint),
  private.top_picks_open(),
  public.cancel_unpaid_top_picks(),
  public.top_picks_daily(),
  public.buy_top_pick(bigint, bigint, bigint),
  public.renew_top_pick(bigint, bigint),
  public.swap_top_pick_offer(bigint, bigint),
  public.my_top_picks(),
  public.set_managers_can_sponsor(boolean),
  public.top_picks_for(bigint),
  public.track_top_picks(text, bigint[]),
  public.admin_top_picks(),
  public.admin_remove_top_pick(bigint, text),
  public.admin_give_top_pick(bigint, bigint, int, text)
from public, anon, authenticated;

grant execute on function
  public.buy_top_pick(bigint, bigint, bigint),
  public.renew_top_pick(bigint, bigint),
  public.swap_top_pick_offer(bigint, bigint),
  public.my_top_picks(),
  public.set_managers_can_sponsor(boolean),
  public.top_picks_for(bigint),
  public.track_top_picks(text, bigint[]),
  public.admin_top_picks(),
  public.admin_remove_top_pick(bigint, text),
  public.admin_give_top_pick(bigint, bigint, int, text)
to authenticated;
