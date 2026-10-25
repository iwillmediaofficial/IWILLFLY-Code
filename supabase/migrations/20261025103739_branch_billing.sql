-- Branch billing: one renewal date per business, and a part-month charge for a branch added later.
--   * At sign-up the plan invoice already charges every extra branch for the full period (create_invoice).
--   * A branch a vendor adds later, over what the plan includes, is charged at once for the days left
--     until the plan renews: extra_branch_price x days left / period_days. Branches added on the same day
--     share one invoice. With 3 days or fewer left there is no part-month invoice: the branch waits for
--     the renewal invoice, which charges every extra branch at full price anyway.
--   * Such a branch is shown to customers only once its invoice is paid (and an admin approved it).
--   * Admins adding branches, free plans, plans without an extra-branch price and businesses without a
--     running plan are not charged here.
--   * Deleting a branch takes it off an invoice that is still unpaid; paid charges are not refunded.

-- What a branch is waiting for ---------------------------------------------------------------------------

alter table public.branches
  add column if not exists awaiting_payment boolean not null default false,
  -- the part-month invoice; null while waiting for the renewal invoice
  add column if not exists payment_invoice_id bigint references public.invoices (id) on delete set null;
create index if not exists branches_payment_invoice_idx on public.branches (payment_invoice_id);

-- Invoice lines for a branch's part-month charge.
alter table public.invoice_items
  add column if not exists branch_charge boolean not null default false,
  add column if not exists branch_id bigint references public.branches (id) on delete set null;
create index if not exists invoice_items_branch_idx on public.invoice_items (branch_id);
alter table public.invoice_items drop constraint if exists invoice_items_check;
alter table public.invoice_items add constraint invoice_items_check
  check (num_nonnulls(plan_id, addon_id) + branch_charge::int = 1);

-- Vendors cannot change payment state; admins can (e.g. to let a branch go live without payment).
create or replace function public.guard_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  admin boolean := private.is_app_admin_or_service();
  area text := (select l.name from public.locations l where l.id = new.location_id);
begin
  if tg_op = 'INSERT' then
    if new.slug is null or not admin then
      new.slug := private.unique_branch_slug(new.shop_id, private.branch_slug_base(new.name, area), null);
    end if;
    if not admin then
      -- Branches sent with an application are reviewed with the business; later ones wait for an admin.
      new.review_status := case when exists (
        select 1 from public.shops s join public.vendors v on v.id = s.vendor_id
        where s.id = new.shop_id and v.status = 'approved') then 'pending' else 'approved' end;
      new.review_note := null;
      new.reviewed_at := null;
      -- set by the billing trigger after the insert
      new.awaiting_payment := false;
      new.payment_invoice_id := null;
    end if;
    return new;
  end if;
  if admin then
    if new.slug is distinct from old.slug then
      new.slug := private.unique_branch_slug(new.shop_id, coalesce(nullif(new.slug, ''), old.slug), new.id);
    end if;
    if new.review_status is distinct from old.review_status then
      new.reviewed_at := case when new.review_status = 'pending' then null else now() end;
    end if;
    return new;
  end if;
  new.shop_id := old.shop_id;
  new.slug := old.slug;
  new.review_status := old.review_status;
  new.review_note := old.review_note;
  new.reviewed_at := old.reviewed_at;
  new.awaiting_payment := old.awaiting_payment;
  new.payment_invoice_id := old.payment_invoice_id;
  -- A refused branch that is corrected goes back to the admin.
  if old.review_status = 'rejected' then
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

-- What adding a branch costs ------------------------------------------------------------------------------

