-- Phase 4 gate: a vendor buys a plan and an add-on, the invoice and expiry behave, plus staff access,
-- plan limits, support tickets and the audit log.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/monetisation_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@test.local', '{"full_name":"Shop Owner"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'other@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000e1', 'manager@test.local', '{"full_name":"Store Manager"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'cashier@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'customer@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', 'support@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'boss@test.local', '{}');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'support'),
  ('00000000-0000-0000-0000-0000000000a3', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'MONETISATION TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;

insert into public.vendors (owner_id, business_name, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Lulu Fashion', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'Fresh Mart', 'approved');
insert into ids select 'v1', id from public.vendors where owner_id = '00000000-0000-0000-0000-0000000000b1';
insert into ids select 'v2', id from public.vendors where owner_id = '00000000-0000-0000-0000-0000000000b2';
insert into public.shops (vendor_id, name) select id, business_name from public.vendors;
insert into ids select 'shop1', id from public.shops where vendor_id = (select v from ids where k = 'v1');
insert into ids select 'shop2', id from public.shops where vendor_id = (select v from ids where k = 'v2');
insert into public.offers (shop_id, title, status)
  select id, 'Offer of ' || name, 'approved' from public.shops;
insert into ids select 'offer1', id from public.offers where shop_id = (select v from ids where k = 'shop1');
insert into ids select 'offer2', id from public.offers where shop_id = (select v from ids where k = 'shop2');

-- Admin sets up billing ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.billing_settings set upi_id = 'iwillfly@okaxis', payee_name = 'IWILLFLY', business_name = 'IWILLFLY',
  gst_percent = 18;
insert into public.plans (name, price, period_days, max_shops, max_live_offers, is_default)
  values ('Free', 0, 30, 1, 2, true);
insert into public.plans (name, price, period_days, max_shops, max_live_offers)
  values ('Pro', 499, 30, 3, 20);
insert into public.addons (kind, name, price, duration_days) values
  ('promoted_offer', 'Promoted offer', 99, 7),
  ('featured_shop', 'Featured shop', 199, 7);
reset role;
insert into ids select 'free', id from public.plans where name = 'Free';
insert into ids select 'pro', id from public.plans where name = 'Pro';
insert into ids select 'promo', id from public.addons where kind = 'promoted_offer';
insert into ids select 'feat', id from public.addons where kind = 'featured_shop';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  update public.billing_settings set upi_id = 'thief@okaxis';
  if (select upi_id from public.billing_settings) = 'thief@okaxis' then
    raise exception 'MONETISATION TEST FAILED: vendor changed the UPI ID';
  end if;
  raise notice 'ok - vendors cannot change billing settings';
end $$;
do $$ begin
  insert into public.plans (name, price) values ('Hack', 0);
  raise exception 'MONETISATION TEST FAILED: vendor created a plan';
exception when insufficient_privilege then raise notice 'ok - vendors cannot create plans';
end $$;
select pg_temp.check((select (my_billing()->'plan'->>'name') = 'Free'), 'vendors without a plan are on the default plan');

-- Free plan limits: 1 shop, 2 live offers
do $$ begin
  insert into public.shops (vendor_id, name) values ((select v from ids where k = 'v1'), 'Second shop');
  raise exception 'MONETISATION TEST FAILED: plan shop limit not enforced';
exception when raise_exception then raise notice 'ok - free plan stops a second shop';
end $$;
insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop1'), 'Second offer');
do $$ begin
  insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop1'), 'Third offer');
  raise exception 'MONETISATION TEST FAILED: plan offer limit not enforced';
exception when raise_exception then raise notice 'ok - free plan stops a third live offer';
end $$;

-- The owner buys Pro and a promoted offer ---------------------------------------------------------
insert into ids select 'inv', public.create_invoice(jsonb_build_array(
  jsonb_build_object('plan_id', (select v from ids where k = 'pro')),
  jsonb_build_object('addon_id', (select v from ids where k = 'promo'), 'offer_id', (select v from ids where k = 'offer1'))));
select pg_temp.check((select subtotal = 598 and tax = 107.64 and total = 705.64 and status = 'unpaid'
  and number ~ '^IWF-[0-9]{4}-[0-9]{5}$' and bill_from->>'upi_id' = 'iwillfly@okaxis'
  from public.invoices where id = (select v from ids where k = 'inv')), 'invoice totals include 18% GST and a number');
select pg_temp.check((select count(*) = 2 from public.invoice_items where invoice_id = (select v from ids where k = 'inv')),
  'invoice lists the plan and the add-on');
select pg_temp.check((select my_billing()->'plan'->>'name') = 'Free', 'nothing switches on before payment');
do $$ begin
  perform public.create_invoice(jsonb_build_array(jsonb_build_object(
    'addon_id', (select v from ids where k = 'promo'), 'offer_id', (select v from ids where k = 'offer2'))));
  raise exception 'MONETISATION TEST FAILED: vendor promoted another vendor''s offer';
exception when invalid_parameter_value then raise notice 'ok - add-ons only target your own offers';
end $$;
do $$ begin
  perform public.mark_invoice_paid((select v from ids where k = 'inv'), 'upi', 'X');
  raise exception 'MONETISATION TEST FAILED: vendor marked their own invoice paid';
exception when insufficient_privilege then raise notice 'ok - vendors cannot mark invoices paid';
end $$;
select public.submit_payment((select v from ids where k = 'inv'), '412345678901');
select pg_temp.check((select status = 'submitted' and payer_ref = '412345678901' from public.invoices
  where id = (select v from ids where k = 'inv')), 'vendor submits the UPI transaction id');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check((select count(*) = 0 from public.invoices), 'other vendors cannot see the invoice');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.mark_invoice_paid((select v from ids where k = 'inv'), 'upi', null);
reset role;
select pg_temp.check((select status = 'paid' and payment_ref = '412345678901' and paid_on = private.today_ist()
  from public.invoices where id = (select v from ids where k = 'inv')), 'admin marks the invoice paid');
select pg_temp.check((select starts_on = private.today_ist() and ends_on = private.today_ist() + 29
  from public.subscriptions where vendor_id = (select v from ids where k = 'v1')), 'Pro runs for 30 days from today');
select pg_temp.check((select is_featured from public.offers where id = (select v from ids where k = 'offer1')),
  'the promoted offer is featured right away');
select pg_temp.check((select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'billing'), 'owner is told the payment arrived');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$ begin
  perform public.mark_invoice_paid((select v from ids where k = 'inv'), 'upi', null);
  raise exception 'MONETISATION TEST FAILED: invoice paid twice';
exception when no_data_found then raise notice 'ok - a paid invoice cannot be paid again';
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select my_billing()->'plan'->>'name') = 'Pro', 'vendor is on Pro after payment');
insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop1'), 'Third offer');
select pg_temp.check(true, 'Pro allows more live offers');
-- Renewing the same plan stacks after the current period
insert into ids select 'inv2', public.create_invoice(jsonb_build_array(
  jsonb_build_object('plan_id', (select v from ids where k = 'pro'))));
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.mark_invoice_paid((select v from ids where k = 'inv2'), 'cash', 'counter');
reset role;
select pg_temp.check((select max(ends_on) = private.today_ist() + 59 and min(starts_on) = private.today_ist()
  from public.subscriptions where vendor_id = (select v from ids where k = 'v1')), 'a renewal starts when the current period ends');

-- Admin bills a vendor and cancels it
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into ids select 'inv3', public.create_invoice(jsonb_build_array(
  jsonb_build_object('addon_id', (select v from ids where k = 'feat'), 'shop_id', (select v from ids where k = 'shop2'))),
  (select v from ids where k = 'v2'));
select public.void_invoice((select v from ids where k = 'inv3'), 'Wrong shop');
select pg_temp.check((select status = 'void' from public.invoices where id = (select v from ids where k = 'inv3')),
  'admin can bill any vendor and cancel unpaid invoices');
insert into ids select 'inv4', public.create_invoice(jsonb_build_array(
  jsonb_build_object('addon_id', (select v from ids where k = 'feat'), 'shop_id', (select v from ids where k = 'shop2'))),
  (select v from ids where k = 'v2'));
select public.mark_invoice_paid((select v from ids where k = 'inv4'), 'bank', 'NEFT1');
reset role;
select pg_temp.check((select is_featured from public.shops where id = (select v from ids where k = 'shop2')),
  'a featured shop add-on features the shop');
select pg_temp.check((select featured from public.search_shops() where shop_id = (select v from ids where k = 'shop2')),
  'featured shops are marked featured in search');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
update public.shops set is_featured = false where id = (select v from ids where k = 'shop2');
select pg_temp.check((select is_featured from public.shops where id = (select v from ids where k = 'shop2')),
  'vendors cannot change the featured flag themselves');
reset role;

-- Reminders and expiry ----------------------------------------------------------------------------
select pg_temp.act_as(null);
update public.addon_purchases set ends_on = private.today_ist() + 7, starts_on = private.today_ist() - 1
  where kind = 'promoted_offer';
update public.addon_purchases set starts_on = private.today_ist() - 8, ends_on = private.today_ist() - 1
  where kind = 'featured_shop';
-- the first Pro period ends in a week, but the renewal follows, so no reminder for it
update public.subscriptions set ends_on = private.today_ist() + 7
  where ends_on = private.today_ist() + 29;
update public.subscriptions set starts_on = private.today_ist() + 8
  where ends_on = private.today_ist() + 59;
select public.billing_daily();
select pg_temp.check((select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'billing' and title like 'Promoted offer ends in 7 days'),
  'owner is reminded 7 days before an add-on ends');
select pg_temp.check((select count(*) = 0 from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and title like 'Your Pro plan ends%'),
  'no plan reminder when the renewal is already paid');
select public.billing_daily();
select pg_temp.check((select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and title like 'Promoted offer ends%'),
  'each reminder is sent once');
select pg_temp.check((select not is_featured from public.shops where id = (select v from ids where k = 'shop2')),
  'an expired featured shop add-on switches the flag off');
update public.subscriptions set ends_on = private.today_ist() + 1, reminded_1 = false
  where vendor_id = (select v from ids where k = 'v2');
insert into public.subscriptions (vendor_id, plan_id, starts_on, ends_on)
  values ((select v from ids where k = 'v2'), (select v from ids where k = 'pro'), private.today_ist() - 28, private.today_ist() + 1);
select public.billing_daily();
select pg_temp.check((select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b2' and title = 'Your Pro plan ends tomorrow'),
  'owner is reminded the day before a plan ends');
update public.subscriptions set starts_on = private.today_ist() - 30, ends_on = private.today_ist() - 1
  where vendor_id = (select v from ids where k = 'v2');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check((select my_billing()->'plan'->>'name') = 'Free', 'an expired plan falls back to the default plan');
reset role;

-- Vendor staff ------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.add_vendor_staff('Manager@test.local', 'manager');
select public.add_vendor_staff('cashier@test.local', 'staff');
do $$ begin
  perform public.add_vendor_staff('nobody@test.local', 'staff');
  raise exception 'MONETISATION TEST FAILED: added an unknown email';
exception when no_data_found then raise notice 'ok - unknown emails are refused';
end $$;
do $$ begin
  perform public.add_vendor_staff('other@test.local', 'staff');
  raise exception 'MONETISATION TEST FAILED: added another business owner';
exception when invalid_parameter_value then raise notice 'ok - other business owners cannot be added';
end $$;
select pg_temp.check((select count(*) = 3 from public.vendor_team()), 'owner sees the whole team');
reset role;
select pg_temp.check((select count(*) = 2 from public.user_roles
  where role = 'vendor' and user_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')),
  'team members get into the vendor area');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check((select my_vendor()->>'my_role') = 'manager', 'manager sees the business and their role');
update public.offers set description = 'Edited by manager' where id = (select v from ids where k = 'offer1');
select pg_temp.check((select description = 'Edited by manager' from public.offers where id = (select v from ids where k = 'offer1')),
  'managers can edit offers');
select pg_temp.check((select count(*) = 0 from public.invoices), 'managers do not see invoices');
do $$ begin
  perform public.create_invoice(jsonb_build_array(jsonb_build_object('plan_id', (select v from ids where k = 'pro'))));
  raise exception 'MONETISATION TEST FAILED: manager bought a plan';
exception when insufficient_privilege then raise notice 'ok - only the owner buys plans';
end $$;
do $$ begin
  perform public.add_vendor_staff('customer@test.local', 'staff');
  raise exception 'MONETISATION TEST FAILED: manager changed the team';
exception when insufficient_privilege then raise notice 'ok - only the owner manages the team';
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select pg_temp.check((select my_vendor()->>'my_role') = 'staff', 'staff see the business and their role');
select pg_temp.check((select count(*) = 1 from public.shops where vendor_id = (select v from ids where k = 'v1')),
  'staff can see their shop');
update public.offers set description = 'Edited by staff' where id = (select v from ids where k = 'offer1');
select pg_temp.check((select description = 'Edited by manager' from public.offers where id = (select v from ids where k = 'offer1')),
  'staff cannot edit offers');
select pg_temp.check((select (vendor_analytics(private.today_ist() - 7, private.today_ist())->'totals') is not null),
  'staff can see insights');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_vendor_staff('00000000-0000-0000-0000-0000000000e2', null);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select pg_temp.check((select my_vendor() is null), 'removed staff lose access');
reset role;

-- Support tickets ---------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into ids select 'ticket', public.open_ticket('Payment not showing', 'billing', 'I paid by UPI yesterday.', null, true);
select pg_temp.check((select vendor_id = (select v from ids where k = 'v1') and status = 'open' from public.support_tickets),
  'owner opens a business ticket');
do $$ begin
  insert into public.support_tickets (opened_by, subject) values ('00000000-0000-0000-0000-0000000000b1', 'Direct');
  raise exception 'MONETISATION TEST FAILED: ticket inserted directly';
exception when insufficient_privilege then raise notice 'ok - tickets are opened through the app only';
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check((select count(*) = 1 from public.support_tickets), 'the manager sees the business ticket');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) = 0 from public.support_tickets), 'customers cannot see other tickets');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.check((select count(*) = 1 from public.support_queue()), 'support sees the queue');
select public.post_ticket_message((select v from ids where k = 'ticket'), 'Found it, your plan is active now.');
select pg_temp.check((select count(*) >= 1 from public.invoices), 'support can read invoices to help');
do $$ begin
  perform public.mark_invoice_paid((select v from ids where k = 'inv'), 'upi', null);
  raise exception 'MONETISATION TEST FAILED: support marked an invoice paid';
