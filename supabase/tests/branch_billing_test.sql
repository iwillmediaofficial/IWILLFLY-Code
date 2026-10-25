-- Branch billing: part-month charges for branches added later, waiting until paid and approved, refused
-- and deleted branches coming off invoices, renewals, plans that are not running, and Scratch & Win prizes
-- only at live branches.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/branch_billing_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@test.local', '{"full_name":"Lulu Owner"}', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'customer@test.local', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}', '{}');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'BRANCH BILLING TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;
grant execute on function pg_temp.check(boolean, text) to authenticated;

-- A business on a 30-day plan with 1 branch included and ₹300 per extra branch, 10 days into its period.
insert into public.plans (name, price, period_days, included_branches, extra_branch_price)
  values ('Brand', 1000, 30, 1, 300);
insert into ids select 'plan', id from public.plans where name = 'Brand';
insert into public.vendors (owner_id, business_name, status, plan_id)
  values ('00000000-0000-0000-0000-0000000000b1', 'Lulu Group', 'approved', (select v from ids where k = 'plan'));
insert into ids select 'v', id from public.vendors where business_name = 'Lulu Group';
insert into public.subscriptions (vendor_id, plan_id, starts_on, ends_on)
  values ((select v from ids where k = 'v'), (select v from ids where k = 'plan'),
          private.today_ist() - 10, private.today_ist() + 19);
insert into ids select 'sub', id from public.subscriptions where vendor_id = (select v from ids where k = 'v');
insert into public.shops (vendor_id, name) values ((select v from ids where k = 'v'), 'Lulu Hypermarket');
insert into ids select 'shop', id from public.shops where name = 'Lulu Hypermarket';
insert into public.branches (shop_id, name, lat, lng) values ((select v from ids where k = 'shop'), 'Main', 10.01, 76.35);

-- Adding a branch: the price first, then the part-month invoice ----------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((public.branch_price_quote()->>'amount')::numeric = 200.00
                     and (public.branch_price_quote()->>'days_left')::int = 20,
  'the owner sees the price for the 20 days left: 300 x 20 / 30');
insert into public.branches (shop_id, name, lat, lng) values ((select v from ids where k = 'shop'), 'Kakkanad', 10.02, 76.34);
insert into public.branches (shop_id, name, lat, lng) values ((select v from ids where k = 'shop'), 'Aluva', 10.10, 76.35);
reset role;
insert into ids select 'b_kak', id from public.branches where name = 'Kakkanad';
insert into ids select 'b_alu', id from public.branches where name = 'Aluva';
insert into ids select 'inv', payment_invoice_id from public.branches where name = 'Kakkanad';
select pg_temp.check((select bool_and(awaiting_payment) from public.branches where name in ('Kakkanad', 'Aluva')),
  'extra branches wait for payment');
select pg_temp.check((select count(distinct payment_invoice_id) from public.branches where name in ('Kakkanad', 'Aluva')) = 1,
  'branches added the same day share one invoice');
select pg_temp.check((select subtotal from public.invoices where id = (select v from ids where k = 'inv')) = 400.00,
  'the invoice charges both branches for the days left');
select pg_temp.check(not (select awaiting_payment from public.branches where name = 'Main'),
  'the included branch is never charged');

-- Hidden until approved and paid; prizes only at live branches -----------------------------------------
insert into public.scratch_campaigns (name, is_active) values ('Test campaign', true);
insert into ids select 'camp', id from public.scratch_campaigns where name = 'Test campaign';
insert into public.scratch_prizes (campaign_id, sponsor_vendor_id, name, quantity, probability, is_active, all_branches)
  values ((select v from ids where k = 'camp'), (select v from ids where k = 'v'), 'Free coffee', 10, 0.5, true, false);
insert into ids select 'prize', id from public.scratch_prizes where name = 'Free coffee';
insert into public.scratch_prize_branches (prize_id, branch_id)
  values ((select v from ids where k = 'prize'), (select v from ids where k = 'b_kak'));
select pg_temp.check(not private.prize_available_for((select v from ids where k = 'prize'), '00000000-0000-0000-0000-0000000000c1'),
  'a prize only for a branch that is not live cannot be won');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.branches where shop_id = (select v from ids where k = 'shop')) = 1,
  'customers do not see branches waiting for approval and payment');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.review_branch((select v from ids where k = 'b_kak'), true);
reset role;
select pg_temp.check((select awaiting_payment from public.branches where id = (select v from ids where k = 'b_kak')),
  'an approved branch still waits for payment');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1'
                             and body like 'Pay the branch invoice%'), 'the owner is told to pay after approval');

-- Refused before payment: it comes off the invoice --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.review_branch((select v from ids where k = 'b_alu'), false, 'Wrong address');
reset role;
select pg_temp.check((select subtotal from public.invoices where id = (select v from ids where k = 'inv')) = 200.00,
  'a refused branch comes off the unpaid invoice');

