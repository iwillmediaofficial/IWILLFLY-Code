-- Customer points step A gate: bills, checks, approval, ledger, expiry, alerts and RLS. LOCAL database only:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/points_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', '{"full_name":"Anjali Menon"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'c3@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'POINTS TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs sql and passes when it raises an error whose message contains `expect`.
create function pg_temp.refused(sql text, expect text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'POINTS TEST FAILED: % (was accepted)', what;
exception when others then
  if sqlerrm like 'POINTS TEST FAILED%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'POINTS TEST FAILED: % (wrong error: %)', what, sqlerrm;
  end if;
  raise notice 'ok - %', what;
end $$;

-- A photo key as the upload Worker makes it: bills/<customer id>/<sha256>.webp
create function pg_temp.photo(uid text, seed text) returns text language sql as $$
  select 'bills/' || uid || '/' || md5(seed) || md5(seed || '#') || '.webp'
$$;

-- Ids kept outside RLS so later steps can refer to them
create temp table ids (name text primary key, id bigint);
grant all on ids to authenticated, anon;

-- Two vendors, each with a shop; vendor 2 is not approved, so its shop is not listed
insert into public.vendors (owner_id, business_name, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Lulu Fashion', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'Fresh Mart', 'pending');
insert into public.shops (vendor_id, name)
  select id, 'Lulu Kochi' from public.vendors where business_name = 'Lulu Fashion';
insert into public.shops (vendor_id, name)
  select id, 'Fresh Mart Aluva' from public.vendors where business_name = 'Fresh Mart';
insert into ids select 'shop', id from public.shops where name = 'Lulu Kochi';
insert into ids select 'unlisted', id from public.shops where name = 'Fresh Mart Aluva';

-- Settings ------------------------------------------------------------------------------------------

select pg_temp.act_as(null);
set local role anon;
select pg_temp.check((select rupees_per_point = 50 and point_value = 1 and min_redeem_points = 1000
                             and redeem_step_points = 1000 and validity_months = 6 and bill_age_days = 7
                      from public.points_settings), 'anyone can read the default points rules');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
update public.points_settings set rupees_per_point = 1;
select pg_temp.check((select rupees_per_point from public.points_settings) = 50, 'customers cannot change the rules');
select pg_temp.refused($$select private.spend_points('00000000-0000-0000-0000-0000000000c1', 1, 'redeem', 'x')$$,
  'permission denied', 'customers cannot spend points directly');
select pg_temp.refused($$insert into public.points_ledger (customer_id, kind, points, points_remaining, expires_at)
  values ('00000000-0000-0000-0000-0000000000c1', 'earn', 999, 999, now() + interval '1 year')$$,
  'row-level security', 'customers cannot write points');
select pg_temp.refused($$insert into public.bill_submissions (customer_id, shop_id, bill_number, bill_date, amount, photo_key)
  values ('00000000-0000-0000-0000-0000000000c1', (select id from ids where name = 'shop'), 'Z9', private.today_ist(), 100,
          pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'z9'))$$,
  'row-level security', 'customers cannot insert bills directly');
reset role;

-- Bill checks -----------------------------------------------------------------------------------------

select pg_temp.act_as(null);
set local role anon;
select pg_temp.refused($$select public.points_wallet()$$, 'permission denied', 'signed-out visitors have no wallet');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) = 1 and bool_and(name = 'Lulu Kochi') from public.points_shops(null)),
  'shop picker lists only live shops');
select pg_temp.check((select count(*) = 1 from public.points_shops('lulu')) and
                     (select count(*) = 0 from public.points_shops('fresh')), 'shop picker searches by name');
select pg_temp.check(public.check_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist(), 275) = 5,
  '₹275 bill would earn 5 points');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist(), 49.99)$$,
  'under ₹50', 'bill under ₹50 is refused with a message');
select pg_temp.check(public.check_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist(), 50) = 1,
  'exactly ₹50 earns 1 point');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist() - 8, 500)$$,
  'within 7 days', 'bill older than 7 days is refused with a message');
