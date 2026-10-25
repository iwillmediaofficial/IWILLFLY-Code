-- Branch billing fixes:
--   * No running plan, no free branch: on a paid plan with an extra-branch price, a branch added while
--     the plan is not running waits for the plan invoice (renewal), like one added in the last 3 days.
--   * A branch added after the renewal invoice was made is added to that unpaid invoice for the next period.
--   * Once a part-month charge's period is over and the renewal is running, the old unpaid charge is
--     dropped and the branch goes live (the renewal paid for it).
--   * A refused branch comes off unpaid invoices; if its charge was already paid, admins are told a
--     refund may be due.
--   * Scratch & Win: a prize only for branches customers can't see yet can't be won, and winners are
--     only sent to live branches.
--   * The owner is told when a branch goes live after payment.
--   * Deleting a branch switches off prizes that were only for it.

-- What one more branch costs ----------------------------------------------------------------------------

-- Same as before, plus: on a paid plan that is not running, the branch waits for the plan invoice
-- ("no_plan": true, "deferred": true).
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
    return jsonb_build_object('amount', 0, 'days_left', 0, 'renews_on', null, 'price', p.extra_branch_price,
                              'period_days', p.period_days, 'plan', p.name, 'deferred', true, 'no_plan', true);
  end if;
  days_left := least(sub.ends_on - today + 1, p.period_days);
  return jsonb_build_object(
    'amount', round(p.extra_branch_price * days_left / p.period_days, 2),
    'days_left', days_left,
    'renews_on', sub.ends_on + 1,
    'price', p.extra_branch_price,
    'period_days', p.period_days,
    'plan', p.name,
    'deferred', days_left <= 3,
    'no_plan', false);
end;
$$;
revoke execute on function private.branch_charge(bigint, int) from public, anon, authenticated;

