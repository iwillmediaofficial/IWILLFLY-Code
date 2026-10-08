-- Customer points step B: cash-outs to UPI. LOCAL database only:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/points_redeem_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', '{"full_name":"Anjali Menon"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'REDEEM TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create function pg_temp.refused(sql text, expect text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'REDEEM TEST FAILED: % (was accepted)', what;
exception when others then
  if sqlerrm like 'REDEEM TEST FAILED%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'REDEEM TEST FAILED: % (wrong error: %)', what, sqlerrm;
  end if;
  raise notice 'ok - %', what;
end $$;

create temp table ids (name text primary key, id bigint);
grant all on ids to authenticated, anon;

-- Customer 1 has three batches: 800 (expires in 10 days), 900 (in 40 days), 1,500 (in 150 days) = 3,200
insert into public.points_ledger (customer_id, kind, points, points_remaining, expires_at, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'earn', 800, 800, now() + interval '10 days', now() - interval '170 days'),
  ('00000000-0000-0000-0000-0000000000c1', 'earn', 900, 900, now() + interval '40 days', now() - interval '140 days'),
  ('00000000-0000-0000-0000-0000000000c1', 'earn', 1500, 1500, now() + interval '150 days', now() - interval '30 days');
insert into public.points_ledger (customer_id, kind, points, points_remaining, expires_at) values
  ('00000000-0000-0000-0000-0000000000c2', 'earn', 1200, 1200, now() + interval '100 days');

-- Business days --------------------------------------------------------------------------------------

select pg_temp.check(private.add_business_days('2026-10-09 10:00+05:30', 2) = '2026-10-13 00:00+05:30',
  'Friday request is due by the end of Monday (Sunday skipped)');
select pg_temp.check(private.add_business_days('2026-10-10 18:00+05:30', 2) = '2026-10-14 00:00+05:30',
  'Saturday request is due by the end of Tuesday');
insert into public.holidays (day, name) values ('2026-10-12', 'Test holiday');
select pg_temp.check(private.add_business_days('2026-10-09 10:00+05:30', 2) = '2026-10-14 00:00+05:30',
  'a holiday on Monday moves the due date to Tuesday');
delete from public.holidays;

-- UPI ID -----------------------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select public.request_redemption(1000)$$, 'add your upi id', 'a UPI ID is needed first');
select pg_temp.refused($$select public.save_upi('not-an-upi')$$, 'like name@okicici', 'UPI ID format is checked');
select pg_temp.refused($$select public.save_upi('abc@123')$$, 'like name@okicici', 'the bank handle must start with a letter');
select pg_temp.check((public.save_upi(' Anjali.M@OkIcici ') ->> 'upi_id') = 'anjali.m@okicici',
  'UPI ID is saved trimmed and in small letters');
select pg_temp.check((public.my_upi() ->> 'usable_from')::timestamptz <= now(), 'a first UPI ID can be used straight away');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select pg_temp.check(public.my_upi() is null, 'customers cannot see each other''s UPI IDs');
select pg_temp.check((select count(*) from public.customer_upi) = 0, 'customer_upi rows are private');
reset role;

-- Amount rules -----------------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select public.request_redemption(500)$$, 'at least 1000 points', 'under 1,000 points is refused');
select pg_temp.refused($$select public.request_redemption(1500)$$, 'steps of 1000', 'not a multiple of 1,000 is refused');
select pg_temp.refused($$select public.request_redemption(4000)$$, 'enough points', 'more than the balance is refused');
insert into ids select 'r1', public.request_redemption(2000);
select pg_temp.check((public.points_wallet() ->> 'balance')::int = 1200,
  'requested points are on hold, not usable (3,200 - 2,000 = 1,200 usable)');
select pg_temp.check((public.points_wallet() ->> 'on_hold')::int = 2000, 'wallet shows 2,000 points on hold');
select pg_temp.check((select kind = 'redeem_pending' and points = -2000 from public.my_points_history() limit 1),
  'history shows the cash-out as pending, not cashed out');
select pg_temp.check((select array_agg(points_remaining order by expires_at) from public.points_ledger
                      where kind = 'earn' and customer_id = '00000000-0000-0000-0000-0000000000c1') = array[0, 0, 1200],
  'the oldest batches are used first (800 + 900 + 300)');
select pg_temp.check((select amount = 2000 and upi_id = 'anjali.m@okicici' and status = 'requested'
                      and due_at > requested_at + interval '1 day' from public.my_redemptions()),
  'request shows ₹2,000 to the saved UPI ID with a 2-business-day due date');
select pg_temp.refused($$select public.request_redemption(1000)$$, 'already have a cash-out waiting',
  'one open cash-out at a time');
select pg_temp.refused($$select public.save_upi('other@ybl')$$, 'cash-out waiting',
  'the UPI ID cannot be changed while a cash-out is waiting');
select pg_temp.check((select count(*) from public.notifications where title = 'Cash-out requested: ₹2,000') = 1,
  'customer is told the cash-out was requested');
update public.redemptions set amount = 99999;
select pg_temp.check((select amount from public.redemptions) = 2000, 'customers cannot change a cash-out');
select pg_temp.refused($$select * from public.admin_redemptions()$$, 'not allowed', 'customers cannot open the payout queue');
select pg_temp.refused($$select public.mark_redemption_paid((select id from ids where name = 'r1'), 'UTR123456')$$,
  'not allowed', 'customers cannot mark a cash-out paid');
reset role;

-- Held points cannot expire while the cash-out waits
update public.points_ledger set expires_at = now() - interval '1 hour'
  where customer_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'earn' and points in (800, 900);