select pg_temp.check(public.check_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist() - 7, 500) = 10,
  'bill exactly 7 days old is accepted');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist() + 1, 500)$$,
  'future', 'bill dated tomorrow is refused');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'unlisted'), 'A-1', private.today_ist(), 500)$$,
  'listed on IWILLFLY', 'bill from a shop not listed on IWILLFLY is refused');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), ' - ', private.today_ist(), 500)$$,
  'bill number', 'bill without a bill number is refused');
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist(), 500,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c2', 'someone-else'))$$,
  'photo', 'a photo uploaded by someone else cannot be used');
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'A-1', private.today_ist(), 500,
  'shops/2026-10/x.webp')$$, 'photo', 'a public media key is not accepted as a bill photo');
reset role;

-- the vendor cannot earn on their own shop
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'OWN-1', private.today_ist(), 5000)$$,
  'your own shop', 'vendors cannot earn points on their own shop');
reset role;

-- Customer 1 adds 20 bills ----------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into ids
select 'bill' || n,
  public.submit_bill((select id from ids where name = 'shop'), 'INV-' || n, private.today_ist() - (n % 8),
                     ((array[50, 99.99, 100, 275, 2400, 49999.99, 50000, 1234.5, 75, 51]::numeric[])[1 + (n - 1) % 10])
                       + case when n > 10 then 1000 else 0 end,
                     pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'bill' || n),
                     md5('src' || n) || md5('src' || n || '#'))
from generate_series(1, 20) n;
select pg_temp.check((select count(*) from public.my_bills() where status = 'pending') = 20, '20 bills are waiting for checking');
select pg_temp.check((public.points_wallet() ->> 'pending_bills')::int = 20, 'wallet shows 20 pending bills');

-- duplicates
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'inv 1', private.today_ist() - 1, 999,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'other'))$$,
  'already been added', 'same shop + bill number (any spacing or case) + date is refused');
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'NEW-1', private.today_ist(), 999,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'bill1'))$$,
  'photo has already been used', 'exact same photo is refused');
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'NEW-2', private.today_ist(), 999,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'resized-differently'), md5('src1') || md5('src1#'))$$,
  'photo has already been used', 'same original file resized differently is refused');
select pg_temp.check(public.check_bill((select id from ids where name = 'shop'), 'INV-1', private.today_ist() - 2, 999) = 19,
  'same bill number on another date is a different bill');
reset role;

-- another customer cannot claim the same bill or reuse the photo
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'INV-2', private.today_ist() - 2, 99.99,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c2', 'c2-a'))$$,
  'already been added', 'another customer cannot claim the same bill');
select pg_temp.check((select count(*) from public.bill_submissions) = 0, 'customers see only their own bills');
select pg_temp.check((select count(*) from public.my_bills()) = 0, 'my_bills is empty for another customer');
select pg_temp.refused($$select * from public.admin_bills()$$, 'not allowed', 'customers cannot open the admin queue');
select pg_temp.refused($$select public.approve_bill((select id from ids where name = 'bill1'))$$, 'not allowed',
  'customers cannot approve bills');
reset role;

-- Admin approves 15 and rejects 5 -------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select count(*) from public.admin_bills('pending')) = 20, 'admin sees all 20 pending bills');
select pg_temp.check((select array_agg(id order by ord) = (select array_agg(id order by id) from public.bill_submissions)
                      from (select id, row_number() over () as ord from public.admin_bills('pending')) q),
  'queue shows the oldest bill first');
select pg_temp.check((select customer_email = 'c1@test.local' and customer_name = 'Anjali Menon' and same_shop_week = 1
                      from public.admin_bills('pending') limit 1), 'queue shows who sent the bill and how many from that shop');

select public.approve_bill(id) from ids where name in ('bill1','bill2','bill3','bill4','bill5','bill6','bill7','bill8',
  'bill9','bill10','bill11','bill12','bill13','bill14');
select public.approve_bill((select id from ids where name = 'bill15'), 2000);   -- corrected from ₹2,400 + 1000
select public.reject_bill(id, 'blurry', 'Total not visible') from ids where name = 'bill16';
select public.reject_bill(id, 'wrong_shop') from ids where name = 'bill17';
select public.reject_bill(id, 'duplicate') from ids where name = 'bill18';
select public.reject_bill(id, 'amount_mismatch') from ids where name = 'bill19';
select public.reject_bill(id, 'blurry') from ids where name = 'bill20';
select pg_temp.refused($$select public.approve_bill((select id from ids where name = 'bill1'))$$, 'already approved',
  'a bill cannot be approved twice');