-- Paying puts the approved branch live --------------------------------------------------------------------
select private.activate_invoice((select v from ids where k = 'inv'), 'upi', 'TEST1', null);
select pg_temp.check(not (select awaiting_payment from public.branches where id = (select v from ids where k = 'b_kak')),
  'paying the invoice puts the branch live');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1'
                             and title = 'Branch is live: Kakkanad'), 'the owner is told the branch is live');
select pg_temp.check(private.prize_available_for((select v from ids where k = 'prize'), '00000000-0000-0000-0000-0000000000c1'),
  'the prize can be won once its branch is live');

-- Refused after payment: admins are told a refund may be due ----------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.review_branch((select v from ids where k = 'b_kak'), false, 'Closed down');
reset role;
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'
                             and title = 'Refused branch was paid for: Kakkanad'), 'admins hear about a paid, refused branch');

-- A renewal invoice made earlier gets the new branch for the next period ----------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.create_invoice(jsonb_build_array(jsonb_build_object('plan_id', (select v from ids where k = 'plan'))));
reset role;
insert into ids select 'renewal', max(i.id) from public.invoices i join public.invoice_items it on it.invoice_id = i.id
  where i.vendor_id = (select v from ids where k = 'v') and it.plan_id is not null;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.branches (shop_id, name, lat, lng) values ((select v from ids where k = 'shop'), 'Edappally', 10.03, 76.30);
reset role;
select pg_temp.check(exists (select 1 from public.invoice_items it join public.branches b on b.id = it.branch_id
                             where it.invoice_id = (select v from ids where k = 'renewal') and b.name = 'Edappally'
                               and it.amount = 300.00 and it.days = 30),
  'a branch added after the renewal invoice is added to it for the next period');

-- Deleting a branch: off the unpaid invoices, its own prizes switched off ----------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
delete from public.branches where id = (select v from ids where k = 'b_kak');
reset role;
select pg_temp.check(not (select is_active from public.scratch_prizes where id = (select v from ids where k = 'prize')),
  'a prize only for a deleted branch is switched off');

-- Plan not running: a new branch waits for the renewal ------------------------------------------------------
update public.subscriptions set ends_on = private.today_ist() - 1, starts_on = private.today_ist() - 30
  where id = (select v from ids where k = 'sub');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((public.branch_price_quote()->>'no_plan')::boolean, 'the quote says the plan is not running');
insert into public.branches (shop_id, name, lat, lng) values ((select v from ids where k = 'shop'), 'Thrissur', 10.52, 76.21);
reset role;
select pg_temp.check((select awaiting_payment and payment_invoice_id is null from public.branches where name = 'Thrissur'),
  'with no running plan a new branch waits for the plan renewal, not free');
select private.activate_invoice((select v from ids where k = 'renewal'), 'upi', 'TEST2', null);
select pg_temp.check(not (select awaiting_payment from public.branches where name = 'Thrissur'),
  'paying the renewal puts it live');

-- An old part-month charge never paid is settled by a running renewal ---------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.branches (shop_id, name, lat, lng) values ((select v from ids where k = 'shop'), 'Vytilla', 9.97, 76.32);
reset role;
select pg_temp.check((select payment_invoice_id is not null from public.branches where name = 'Vytilla'),
  'a branch added in the renewed period gets its own part-month invoice');
update public.invoices set issued_on = private.today_ist() - 40
  where id = (select payment_invoice_id from public.branches where name = 'Vytilla');
update public.subscriptions set starts_on = private.today_ist() - 45, ends_on = private.today_ist() - 16
  where vendor_id = (select v from ids where k = 'v');
insert into public.subscriptions (vendor_id, plan_id, starts_on, ends_on)
  values ((select v from ids where k = 'v'), (select v from ids where k = 'plan'), private.today_ist() - 2, private.today_ist() + 27);
select pg_temp.check(not (select awaiting_payment from public.branches where name = 'Vytilla'),
  'once its period is over and the renewal is running, an unpaid old charge no longer hides the branch');

-- A paid plan that ran out hides the shop from customers ------------------------------------------------
update public.subscriptions set cancelled_at = now() where vendor_id = (select v from ids where k = 'v');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops where id = (select v from ids where k = 'shop')) = 0,
  'customers cannot see a shop whose paid plan ran out');
select pg_temp.check((select count(*) from public.branches where shop_id = (select v from ids where k = 'shop')) = 0,
  'nor its branches');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops where id = (select v from ids where k = 'shop')) = 1,
  'the owner still sees the shop');
select pg_temp.check(not (public.my_vendor()->>'plan_running')::boolean, 'the vendor area knows the plan ran out');
reset role;
insert into public.plans (name, price, period_days) values ('Free', 0, 30);
update public.vendors set plan_id = (select id from public.plans where name = 'Free') where id = (select v from ids where k = 'v');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops where id = (select v from ids where k = 'shop')) = 1,
  'a business on a free plan is never hidden');
reset role;

rollback;
