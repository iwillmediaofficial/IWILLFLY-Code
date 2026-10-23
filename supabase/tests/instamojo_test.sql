-- Instamojo payments: only the service role (the Worker) can use the gateway functions; amounts must match;
-- an invoice is paid once; a second payment is flagged for refund.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/instamojo_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'payer@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'stranger@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'INSTAMOJO TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create function pg_temp.try_sql(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.try_sql(text) to authenticated, service_role;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, service_role;

insert into public.plans (name, price, period_days) values ('IM Pro', 499, 30);
insert into public.vendors (owner_id, business_name, plan_id)
  select '00000000-0000-0000-0000-0000000000f1', 'Pay Shop', id from public.plans where name = 'IM Pro';
insert into ids select 'v', id from public.vendors where owner_id = '00000000-0000-0000-0000-0000000000f1';
insert into public.invoices (number, vendor_id, subtotal, total) select 'IWF-T-1', v, 499, 499 from ids where k = 'v';
insert into ids select 'inv', id from public.invoices where number = 'IWF-T-1';
insert into public.invoice_items (invoice_id, plan_id, description, days, amount)
  select (select v from ids where k = 'inv'), id, 'IM Pro', 30, 499 from public.plans where name = 'IM Pro';

-- Vendors and customers cannot call the gateway functions or write payment records.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
set local role authenticated;
select pg_temp.check(pg_temp.try_sql('select public.gateway_record_payment(''r1'', ''p1'', 499, null)') like '%permission denied%',
  'a signed-in user cannot mark a payment');
select pg_temp.check(pg_temp.try_sql(format('select public.gateway_invoice_for(%s, ''00000000-0000-0000-0000-0000000000f1'')',
  (select v from ids where k = 'inv'))) like '%permission denied%', 'a signed-in user cannot read the charge details');
select pg_temp.check(pg_temp.try_sql(format(
  'insert into public.gateway_payments (invoice_id, vendor_id, request_id, longurl, amount) values (%s, %s, ''x'', ''u'', 1)',
  (select v from ids where k = 'inv'), (select v from ids where k = 'v'))) is not null, 'a signed-in user cannot add payment records');
reset role;

set local role service_role;
select pg_temp.check(pg_temp.try_sql(format('select public.gateway_invoice_for(%s, ''00000000-0000-0000-0000-0000000000f2'')',
  (select v from ids where k = 'inv'))) like 'Invoice not found%', 'only the invoice owner can pay it');
select pg_temp.check((public.gateway_invoice_for((select v from ids where k = 'inv'), '00000000-0000-0000-0000-0000000000f1')->>'amount')::numeric = 499,
  'the amount comes from the invoice');
select public.gateway_payment_created((select v from ids where k = 'inv'), 'REQ1', 'https://www.instamojo.com/@x/REQ1', 499,
  '00000000-0000-0000-0000-0000000000f1');
select public.gateway_payment_created((select v from ids where k = 'inv'), 'REQ2', 'https://www.instamojo.com/@x/REQ2', 499,
  '00000000-0000-0000-0000-0000000000f1');
select pg_temp.check(public.gateway_invoice_for((select v from ids where k = 'inv'), '00000000-0000-0000-0000-0000000000f1')->>'reuse_url'
  = 'https://www.instamojo.com/@x/REQ2', 'a fresh payment page is offered again');
select pg_temp.check(public.gateway_record_payment('NOPE', 'P0', 499, null)->>'result' = 'unknown', 'unknown requests are ignored');
select pg_temp.check(public.gateway_record_payment('REQ1', 'P1', 10, null)->>'result' = 'mismatch', 'a wrong amount does not pay the invoice');
select pg_temp.check((select status = 'unpaid' from public.invoices where id = (select v from ids where k = 'inv')), 'invoice still unpaid');
reset role;
-- REQ1 is now failed; open a third request and pay it.
set local role service_role;
select public.gateway_payment_created((select v from ids where k = 'inv'), 'REQ3', 'https://www.instamojo.com/@x/REQ3', 499,
  '00000000-0000-0000-0000-0000000000f1');
select pg_temp.check(public.gateway_record_payment('REQ3', 'P3', 499.00, '{"instrument_type":"UPI"}')->>'result' = 'paid', 'a matching Credit pays the invoice');
select pg_temp.check(public.gateway_record_payment('REQ3', 'P3', 499, null)->>'result' = 'already', 'the webhook after the redirect changes nothing');
select pg_temp.check(public.gateway_record_payment('REQ2', 'P2', 499, null)->>'result' = 'duplicate', 'a second payment is flagged');
reset role;
select pg_temp.check((select status = 'paid' and payment_method = 'instamojo' and payment_ref = 'P3'
                      from public.invoices where id = (select v from ids where k = 'inv')), 'invoice paid by Instamojo with its payment id');
select pg_temp.check((select count(*) = 1 from public.subscriptions where vendor_id = (select v from ids where k = 'v')),
  'the plan is switched on once');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'
                               and title like 'Paid and ready to review%'), 'admins hear the applicant has paid');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'
                               and title like 'Refund needed%'), 'admins hear about the double payment');
select pg_temp.check(private.application_paid((select v from ids where k = 'v')), 'payment-first approval now allows approving');

-- The owner can see their payment records; others cannot.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
set local role authenticated;
select pg_temp.check((select count(*) = 3 from public.gateway_payments), 'owner sees their payment records');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
select pg_temp.check((select count(*) = 0 from public.gateway_payments), 'others see none');
reset role;
rollback;