select pg_temp.refused($$select public.reject_bill((select id from ids where name = 'bill2'), 'blurry')$$, 'already approved',
  'an approved bill cannot be rejected');
select pg_temp.refused($$select public.reject_bill((select id from ids where name = 'bill1'), 'looks fake')$$, 'pick a reason',
  'rejecting needs a reason from the list');
select pg_temp.check((select count(*) from public.admin_bills('pending')) = 0, 'queue is empty');
select pg_temp.check((select count(*) from public.admin_audit_log where table_name = 'bill_submissions') = 20,
  'every approval and rejection is in the audit log');
reset role;

-- points match amount ÷ 50, rounded down, for every approved bill
select pg_temp.check(not exists (select 1 from public.bill_submissions
                                 where status = 'approved' and points <> floor(approved_amount / 50)),
  'points = amount ÷ 50 rounded down for every approved bill');
select pg_temp.check((select points from public.bill_submissions where id = (select id from ids where name = 'bill15')) = 40,
  'corrected amount ₹2,000 earns 40 points');
select pg_temp.check((select array_agg(points order by b.id) from public.bill_submissions b where b.id in
                       (select id from ids where name in ('bill1','bill2','bill3','bill4','bill5','bill6','bill7','bill8','bill9','bill10')))
                     = array[1, 1, 2, 5, 48, 999, 1000, 24, 1, 1],
  '₹50=1, ₹99.99=1, ₹100=2, ₹275=5, ₹2,400=48, ₹49,999.99=999, ₹50,000=1,000, ₹1,234.50=24, ₹75=1, ₹51=1');
select pg_temp.check((select count(*) from public.points_ledger where kind = 'earn') = 15, 'one points batch per approved bill');
select pg_temp.check(not exists (select 1 from public.points_ledger where kind = 'earn'
                                 and (points_remaining <> points
                                      or expires_at::date <> (created_at + interval '6 months')::date)),
  'each batch expires 6 months after it was credited, with all points left');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select sum(points) from public.bill_submissions where status = 'approved')
                     = (public.points_wallet() ->> 'balance')::int, 'wallet balance = sum of approved bills');
select pg_temp.check((public.points_wallet() ->> 'value')::numeric = (public.points_wallet() ->> 'balance')::numeric,
  'points are worth ₹1 each');
select pg_temp.check((public.points_wallet() ->> 'pending_bills')::int = 0, 'nothing pending after checking');
select pg_temp.check((select count(*) from public.my_points_history() where kind = 'earn') = 15, 'history lists every credit');
select pg_temp.check((select count(*) from public.notifications where kind = 'points' and title like 'Bill approved%') = 15,
  'an alert for every approved bill');
select pg_temp.check((select count(*) from public.notifications where kind = 'points' and title = 'Bill not approved') = 5,
  'an alert for every rejected bill');
select pg_temp.check((select count(*) from public.notifications where title like 'You reached 1,000 points%') = 1,
  'one "reached 1,000 points" alert');
select pg_temp.check((select body like '%₹2,000 bill%corrected from ₹3,400%' from public.notifications
                      where body like '%corrected%'), 'alert says the amount was corrected');
select pg_temp.check((select link = '/points/add?fix=' || (select id from ids where name = 'bill16')
                      from public.notifications where body like '%blurry%Total not visible%'),
  'rejected alert gives the reason and links to fix it');
select pg_temp.check((select link from public.notifications where body like '%already added%') = '/points/bills',
  'a duplicate cannot be fixed');
select pg_temp.check((select bool_and(can_resubmit = (id <> (select id from ids where name = 'bill18')))
                      from public.my_bills() where status = 'rejected'), 'rejected bills (except duplicates) can be fixed');

-- Fix and send again, once
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'INV-1', private.today_ist() - 1, 50,
  (select id from ids where name = 'bill1'))$$, 'only a rejected bill', 'an approved bill cannot be sent again');