exception when insufficient_privilege then raise notice 'ok - support cannot record payments';
end $$;
reset role;
select pg_temp.check((select status = 'waiting' and last_from_staff from public.support_tickets),
  'a support reply waits on the vendor');
select pg_temp.check((select count(*) = 1 from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'support_reply'), 'the vendor is told about the reply');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.post_ticket_message((select v from ids where k = 'ticket'), 'Thanks!');
select public.set_ticket_status((select v from ids where k = 'ticket'), 'closed');
do $$ begin
  perform public.set_ticket_status((select v from ids where k = 'ticket'), 'resolved');
  raise exception 'MONETISATION TEST FAILED: vendor set a support-only status';
exception when insufficient_privilege then raise notice 'ok - vendors can only close tickets';
end $$;
reset role;
select pg_temp.check((select status = 'closed' from public.support_tickets), 'vendor closes the ticket');

-- Admin roles and audit log -----------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.grant_staff_role('customer@test.local', 'campaign_manager');
do $$ begin
  perform public.grant_staff_role('customer@test.local', 'admin');
  raise exception 'MONETISATION TEST FAILED: admin granted admin';
exception when insufficient_privilege then raise notice 'ok - only a super admin grants admin';
end $$;
select pg_temp.check((select count(*) = 4 from public.admin_team()), 'admins see the staff team');
select pg_temp.check((select count(*) > 0 from public.audit_log('invoices')), 'invoice changes are in the audit log');
select pg_temp.check((select count(*) > 0 from public.audit_log('plans')), 'plan changes are in the audit log');
select pg_temp.check((select count(*) > 0 from public.audit_log('user_roles')), 'role grants are in the audit log');
select pg_temp.check((select bool_and(actor_email = 'admin@test.local') from public.audit_log('plans')),
  'the audit log names who did it');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select public.grant_staff_role('customer@test.local', 'admin');
select pg_temp.check(true, 'a super admin grants admin');
reset role;

select pg_temp.check((select count(*) = 0 from public.admin_audit_log
  where actor_id = '00000000-0000-0000-0000-0000000000b1'), 'vendor actions are not in the audit log');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp.check((select count(*) = 0 from public.admin_audit_log), 'support cannot read the audit log');
reset role;

rollback;