-- The part-month charge for one more branch of business v today, or null when it is free.
-- {"amount", "days_left", "renews_on", "price", "period_days", "plan", "deferred"}; deferred = 3 days or
-- fewer left, so it waits for the renewal invoice instead.
create or replace function private.branch_charge(v bigint, existing int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.plans := private.vendor_plan(v);
  today date := private.today_ist();
  sub public.subscriptions;
  days_left int;
begin
  if (select status from public.vendors where id = v) is distinct from 'approved'
     or p.id is null or p.price = 0 or coalesce(p.extra_branch_price, 0) = 0 or p.included_branches is null
     or existing < p.included_branches then
    return null;
  end if;
  select * into sub from public.subscriptions s
    where s.vendor_id = v and s.plan_id = p.id and s.cancelled_at is null and today between s.starts_on and s.ends_on
    order by s.ends_on desc limit 1;
  if sub.id is null then
    return null;
  end if;
  days_left := least(sub.ends_on - today + 1, p.period_days);
  return jsonb_build_object(
    'amount', round(p.extra_branch_price * days_left / p.period_days, 2),
    'days_left', days_left,
    'renews_on', sub.ends_on + 1,
    'price', p.extra_branch_price,
    'period_days', p.period_days,
    'plan', p.name,
    'deferred', days_left <= 3);
end;
$$;
revoke execute on function private.branch_charge(bigint, int) from public, anon, authenticated;

-- Shown before the owner adds a branch: what it will cost (null = free).
create or replace function public.branch_price_quote()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.branch_charge(private.my_vendor_id(), private.branch_count(private.my_vendor_id()));
$$;
revoke execute on function public.branch_price_quote() from public, anon;
grant execute on function public.branch_price_quote() to authenticated;

-- Today's open part-month invoice of business v, or a new one.
create or replace function private.branch_invoice_for(v bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv bigint;
  ven public.vendors;
  s public.billing_settings;
begin
  select i.id into inv from public.invoices i
  where i.vendor_id = v and i.status = 'unpaid' and i.issued_on = private.today_ist()
    and exists (select 1 from public.invoice_items it where it.invoice_id = i.id and it.branch_charge)
    and not exists (select 1 from public.invoice_items it where it.invoice_id = i.id and not it.branch_charge)
  order by i.id desc limit 1;
  if inv is not null then
    return inv;
  end if;
  select * into ven from public.vendors where id = v;
  select * into s from public.billing_settings where id = 1;
  insert into public.invoices (number, vendor_id, gst_percent, bill_to, bill_from, created_by)
  values (s.invoice_prefix || '-' || to_char(private.today_ist(), 'YYYY') || '-'
            || lpad(nextval('public.invoice_number_seq')::text, 5, '0'),
          v, s.gst_percent,
          jsonb_build_object('business_name', ven.business_name, 'phone', ven.contact_phone, 'vendor_id', v),
          jsonb_build_object('name', s.business_name, 'address', s.business_address, 'gstin', s.gstin,
                             'upi_id', s.upi_id, 'payee_name', s.payee_name, 'note', s.payment_note),
          (select auth.uid()))
  returning id into inv;
  return inv;
end;
$$;

create or replace function private.invoice_totals(inv bigint)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.invoices i
    set subtotal = x.sub, tax = round(x.sub * i.gst_percent / 100, 2),
        total = x.sub + round(x.sub * i.gst_percent / 100, 2)
  from (select coalesce(sum(amount), 0) as sub from public.invoice_items where invoice_id = inv) x
  where i.id = inv;
$$;

-- Charges branch b of business v (counting `existing` other branches), and marks it waiting.
create or replace function private.charge_branch(v bigint, b public.branches, existing int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  q jsonb := private.branch_charge(v, existing);
  inv bigint;
begin
  if q is null then
    update public.branches set awaiting_payment = false, payment_invoice_id = null where id = b.id;
    return;
  end if;
  if (q->>'deferred')::boolean then
    update public.branches set awaiting_payment = true, payment_invoice_id = null where id = b.id;
    return;
  end if;
  inv := private.branch_invoice_for(v);
  insert into public.invoice_items (invoice_id, branch_charge, branch_id, description, days, amount)
  values (inv, true, b.id,
          left('Extra branch: ' || b.name || ' (' || (q->>'days_left') || ' days, until '
               || to_char((q->>'renews_on')::date - 1, 'DD Mon YYYY') || ')', 200),
          (q->>'days_left')::int, (q->>'amount')::numeric);
  perform private.invoice_totals(inv);
  update public.branches set awaiting_payment = true, payment_invoice_id = inv where id = b.id;
end;
$$;
revoke execute on function private.branch_invoice_for(bigint), private.invoice_totals(bigint),
  private.charge_branch(bigint, public.branches, int) from public, anon, authenticated;

-- A branch a vendor adds is charged right away (admins and the sign-up application are not).
create or replace function public.bill_new_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint := (select vendor_id from public.shops where id = new.shop_id);
begin
  -- Only a signed-in vendor's own addition; not admins, the service role or database jobs.
  if (select auth.uid()) is null or (select private.is_admin()) then
    return null;
  end if;
  perform private.charge_branch(v, new, private.branch_count(v) - 1);
  return null;
end;
$$;
drop trigger if exists branches_bill_new on public.branches;
create trigger branches_bill_new after insert on public.branches
  for each row execute function public.bill_new_branch();
revoke execute on function public.bill_new_branch() from public, anon, authenticated;

-- A deleted branch comes off invoices that are still unpaid; an invoice left empty is cancelled.
create or replace function public.unbill_deleted_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv bigint;
begin
  for inv in
    select distinct it.invoice_id from public.invoice_items it join public.invoices i on i.id = it.invoice_id
    where it.branch_id = old.id and it.branch_charge and i.status = 'unpaid'
  loop
    delete from public.invoice_items where invoice_id = inv and branch_id = old.id and branch_charge;
    if exists (select 1 from public.invoice_items where invoice_id = inv) then
      perform private.invoice_totals(inv);
    else
      update public.invoices set status = 'void', subtotal = 0, tax = 0, total = 0,
        void_reason = 'The branch was deleted before payment' where id = inv;
    end if;
  end loop;
  return old;
end;
$$;
drop trigger if exists branches_unbill_deleted on public.branches;
create trigger branches_unbill_deleted before delete on public.branches
  for each row execute function public.unbill_deleted_branch();
revoke execute on function public.unbill_deleted_branch() from public, anon, authenticated;

-- Owner: a new invoice for branches whose part-month invoice was cancelled.
create or replace function public.bill_waiting_branches()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v bigint := (select id from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked');
  b public.branches;
  n int;
begin
  if v is null then
    raise exception 'Only the business owner can pay for branches' using errcode = 'insufficient_privilege';
  end if;
  n := private.branch_count(v);
  for b in
    select br.* from public.branches br join public.shops s on s.id = br.shop_id
    left join public.invoices i on i.id = br.payment_invoice_id
    where s.vendor_id = v and br.awaiting_payment and br.payment_invoice_id is not null and i.status = 'void'
    order by br.id
  loop
    -- Counted as the last one in: charged unless the plan now includes it.
    perform private.charge_branch(v, b, n - 1);
  end loop;
  return (select payment_invoice_id from public.branches br join public.shops s on s.id = br.shop_id
          where s.vendor_id = v and br.awaiting_payment and br.payment_invoice_id is not null
          order by br.payment_invoice_id desc limit 1);
end;
$$;
revoke execute on function public.bill_waiting_branches() from public, anon;
grant execute on function public.bill_waiting_branches() to authenticated;

-- Paying ------------------------------------------------------------------------------------------------

-- Same as before, plus: a paid part-month charge puts its branch live, and a paid plan invoice (the
-- renewal, which charges every extra branch) puts live the branches that were waiting for it.
create or replace function private.activate_invoice(p_invoice_id bigint, p_method text, p_ref text,
                                                    p_paid_on date)
returns void
language plpgsql
volatile
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
end;
$$;
revoke execute on function private.activate_invoice(bigint, text, text, date) from public, anon, authenticated;

-- Customers ---------------------------------------------------------------------------------------------

-- Customers see approved, paid branches of live shops; the team sees all of theirs.
drop policy if exists "branches: public read live" on public.branches;
create policy "branches: public read live" on public.branches
  for select to authenticated
  using ((review_status = 'approved' and not awaiting_payment and private.shop_is_live(shop_id))
         or private.can_see_own_shop(shop_id) or (select private.is_admin()));

-- Live offers only for branches customers can see.
create or replace view public.live_offers
with (security_invoker = true) as
  select o.id, o.shop_id, o.category_id, o.title, o.product_name, o.description, o.original_price,
         o.offer_price, o.discount_label, o.image_keys, o.starts_on, o.ends_on, o.status, o.is_paused,
         o.is_featured, o.reject_reason, o.reviewed_by, o.reviewed_at, o.created_at, o.updated_at,
         o.all_branches
  from public.offers o
  where o.status = 'approved' and not o.is_paused and o.starts_on <= private.today_ist()
    and (o.ends_on is null or o.ends_on >= private.today_ist())
    and private.shop_is_live(o.shop_id)
    and (o.all_branches
         or exists (select 1 from public.offer_branches ob join public.branches b on b.id = ob.branch_id
                    where ob.offer_id = o.id and b.review_status = 'approved' and not b.awaiting_payment));

-- Approval of a branch that is not paid yet tells the owner to pay.
create or replace function public.alert_branch_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shop_name text := (select name from public.shops where id = new.shop_id);
  owner uuid := (select v.owner_id from public.shops s join public.vendors v on v.id = s.vendor_id
                 where s.id = new.shop_id);
  a uuid;
begin
  if new.review_status = 'pending' and (tg_op = 'INSERT' or old.review_status is distinct from 'pending') then
    for a in select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin') loop
      perform private.notify(a, 'vendor_review', 'New branch to check: ' || shop_name,
        new.name || coalesce(' · ' || new.address, ''), '/admin/branches');
    end loop;
  elsif tg_op = 'UPDATE' and new.review_status is distinct from old.review_status
        and new.review_status in ('approved', 'rejected') then
    perform private.notify(owner, 'vendor_review',
      case when new.review_status = 'approved' then 'Branch approved: ' || new.name
           else 'Branch not approved: ' || new.name end,
      case when new.review_status = 'rejected'
             then coalesce(new.review_note, 'Check the branch details and save it again.')
           when new.awaiting_payment
             then 'Pay the branch invoice and ' || new.name || ' goes live on IWILLFLY.'
           else shop_name || ' · ' || new.name || ' is now live on IWILLFLY.' end,
      '/vendor/branches/' || new.id);
  end if;
  return null;
end;
$$;

-- Admin: branches to check, and branches waiting for payment ---------------------------------------------

drop function if exists public.admin_pending_branches();
create or replace function public.admin_pending_branches()
returns table (branch_id bigint, branch_name text, address text, area text, lat double precision, lng double precision,
               phone text, created_at timestamptz, review_status text, review_note text, shop_id bigint,
               shop_name text, shop_slug text, vendor_id bigint, business_name text, branch_count int,
               awaiting_payment boolean, invoice_id bigint, invoice_number text, invoice_status text,
               invoice_total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select b.id, b.name, b.address, l.name, b.lat, b.lng, b.phone, b.created_at, b.review_status, b.review_note,
         s.id, s.name, s.slug, v.id, v.business_name,
         (select count(*)::int from public.branches x where x.shop_id = s.id and x.review_status = 'approved'),
         b.awaiting_payment, i.id, i.number, i.status::text, i.total
  from public.branches b
  join public.shops s on s.id = b.shop_id
  join public.vendors v on v.id = s.vendor_id
  left join public.locations l on l.id = b.location_id
  left join public.invoices i on i.id = b.payment_invoice_id
  where b.review_status = 'pending' or (b.awaiting_payment and b.review_status <> 'rejected')
  order by b.created_at;
end;
$$;
revoke execute on function public.admin_pending_branches() from public, anon;
grant execute on function public.admin_pending_branches() to authenticated;