select public.points_daily();
select pg_temp.check(not exists (select 1 from public.points_ledger
                                 where customer_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'expire'),
  'points on hold are not expired by the nightly job');
update public.points_ledger set expires_at = now() + interval '10 days'
  where customer_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'earn' and points in (800, 900);

-- Customer 2 uses the same UPI ID -> flag (not a limit)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.save_upi('anjali.m@okicici');
insert into ids select 'r2', public.request_redemption(1000);
reset role;

-- Admin pays and rejects ---------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select array_agg(id order by ord) = array[(select id from ids where name = 'r1'), (select id from ids where name = 'r2')]
                      from (select id, row_number() over () as ord from public.admin_redemptions()) q),
  'payout queue shows the oldest request first');
select pg_temp.check((select bool_and(upi_other_accounts = 1) from public.admin_redemptions()),
  'queue flags a UPI ID used on another account');
select pg_temp.refused($$select public.mark_redemption_paid((select id from ids where name = 'r1'), 'abc')$$,
  'transaction id', 'a UTR is needed to mark paid');
select public.mark_redemption_paid((select id from ids where name = 'r1'), ' 4123 5678 9012 ');
select pg_temp.check((select status = 'paid' and utr = '412356789012' and decided_by = '00000000-0000-0000-0000-0000000000a1'
                      from public.redemptions where id = (select id from ids where name = 'r1')), 'admin marks a cash-out paid with the UTR');
select pg_temp.refused($$select public.reject_redemption((select id from ids where name = 'r1'), 'oops')$$,
  'already paid', 'a paid cash-out cannot be rejected');
select pg_temp.refused($$select public.reject_redemption((select id from ids where name = 'r2'), ' ')$$,
  'give a reason', 'rejecting needs a reason');
reset role;

-- give customer 2's batch an earlier expiry to check it comes back with it
update public.points_ledger set expires_at = now() + interval '33 days'
  where customer_id = '00000000-0000-0000-0000-0000000000c2' and kind = 'earn';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.reject_redemption((select id from ids where name = 'r2'), 'UPI ID belongs to someone else');
select pg_temp.check((select count(*) from public.admin_audit_log where table_name = 'redemptions') = 2,
  'payout decisions are in the audit log');
select pg_temp.check((select count(*) from public.admin_redemptions('requested')) = 0, 'payout queue is empty');
reset role;

select pg_temp.check(private.points_balance('00000000-0000-0000-0000-0000000000c2') = 1200,
  'rejecting releases the hold');
select pg_temp.check((select points_remaining = 1200 and expires_at::date = (now() + interval '33 days')::date
                      from public.points_ledger
                      where customer_id = '00000000-0000-0000-0000-0000000000c2' and kind = 'earn'),
  'released points go back into their own batch with its original expiry');
select pg_temp.check((select sum(l.points) from public.points_ledger l
                      left join public.redemptions x on x.debit_id = l.id
                      where l.customer_id = '00000000-0000-0000-0000-0000000000c2' and x.status is distinct from 'rejected')
                     = (select sum(points_remaining) from public.points_ledger where customer_id = '00000000-0000-0000-0000-0000000000c2'),
  'ledger total (without released holds) = points left in batches');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select utr from public.my_redemptions() where status = 'paid') = '412356789012', 'customer sees the UTR');
select pg_temp.check((select kind = 'redeem' and points = -2000 and note = 'UTR 412356789012'
                      from public.my_points_history() where kind like 'redeem%' limit 1),
  'once paid, history shows "cashed out -2,000" with the UTR');
select pg_temp.check((select count(*) from public.notifications where title = 'Cash-out sent: ₹2,000'
                      and body like '%UTR%412356789012%') = 1, 'customer is told the money was sent, with the UTR');
-- changing the UPI ID after the payout: usable after 24 hours
select pg_temp.check((public.save_upi('anjali@ybl') ->> 'usable_from')::timestamptz > now() + interval '23 hours',
  'a changed UPI ID can be used after 24 hours');
select pg_temp.refused($$select public.request_redemption(1000)$$, '24 hours', 'cash-out to a just-changed UPI ID is refused');
reset role;
update public.customer_upi set changed_at = now() - interval '25 hours' where user_id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check(public.request_redemption(1000) > 0, 'after 24 hours the new UPI ID works');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select pg_temp.check((select count(*) from public.notifications where title = 'Cash-out not sent'
                      and body like '%someone else%no longer on hold%') = 1, 'customer is told why, and that the points are free again');
select pg_temp.check((select count(*) from public.my_redemptions()) = 1, 'customers see only their own cash-outs');
select pg_temp.check((select count(*) from public.my_points_history() where kind like 'redeem%') = 0,
  'a rejected cash-out leaves nothing in the history');
select pg_temp.check((public.points_wallet() ->> 'on_hold')::int = 0, 'nothing on hold after a rejection');
reset role;

-- Report -----------------------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select points_redeemed = 2000 and rupees_paid = 2000 and payouts = 1 and points_pending = 1000
                      from public.points_report(3) limit 1), 'report shows this month''s payouts and pending');
select pg_temp.check((select count(*) from public.points_report(3)) = 3, 'report has one row per month');
insert into public.holidays (day, name) values ('2026-12-25', 'Christmas');
select pg_temp.check(exists (select 1 from public.admin_audit_log where table_name = 'holidays'), 'holiday changes are audited');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select * from public.points_report()$$, 'not allowed', 'customers cannot see the report');
select pg_temp.refused($$insert into public.holidays (day, name) values ('2026-12-31', 'x')$$, 'row-level security',
  'customers cannot add holidays');
reset role;

rollback;