-- a fixed amount with the same photo is fine
insert into ids select 'fix19', public.submit_bill((select id from ids where name = 'shop'), 'INV-19', private.today_ist() - 3, 1200,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'bill19'), md5('src19') || md5('src19#'),
  (select id from ids where name = 'bill19'));
select pg_temp.check((select resubmit_of from public.bill_submissions where id = (select id from ids where name = 'fix19'))
                     = (select id from ids where name = 'bill19'), 'a rejected bill is sent again with its fix');
select pg_temp.refused($$select public.submit_bill((select id from ids where name = 'shop'), 'INV-19', private.today_ist() - 3, 1300,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'bill19b'), null, (select id from ids where name = 'bill19'))$$,
  'already sent again once', 'a bill can be sent again only once');
reset role;

-- the fixed bill is rejected again: no more chances
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select resubmit_of = (select id from ids where name = 'bill19') and previous_reason = 'amount_mismatch'
                      from public.admin_bills('pending')), 'queue shows a fixed bill with the earlier reason');
select public.reject_bill((select id from ids where name = 'fix19'), 'amount_mismatch');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select not can_resubmit from public.my_bills() where id = (select id from ids where name = 'fix19')),
  'a fixed bill rejected again cannot be sent a third time');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'INV-19', private.today_ist() - 3, 1200,
  (select id from ids where name = 'fix19'))$$, 'already sent again once', 'resubmitting a resubmission is refused');
reset role;
-- a rejected bill decided too long ago cannot be fixed
update public.bill_submissions set decided_at = now() - interval '8 days' where id = (select id from ids where name = 'bill16');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'INV-16', private.today_ist(), 1000,
  (select id from ids where name = 'bill16'))$$, 'within 7 days', 'a bill rejected over 7 days ago cannot be fixed');
reset role;

-- Spending (step B uses this) takes the oldest points first ----------------------------------------------

update public.points_ledger set expires_at = now() + interval '1 day' * id
  where kind = 'earn';  -- batches now expire one day apart, oldest first
select private.spend_points('00000000-0000-0000-0000-0000000000c1', 3, 'redeem', 'test');
select pg_temp.check((select array_agg(points_remaining order by expires_at) from
                      (select points_remaining, expires_at from public.points_ledger where kind = 'earn'
                       order by expires_at limit 3) q) = array[0, 0, 1], 'spending takes the oldest batches first');
select pg_temp.check((select points from public.points_ledger where kind = 'redeem') = -3, 'spending is one debit row');
do $$ begin
  perform private.spend_points('00000000-0000-0000-0000-0000000000c1', 1000000, 'redeem', 'too much');
  raise exception 'POINTS TEST FAILED: overspend accepted';
exception when others then
  if sqlerrm like 'POINTS TEST FAILED%' then raise; end if;
  raise notice 'ok - cannot spend more than the balance';
end $$;
select pg_temp.check((select sum(points) from public.points_ledger where customer_id = '00000000-0000-0000-0000-0000000000c1')
                     = (select sum(points_remaining) from public.points_ledger where customer_id = '00000000-0000-0000-0000-0000000000c1'),
  'ledger total = points left in batches');

-- Expiry and alerts ---------------------------------------------------------------------------------------

delete from public.notifications;
-- batch A expired yesterday, B expires in 5 days, C in 20 days, the rest later
update public.points_ledger set expires_at = now() - interval '1 day'
  where id = (select id from public.points_ledger where kind = 'earn' and points_remaining > 0 order by id limit 1);
update public.points_ledger set expires_at = now() + interval '5 days'
  where id = (select id from public.points_ledger where kind = 'earn' and points_remaining > 0 and expires_at > now() order by id limit 1);
update public.points_ledger set expires_at = now() + interval '20 days'
  where id = (select id from public.points_ledger where kind = 'earn' and points_remaining > 0
              and expires_at > now() + interval '6 days' order by id limit 1);
update public.points_ledger set expires_at = now() + interval '60 days'
  where kind = 'earn' and expires_at > now() + interval '21 days';
create temp table before_job as
  select private.points_balance('00000000-0000-0000-0000-0000000000c1') as bal,
         (select points_remaining from public.points_ledger where kind = 'earn' and expires_at < now()) as gone;
