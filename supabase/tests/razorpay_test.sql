-- Razorpay payments: each provider has its own switch and its own payment pages; a Razorpay payment pays the
-- invoice as 'razorpay'; the Instamojo calls keep working unchanged.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/razorpay_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'payer@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'RAZORPAY TEST FAILED: %', what; end if;
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

insert into public.plans (name, price, period_days) values ('RZ Pro', 499, 30);
insert into public.vendors (owner_id, business_name, plan_id)
  select '00000000-0000-0000-0000-0000000000f1', 'Razor Shop', id from public.plans where name = 'RZ Pro';
insert into ids select 'v', id from public.vendors where owner_id = '00000000-0000-0000-0000-0000000000f1';
insert into public.invoices (number, vendor_id, subtotal, total) select 'IWF-RZ-1', v, 499, 499 from ids where k = 'v';
insert into ids select 'inv', id from public.invoices where number = 'IWF-RZ-1';

-- Signed-in users cannot use the new functions.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
set local role authenticated;
select pg_temp.check(pg_temp.try_sql(format('select public.gateway_invoice_for(%s, ''00000000-0000-0000-0000-0000000000f1'', ''razorpay'')',
  (select v from ids where k = 'inv'))) like '%permission denied%', 'a signed-in user cannot read the Razorpay charge');
select pg_temp.check(pg_temp.try_sql(format(
  'select public.gateway_payment_created(%s, ''plink_X'', ''https://rzp.io/x'', 499, ''00000000-0000-0000-0000-0000000000f1'', ''razorpay'')',
  (select v from ids where k = 'inv'))) like '%permission denied%', 'a signed-in user cannot add a payment link');
reset role;

set local role service_role;
select pg_temp.check(pg_temp.try_sql(format('select public.gateway_invoice_for(%s, ''00000000-0000-0000-0000-0000000000f1'', ''razorpay'')',
  (select v from ids where k = 'inv'))) like 'Razorpay payment is switched off%', 'Razorpay starts switched off');
reset role;
update public.billing_settings set pay_razorpay = true, pay_instamojo = false where id = 1;
set local role service_role;
select pg_temp.check((public.gateway_invoice_for((select v from ids where k = 'inv'), '00000000-0000-0000-0000-0000000000f1', 'razorpay')->>'amount')::numeric = 499,
  'switched on, Razorpay gets the amount from the invoice');
select pg_temp.check(pg_temp.try_sql(format('select public.gateway_invoice_for(%s, ''00000000-0000-0000-0000-0000000000f1'')',
  (select v from ids where k = 'inv'))) like 'Online payment is switched off%', 'the Instamojo switch still works on its own');
select pg_temp.check(pg_temp.try_sql(format('select public.gateway_invoice_for(%s, ''00000000-0000-0000-0000-0000000000f1'', ''paypal'')',
  (select v from ids where k = 'inv'))) like 'Unknown payment provider%', 'unknown providers are refused');
reset role;
update public.billing_settings set pay_instamojo = true where id = 1;
set local role service_role;
-- An Instamojo page and a Razorpay link: each provider only sees its own.
select public.gateway_payment_created((select v from ids where k = 'inv'), 'IMREQ1', 'https://www.instamojo.com/@x/IMREQ1', 499,
  '00000000-0000-0000-0000-0000000000f1');
select public.gateway_payment_created((select v from ids where k = 'inv'), 'plink_A1', 'https://rzp.io/rzp/a1', 499,
  '00000000-0000-0000-0000-0000000000f1', 'razorpay');
select pg_temp.check(public.gateway_invoice_for((select v from ids where k = 'inv'), '00000000-0000-0000-0000-0000000000f1', 'razorpay')
  ->>'reuse_url' = 'https://rzp.io/rzp/a1', 'the recent Razorpay link is offered again');
select pg_temp.check(public.gateway_invoice_for((select v from ids where k = 'inv'), '00000000-0000-0000-0000-0000000000f1', 'razorpay')
  ->'open_requests' = '["plink_A1"]'::jsonb, 'Razorpay only checks its own open links');
select pg_temp.check(public.gateway_invoice_for((select v from ids where k = 'inv'), '00000000-0000-0000-0000-0000000000f1')
  ->>'reuse_url' = 'https://www.instamojo.com/@x/IMREQ1', 'Instamojo still offers its own page');
select pg_temp.check(public.gateway_record_payment('plink_A1', 'pay_1', 498, null)->>'result' = 'mismatch',
  'a wrong amount does not pay the invoice');
select public.gateway_payment_created((select v from ids where k = 'inv'), 'plink_A2', 'https://rzp.io/rzp/a2', 499,
  '00000000-0000-0000-0000-0000000000f1', 'razorpay');
select pg_temp.check(public.gateway_record_payment('plink_A2', 'pay_2', 499, '{"method":"upi"}')->>'result' = 'paid',
  'a captured Razorpay payment pays the invoice');
select pg_temp.check(public.gateway_record_payment('plink_A2', 'pay_2', 499, null)->>'result' = 'already',
  'the webhook after the return changes nothing');
select pg_temp.check(public.gateway_record_payment('IMREQ1', 'IMP1', 499, null)->>'result' = 'duplicate',
  'an Instamojo payment on top is flagged');
reset role;
select pg_temp.check((select status = 'paid' and payment_method = 'razorpay' and payment_ref = 'pay_2'
                      from public.invoices where id = (select v from ids where k = 'inv')), 'invoice paid by Razorpay with its payment id');
select pg_temp.check((select provider = 'razorpay' from public.gateway_payments where request_id = 'plink_A2'), 'link stored as Razorpay');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'
                               and body like '%Instamojo payment IMP1%'), 'the refund notice names the provider');
rollback;