-- Charges branch b now (or marks it waiting for the plan invoice), and adds it to plan invoices that
-- are already made but not paid, for the next period.
create or replace function private.charge_branch(v bigint, b public.branches, existing int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  q jsonb := private.branch_charge(v, existing);
  p public.plans := private.vendor_plan(v);
  inv bigint;
begin
  if q is null then
    update public.branches set awaiting_payment = false, payment_invoice_id = null where id = b.id;
    return;
  end if;
  if (q->>'deferred')::boolean then
    update public.branches set awaiting_payment = true, payment_invoice_id = null where id = b.id;
  else
    inv := private.branch_invoice_for(v);
    insert into public.invoice_items (invoice_id, branch_charge, branch_id, description, days, amount)
    values (inv, true, b.id,
            left('Extra branch: ' || b.name || ' (' || (q->>'days_left') || ' days, until '
                 || to_char((q->>'renews_on')::date - 1, 'DD Mon YYYY') || ')', 200),
            (q->>'days_left')::int, (q->>'amount')::numeric);
    perform private.invoice_totals(inv);
    update public.branches set awaiting_payment = true, payment_invoice_id = inv where id = b.id;
  end if;
  -- A renewal invoice made before this branch was added does not count it yet.
  for inv in
    select distinct i.id from public.invoices i join public.invoice_items it on it.invoice_id = i.id
    where i.vendor_id = v and i.status = 'unpaid' and it.plan_id = p.id
  loop
    insert into public.invoice_items (invoice_id, branch_charge, branch_id, description, days, amount)
    values (inv, true, b.id, left('Extra branch: ' || b.name || ' (' || p.period_days || ' days)', 200),
            p.period_days, p.extra_branch_price);
    perform private.invoice_totals(inv);
  end loop;
end;
$$;
revoke execute on function private.charge_branch(bigint, public.branches, int) from public, anon, authenticated;

-- Taking a branch off invoices ---------------------------------------------------------------------------

-- Takes branch id off every unpaid invoice; an invoice left empty is cancelled with the reason.
create or replace function private.unbill_branch(p_branch_id bigint, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv bigint;
begin
  for inv in
    select distinct it.invoice_id from public.invoice_items it join public.invoices i on i.id = it.invoice_id
    where it.branch_id = p_branch_id and it.branch_charge and i.status = 'unpaid'
  loop
    delete from public.invoice_items where invoice_id = inv and branch_id = p_branch_id and branch_charge;
    if exists (select 1 from public.invoice_items where invoice_id = inv) then
      perform private.invoice_totals(inv);
    else
      update public.invoices set status = 'void', subtotal = 0, tax = 0, total = 0, void_reason = p_reason
        where id = inv;
    end if;
  end loop;
end;
$$;
revoke execute on function private.unbill_branch(bigint, text) from public, anon, authenticated;

-- A deleted branch comes off unpaid invoices, and prizes that were only for it are switched off.
create or replace function public.unbill_deleted_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.unbill_branch(old.id, 'The branch was deleted before payment');
  update public.scratch_prizes p set is_active = false
  where not p.all_branches
    and exists (select 1 from public.scratch_prize_branches pb where pb.prize_id = p.id and pb.branch_id = old.id)
    and not exists (select 1 from public.scratch_prize_branches pb where pb.prize_id = p.id and pb.branch_id <> old.id);
  return old;
end;
$$;

-- A refused branch comes off unpaid invoices. Already paid: admins are told a refund may be due.
create or replace function public.unbill_refused_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid public.invoices;
  a uuid;
begin
  if new.review_status = 'rejected' and old.review_status is distinct from 'rejected' then
    perform private.unbill_branch(new.id, 'The branch was not approved');
    select i.* into paid from public.invoice_items it join public.invoices i on i.id = it.invoice_id
      where it.branch_id = new.id and it.branch_charge and i.status in ('paid', 'submitted')
      order by i.id desc limit 1;
    if paid.id is not null then
      for a in select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin') loop
        perform private.notify(a, 'billing', 'Refused branch was paid for: ' || new.name,
          'Invoice ' || paid.number || ' includes this branch. Refund it or approve the branch once fixed.',
          '/admin/billing/invoices/' || paid.id);
      end loop;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists branches_unbill_refused on public.branches;
create trigger branches_unbill_refused after update of review_status on public.branches
  for each row execute function public.unbill_refused_branch();
revoke execute on function public.unbill_refused_branch() from public, anon, authenticated;

-- Owner: a new invoice for branches whose charge was cancelled or taken off (refused, then approved).
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
    where s.vendor_id = v and br.awaiting_payment and br.payment_invoice_id is not null
      and br.review_status <> 'rejected'
      and not exists (select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id
                      where it.invoice_id = br.payment_invoice_id and it.branch_id = br.id and it.branch_charge
                        and i.status in ('unpaid', 'submitted', 'paid'))
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

-- When the renewal is running ---------------------------------------------------------------------------

-- Branches whose part-month charge was never paid but whose period is over, while the plan (renewed)
-- is running: the old charge is dropped and the branch goes live. Business v, or every business.
create or replace function private.settle_branch_payments(v bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  r record;
begin
  for r in
    select br.id, br.payment_invoice_id
    from public.branches br
    join public.shops s on s.id = br.shop_id
    join public.invoices i on i.id = br.payment_invoice_id
    join public.invoice_items it on it.invoice_id = i.id and it.branch_id = br.id and it.branch_charge
    where br.awaiting_payment and (v is null or s.vendor_id = v) and i.status = 'unpaid'
      and i.issued_on + it.days - 1 < today
      and exists (select 1 from public.subscriptions sub
                  where sub.vendor_id = s.vendor_id and sub.cancelled_at is null
                    and sub.plan_id = (private.vendor_plan(s.vendor_id)).id
                    and today between sub.starts_on and sub.ends_on
                    and sub.starts_on > i.issued_on)
  loop
    perform private.unbill_branch(r.id, 'Covered by the plan renewal');
    update public.branches set awaiting_payment = false, payment_invoice_id = null where id = r.id;
  end loop;
end;
$$;
revoke execute on function private.settle_branch_payments(bigint) from public, anon, authenticated;

-- A plan period that starts now settles the business's old branch charges.
create or replace function public.settle_branches_on_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.settle_branch_payments(new.vendor_id);
  return null;
end;
$$;
drop trigger if exists subscriptions_settle_branches on public.subscriptions;
create trigger subscriptions_settle_branches after insert on public.subscriptions
  for each row execute function public.settle_branches_on_subscription();
revoke execute on function public.settle_branches_on_subscription() from public, anon, authenticated;

-- Renewals paid ahead start on a later day: checked every night.
create or replace function public.branch_billing_daily()
returns void
language sql
volatile
security definer
set search_path = ''
as $$ select private.settle_branch_payments(null) $$;
revoke execute on function public.branch_billing_daily() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('branch-billing-daily', '35 18 * * *', 'select public.branch_billing_daily()');
  end if;
end $$;

-- The owner is told when a paid branch goes live ----------------------------------------------------------

create or replace function public.alert_branch_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.awaiting_payment and not new.awaiting_payment and new.review_status = 'approved' then
    perform private.notify(
      (select v.owner_id from public.shops s join public.vendors v on v.id = s.vendor_id where s.id = new.shop_id),
      'vendor_review', 'Branch is live: ' || new.name,
      (select name from public.shops where id = new.shop_id) || ' · ' || new.name || ' is now live on IWILLFLY.',
      '/vendor/branches/' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists branches_live_alert on public.branches;
create trigger branches_live_alert after update of awaiting_payment on public.branches
  for each row execute function public.alert_branch_live();
revoke execute on function public.alert_branch_live() from public, anon, authenticated;

-- Scratch & Win only at live branches ----------------------------------------------------------------------

-- A branch customers can see: approved and paid.
create or replace function private.branch_is_live(b bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.branches where id = b and review_status = 'approved' and not awaiting_payment);
$$;
revoke execute on function private.branch_is_live(bigint) from public, anon;
grant execute on function private.branch_is_live(bigint) to authenticated;

-- Same as before, plus: a prize only for some branches needs at least one of them live.
create or replace function private.prize_available_for(p_prize_id bigint, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (not exists (select 1 from public.scratch_prize_locations where prize_id = p_prize_id)
          or exists (
            select 1 from public.scratch_prize_locations spl
            where spl.prize_id = p_prize_id
              and private.location_within((select location_id from public.profiles where id = uid), spl.location_id)))
    and (exists (select 1 from public.scratch_prizes where id = p_prize_id and all_branches)
         or exists (select 1 from public.scratch_prize_branches pb
                    where pb.prize_id = p_prize_id and private.branch_is_live(pb.branch_id)));
$$;
revoke execute on function private.prize_available_for(bigint, uuid) from public, anon, authenticated;

-- Winners are sent to live branches only.
create or replace function private.play_json(p public.scratch_plays)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'play_id', p.id,
    'campaign_id', p.campaign_id,
    'campaign_name', c.name,
    'played_at', p.played_at,
    'won', p.won,
    'prize', case when p.won then jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'description', pr.description, 'image_key', pr.image_key) end,
    'sponsor', case when v.id is not null then jsonb_build_object(
      'vendor_id', v.id, 'name', v.business_name, 'phone', v.contact_phone, 'whatsapp', v.whatsapp,
      'shop_id', coalesce(
        (select b.shop_id from public.scratch_prize_branches pb join public.branches b on b.id = pb.branch_id
         where pb.prize_id = pr.id and not pr.all_branches and private.branch_is_live(b.id) order by b.id limit 1),
        (select s.id from public.shops s where s.vendor_id = v.id and s.is_active
         order by s.created_at, s.id limit 1)),
      'collect_at', case when pr.id is not null and not pr.all_branches then
        (select jsonb_agg(b.name order by b.name) from public.scratch_prize_branches pb
         join public.branches b on b.id = pb.branch_id
         where pb.prize_id = pr.id and private.branch_is_live(b.id)) end) end,
    'claim_code', p.claim_code,
    'claim_status', case when p.claim_status = 'unclaimed' and p.expires_at < now() then 'expired'
                         else p.claim_status::text end,
    'expires_at', p.expires_at,
    'claimed_at', p.claimed_at
  )
  from public.scratch_campaigns c
  left join public.scratch_prizes pr on pr.id = p.prize_id
  left join public.vendors v on v.id = p.vendor_id
  where c.id = p.campaign_id;
$$;

-- A paid plan that ran out hides the shop ---------------------------------------------------------------
-- On a paid plan, customers see the shop (its branches, offers and prizes) only while a plan period is
-- running. Free plans and businesses with no plan are not affected. The owner, the team and admins still
-- see everything, and the owner can renew from Plan & billing.

-- True unless the business is on a paid plan with no period running today.
create or replace function private.vendor_plan_running(v bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.vendor_plan(v)).price, 0) = 0
    or exists (select 1 from public.subscriptions s
               where s.vendor_id = v and s.cancelled_at is null
                 and private.today_ist() between s.starts_on and s.ends_on);
$$;
revoke execute on function private.vendor_plan_running(bigint) from public;
grant execute on function private.vendor_plan_running(bigint) to authenticated;

-- What customers see: approved, and the plan running.
create or replace function private.vendor_is_listed(v bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.vendor_is_live(v) and private.vendor_plan_running(v) $$;
revoke execute on function private.vendor_is_listed(bigint) from public;
grant execute on function private.vendor_is_listed(bigint) to authenticated;

-- Branches, offers, malls and events of the shop follow it (they all ask shop_is_live).
create or replace function private.shop_is_live(s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops sh join public.vendors v on v.id = sh.vendor_id
    where sh.id = s and sh.is_active and v.status = 'approved' and private.vendor_plan_running(v.id)
  );
$$;

-- ("shops: public read live" is a service_role leftover with no effect; it stays as it is.)
drop policy if exists "shops: read live, own team or admin" on public.shops;
create policy "shops: read live, own team or admin" on public.shops
  for select to authenticated
  using ((is_active and private.vendor_is_listed(vendor_id)) or private.can_see_own_shop(id)
         or (select private.is_admin()));

-- Same as earlier in this file, plus: a sponsor whose paid plan ran out gives no prizes.
create or replace function private.prize_available_for(p_prize_id bigint, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (not exists (select 1 from public.scratch_prize_locations where prize_id = p_prize_id)
          or exists (
            select 1 from public.scratch_prize_locations spl
            where spl.prize_id = p_prize_id
              and private.location_within((select location_id from public.profiles where id = uid), spl.location_id)))
    and (exists (select 1 from public.scratch_prizes where id = p_prize_id and all_branches)
         or exists (select 1 from public.scratch_prize_branches pb
                    where pb.prize_id = p_prize_id and private.branch_is_live(pb.branch_id)))
    and coalesce((select private.vendor_plan_running(sponsor_vendor_id) from public.scratch_prizes
                  where id = p_prize_id and sponsor_vendor_id is not null), true);
$$;
revoke execute on function private.prize_available_for(bigint, uuid) from public, anon, authenticated;

-- The vendor area knows whether customers can see the shop (plan_running).
create or replace function public.my_vendor()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(v) || jsonb_build_object(
    'my_role', case when v.owner_id = (select auth.uid()) then 'owner' else st.role::text end,
    'my_branch_id', st.branch_id,
    'my_branch_name', b.name,
    'my_branch_shop_id', b.shop_id,
    'my_login_name', st.login_name,
    'plan_running', private.vendor_plan_running(v.id))
  from public.vendors v
  left join public.vendor_staff st on st.vendor_id = v.id and st.user_id = (select auth.uid())
    and st.removed_at is null and st.disabled_at is null
  left join public.branches b on b.id = st.branch_id
  where v.owner_id = (select auth.uid()) or st.user_id is not null
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;