select pg_temp.check(public.points_daily() = '{"warnings": 2, "expired_batches": 1}', 'nightly job expires 1 batch and sends 2 alerts');
select pg_temp.check((select points from public.points_ledger where kind = 'expire') = -(select gone from before_job),
  'expired leftovers are written to the ledger');
select pg_temp.check(not exists (select 1 from public.points_ledger where expires_at < now() and points_remaining > 0),
  'no expired points are left in batches');
select pg_temp.check(private.points_balance('00000000-0000-0000-0000-0000000000c1') = (select bal from before_job),
  'expiring old points does not change the usable balance');
select pg_temp.check((select count(*) from public.notifications where title like '%expire this week') = 1, '7-day expiry alert sent');
select pg_temp.check((select count(*) from public.notifications where title like '%expire in 30 days') = 1, '30-day expiry alert sent');
select pg_temp.check(public.points_daily() = '{"warnings": 0, "expired_batches": 0}', 'running the job again sends nothing twice');
update public.points_ledger set expires_at = now() + interval '6 days' where expires_at between now() + interval '19 days' and now() + interval '21 days';
select pg_temp.check(public.points_daily() = '{"warnings": 1, "expired_batches": 0}', 'the 30-day batch gets its 7-day alert later');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((public.points_wallet() -> 'next_expiry' ->> 'points')::int > 0, 'wallet shows the next points to expire');
select pg_temp.check((select count(*) from public.my_points_history() where kind = 'expire') = 1, 'history shows the expiry');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select pg_temp.check((select count(*) from public.points_ledger) = 0, 'customers see only their own points');
select pg_temp.check((public.points_wallet() ->> 'balance')::int = 0, 'a new customer has 0 points');
reset role;

-- Photo clean-up (Worker, service role) ------------------------------------------------------------------

set local role authenticated;
select pg_temp.refused($$select public.bill_photos_due()$$, 'permission denied', 'app users cannot list photos to delete');
reset role;
update public.bill_submissions set decided_at = now() - interval '91 days'
  where id in (select id from ids where name in ('bill1', 'bill19'));
set local role service_role;
select pg_temp.check((select array_agg(k) from public.bill_photos_due() k)
                     = array[pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'bill1')],
  'photos are deleted 90 days after the decision, but not while a fixed bill still uses them');
select pg_temp.check(public.mark_bill_photos_deleted(array[pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'bill1')]) = 1,
  'deleted photos are marked');
select pg_temp.check((select count(*) from public.bill_photos_due()) = 0, 'a deleted photo is not listed again');
reset role;

-- Admin settings ------------------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.points_settings set rupees_per_point = 100, bill_age_days = 3;
select pg_temp.check((select rupees_per_point from public.points_settings) = 100, 'admins change the rules');
select pg_temp.check(exists (select 1 from public.admin_audit_log where table_name = 'points_settings'), 'rule changes are audited');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
set local role authenticated;
select pg_temp.check(public.check_bill((select id from ids where name = 'shop'), 'NEW', private.today_ist(), 275) = 2,
  'new earn rate applies to new bills');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'NEW', private.today_ist(), 99)$$,
  'under ₹100', 'the minimum bill follows the earn rate');
select pg_temp.refused($$select public.check_bill((select id from ids where name = 'shop'), 'NEW', private.today_ist() - 4, 500)$$,
  'within 3 days', 'the bill age limit follows the settings');
reset role;

-- A vendor whose shop has customer bills cannot be deleted (the bills back customers' points)
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'super_admin');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.refused($$select public.admin_delete_vendor((select vendor_id from public.shops
                                                            where id = (select id from ids where name = 'shop')))$$,
  'block the vendor instead', 'a vendor with customer bills cannot be deleted');
reset role;

select pg_temp.check(private.rupees(1234567.5) = '₹12,34,567.50' and private.rupees(50) = '₹50'
  and private.rupees(999) = '₹999' and private.rupees(1000) = '₹1,000' and private.points_text(1000) = '1,000 points'
  and private.points_text(100000) = '1,00,000 points' and private.points_text(1) = '1 point',
  'rupees and points read the Indian way');
rollback;
