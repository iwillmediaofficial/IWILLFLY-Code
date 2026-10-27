-- Top Picks: buying, first come first shown, the waiting list, renewing on time (UPI too), losing the place,
-- reminders, branch managers, swapping the offer, the customer's row by district, and admin removal.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/top_picks_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'owner2@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'owner3@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'customer@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor'),
  ('00000000-0000-0000-0000-0000000000b3', 'vendor'),
  ('00000000-0000-0000-0000-0000000000d1', 'vendor');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'TOP PICKS TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
end $$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;
grant execute on function pg_temp.check(boolean, text), pg_temp.err(text) to authenticated;

-- Kerala > Ernakulam (Kakkanad) and Thrissur (Round) ---------------------------------------------------------
insert into public.locations (kind, name, slug) values ('state', 'Kerala', 'kerala-tp');
insert into public.locations (kind, name, slug, parent_id) values
  ('district', 'Ernakulam', 'ernakulam-tp', (select id from public.locations where slug = 'kerala-tp')),
  ('district', 'Thrissur', 'thrissur-tp', (select id from public.locations where slug = 'kerala-tp'));
insert into public.locations (kind, name, slug, parent_id) values
  ('city', 'Kochi', 'kochi-tp', (select id from public.locations where slug = 'ernakulam-tp'));
insert into public.locations (kind, name, slug, parent_id) values
  ('area', 'Kakkanad', 'kakkanad-tp', (select id from public.locations where slug = 'kochi-tp')),
  ('area', 'Round', 'round-tp', (select id from public.locations where slug = 'thrissur-tp'));
insert into ids select 'ekm', id from public.locations where slug = 'ernakulam-tp';
insert into ids select 'tsr', id from public.locations where slug = 'thrissur-tp';
insert into ids select 'kak', id from public.locations where slug = 'kakkanad-tp';
insert into ids select 'round', id from public.locations where slug = 'round-tp';

-- Three approved businesses on a free plan; the first has branches in both districts.
insert into public.vendors (owner_id, business_name, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Brand One', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'Shop Two', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'Shop Three', 'approved');
insert into public.shops (vendor_id, name) select id, business_name from public.vendors
  where business_name in ('Brand One', 'Shop Two', 'Shop Three');
insert into ids select 'shop1', id from public.shops where name = 'Brand One';
insert into ids select 'shop2', id from public.shops where name = 'Shop Two';
insert into ids select 'shop3', id from public.shops where name = 'Shop Three';
insert into public.branches (shop_id, name, location_id) values
  ((select v from ids where k = 'shop1'), 'Kakkanad', (select v from ids where k = 'kak')),
  ((select v from ids where k = 'shop1'), 'Round', (select v from ids where k = 'round')),
  ((select v from ids where k = 'shop2'), 'Main branch', (select v from ids where k = 'kak')),
  ((select v from ids where k = 'shop3'), 'Main branch', (select v from ids where k = 'kak'));
insert into ids select 'b1_kak', id from public.branches where shop_id = (select v from ids where k = 'shop1') and name = 'Kakkanad';
insert into ids select 'b1_tsr', id from public.branches where shop_id = (select v from ids where k = 'shop1') and name = 'Round';
insert into public.offers (shop_id, title, status, ends_on) values
  ((select v from ids where k = 'shop1'), 'Brand sale', 'approved', null),
  ((select v from ids where k = 'shop1'), 'Brand short sale', 'approved', private.today_ist() + 5),
  ((select v from ids where k = 'shop1'), 'Brand pending', 'pending', null),
  ((select v from ids where k = 'shop2'), 'Two sale', 'approved', null),
  ((select v from ids where k = 'shop3'), 'Three sale', 'approved', null);
insert into ids select 'o1', id from public.offers where title = 'Brand sale';
insert into ids select 'o1_short', id from public.offers where title = 'Brand short sale';
insert into ids select 'o1_pending', id from public.offers where title = 'Brand pending';
insert into ids select 'o2', id from public.offers where title = 'Two sale';
insert into ids select 'o3', id from public.offers where title = 'Three sale';
-- Brand One's Thrissur branch manager.
insert into public.vendor_staff (vendor_id, user_id, role, branch_id)
  values ((select vendor_id from public.shops where id = (select v from ids where k = 'shop1')),
          '00000000-0000-0000-0000-0000000000d1', 'manager', (select v from ids where k = 'b1_tsr'));
update public.profiles set location_id = (select v from ids where k = 'kak')
  where id = '00000000-0000-0000-0000-0000000000c1';
insert into ids select 'len7', id from public.top_pick_lengths where days = 7;
insert into ids select 'len15', id from public.top_pick_lengths where days = 15;

select pg_temp.check(private.district_of((select v from ids where k = 'kak')) = (select v from ids where k = 'ekm'),
  'an area finds its district through its city');
select pg_temp.check(not (select is_active from public.addons where kind = 'promoted_offer' limit 1) or
                     not exists (select 1 from public.addons where kind = 'promoted_offer'),
  'the old Promoted offer add-on is no longer sold');

-- Switched off at first ----------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o1'),
  (select v from ids where k = 'ekm'), (select v from ids where k = 'len7'))$$) like 'Top Picks is not open%',
  'nothing can be bought while Top Picks is switched off');
reset role;

-- Admin opens it: 2 places per district, 7 days for Rs 100, 15 days for Rs 180.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.top_pick_settings set enabled = true, places_per_district = 2;
update public.top_pick_lengths set price = 100, is_active = true where days = 7;
update public.top_pick_lengths set price = 180, is_active = true where days = 15;
reset role;

-- Buying ----------------------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o1_pending'),
  (select v from ids where k = 'ekm'), (select v from ids where k = 'len7'))$$) like 'Only approved offers%',
  'an offer still waiting for approval cannot be a Top Pick');
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o1_short'),
  (select v from ids where k = 'ekm'), (select v from ids where k = 'len7'))$$) like 'The offer ends on%',
  'a sponsorship cannot run past the offer''s end date');
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o2'),
  (select v from ids where k = 'ekm'), (select v from ids where k = 'len7'))$$) is not null,
  'nobody can sponsor another business''s offer');
select pg_temp.check(jsonb_array_length((public.my_top_picks()->'offers'->0->'districts')) = 2
                     or jsonb_array_length((public.my_top_picks()->'offers'->1->'districts')) = 2,
  'the owner can pick either district their offer is in');
insert into ids select 'inv1', public.buy_top_pick((select v from ids where k = 'o1'), (select v from ids where k = 'ekm'),
  (select v from ids where k = 'len7'));
reset role;
insert into ids select 'tp1', id from public.top_picks where offer_id = (select v from ids where k = 'o1')
  and district_id = (select v from ids where k = 'ekm');
select pg_temp.check((select status from public.top_picks where id = (select v from ids where k = 'tp1')) = 'awaiting_payment',
  'a new Top Pick waits for its invoice to be paid');
select pg_temp.check((select subtotal from public.invoices where id = (select v from ids where k = 'inv1')) = 100,
  'the invoice charges the 7-day price');

-- Paying by UPI: live once the admin checks it.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.submit_payment((select v from ids where k = 'inv1'), 'UPI111');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.mark_invoice_paid((select v from ids where k = 'inv1'), 'upi');
reset role;
select pg_temp.check((select status = 'live' and starts_on = private.today_ist() and ends_on = private.today_ist() + 6
                      from public.top_picks where id = (select v from ids where k = 'tp1')),
  'paid: live from today for 7 days');

-- Second shop takes the second place, third goes on the waiting list.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
insert into ids select 'inv2', public.buy_top_pick((select v from ids where k = 'o2'), (select v from ids where k = 'ekm'),
  (select v from ids where k = 'len7'));
reset role;
select private.activate_invoice((select v from ids where k = 'inv2'), 'razorpay', 'pay_2', null);
insert into ids select 'tp2', id from public.top_picks where offer_id = (select v from ids where k = 'o2');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
set local role authenticated;
insert into ids select 'inv3', public.buy_top_pick((select v from ids where k = 'o3'), (select v from ids where k = 'ekm'),
  (select v from ids where k = 'len15'));
reset role;
select pg_temp.check((select description like '%waiting list%' from public.invoice_items
                      where invoice_id = (select v from ids where k = 'inv3')),
  'the invoice says it joins the waiting list when the district is full');
select private.activate_invoice((select v from ids where k = 'inv3'), 'razorpay', 'pay_3', null);
insert into ids select 'tp3', id from public.top_picks where offer_id = (select v from ids where k = 'o3');
select pg_temp.check((select status = 'waiting' and waiting_days = 15 from public.top_picks where id = (select v from ids where k = 'tp3')),
  'a full district puts the paid Top Pick on the waiting list with its days saved');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b3'
                             and title = 'You are on the Top Picks waiting list'), 'the waiting shop is told');

-- The customer's row ----------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select array_agg(offer_id order by ord) from (
                        select offer_id, row_number() over () as ord from public.top_picks_for(null)) x)
                     = array[(select v from ids where k = 'o1'), (select v from ids where k = 'o2')],
  'the customer''s saved area shows its district''s Top Picks, first come first');
select pg_temp.check((select count(*) from public.top_picks_for((select v from ids where k = 'round'))) = 0,
  'another district shows its own (none here)');
select public.track_top_picks('view', array[(select v from ids where k = 'tp1'), (select v from ids where k = 'tp2')]);
select public.track_top_picks('tap', array[(select v from ids where k = 'tp1')]);
select pg_temp.check(pg_temp.err($$select * from public.top_picks$$) is null
                     and (select count(*) from public.top_picks) = 0, 'customers cannot read the sponsorship records');
reset role;
select pg_temp.check((select views = 1 and taps = 1 from public.top_pick_stats_daily where top_pick_id = (select v from ids where k = 'tp1')),
  'views and taps are counted for the vendor');

-- Paused offer: hidden from the row, place kept --------------------------------------------------------------
update public.offers set is_paused = true where id = (select v from ids where k = 'o1');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select array_agg(offer_id) from public.top_picks_for(null)) = array[(select v from ids where k = 'o2')],
  'a paused offer is hidden from the row');
reset role;
select pg_temp.check((select status from public.top_picks where id = (select v from ids where k = 'tp1')) = 'live',
  'a paused offer keeps its place');
update public.offers set is_paused = false where id = (select v from ids where k = 'o1');

-- Renewing keeps the place --------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o1'),
  (select v from ids where k = 'ekm'), (select v from ids where k = 'len7'))$$) like '%Use Renew%',
  'buying the same offer again in the same district points to Renew');
insert into ids select 'inv1r', public.renew_top_pick((select v from ids where k = 'tp1'), (select v from ids where k = 'len7'));
select pg_temp.check(pg_temp.err($$select public.renew_top_pick((select v from ids where k = 'tp1'), (select v from ids where k = 'len7'))$$)
  like 'There is already a renewal invoice%', 'only one renewal invoice at a time');
reset role;
select private.activate_invoice((select v from ids where k = 'inv1r'), 'razorpay', 'pay_1r', null);
select pg_temp.check((select ends_on = private.today_ist() + 13 from public.top_picks where id = (select v from ids where k = 'tp1')),
  'renewal adds the days to the end date');

-- Reminders: 2 days before and on the last day --------------------------------------------------------------
update public.top_picks set ends_on = private.today_ist() + 2 where id = (select v from ids where k = 'tp2');
select public.top_picks_daily();
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2'
                             and title = 'Your Top Pick ends in 2 days'), 'reminder 2 days before the end');
select public.top_picks_daily();
select pg_temp.check((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2'
                      and title = 'Your Top Pick ends in 2 days') = 1, 'each reminder is sent once');
update public.top_picks set ends_on = private.today_ist() where id = (select v from ids where k = 'tp2');
select public.top_picks_daily();
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2'
                             and title = 'Your Top Pick ends today'), 'reminder on the last day');

-- A UPI renewal sent on the last day and checked later keeps the place ---------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
insert into ids select 'inv2r', public.renew_top_pick((select v from ids where k = 'tp2'), (select v from ids where k = 'len7'));
select public.submit_payment((select v from ids where k = 'inv2r'), 'UPI222');
reset role;
update public.top_picks set ends_on = private.today_ist() - 1 where id = (select v from ids where k = 'tp2');
update public.invoices set submitted_at = now() - interval '1 day' where id = (select v from ids where k = 'inv2r');
select public.top_picks_daily();
select pg_temp.check((select status from public.top_picks where id = (select v from ids where k = 'tp2')) = 'live',
  'a UPI renewal sent before the end keeps the place while it is checked');
select pg_temp.check((select status from public.top_picks where id = (select v from ids where k = 'tp3')) = 'waiting',
  'the waiting shop keeps waiting meanwhile');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.mark_invoice_paid((select v from ids where k = 'inv2r'), 'upi');
reset role;
select pg_temp.check((select status = 'live' and ends_on = private.today_ist() + 6 from public.top_picks
                      where id = (select v from ids where k = 'tp2')),
  'once checked, the renewal continues straight after the old end date');

-- Not renewed: the place goes to the waiting list -----------------------------------------------------------
update public.top_picks set ends_on = private.today_ist() - 1 where id = (select v from ids where k = 'tp2');
select public.top_picks_daily();
select pg_temp.check((select status from public.top_picks where id = (select v from ids where k = 'tp2')) = 'ended',
  'not renewed by the end date: the Top Pick ends');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2'
                             and title = 'Your Top Pick has ended'), 'the shop is told it lost its place');
select pg_temp.check((select status = 'live' and ends_on = private.today_ist() + 14 from public.top_picks
                      where id = (select v from ids where k = 'tp3')),
  'the first on the waiting list goes live with its 15 days');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select array_agg(offer_id) from public.top_picks_for(null))
                     = array[(select v from ids where k = 'o1'), (select v from ids where k = 'o3')],
  'the row now shows the next shop after the first');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.renew_top_pick((select v from ids where k = 'tp2'), (select v from ids where k = 'len7'))$$)
  like '%has ended%', 'an ended Top Pick cannot be renewed; a new one goes to the back');
insert into ids select 'inv2b', public.buy_top_pick((select v from ids where k = 'o2'), (select v from ids where k = 'ekm'),
  (select v from ids where k = 'len7'));
reset role;
select private.activate_invoice((select v from ids where k = 'inv2b'), 'razorpay', 'pay_2b', null);
select pg_temp.check((select status from public.top_picks where offer_id = (select v from ids where k = 'o2')
                      and status in ('waiting', 'live')) = 'waiting', 'starting again joins the back of the line');

-- Branch manager ----------------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o1'),
  (select v from ids where k = 'ekm'), (select v from ids where k = 'len7'))$$) is not null,
  'a branch manager cannot sponsor in another branch''s district');
select pg_temp.check((select count(*) from public.top_picks) = 0, 'a branch manager does not see the owner''s Top Picks');
insert into ids select 'inv_m', public.buy_top_pick((select v from ids where k = 'o1'), (select v from ids where k = 'tsr'),
  (select v from ids where k = 'len7'));
select pg_temp.check((select count(*) from public.invoices where id = (select v from ids where k = 'inv_m')) = 1,
  'the branch manager sees the invoice they made');
select public.submit_payment((select v from ids where k = 'inv_m'), 'UPI-M');
reset role;
select pg_temp.check((public.gateway_invoice_for((select v from ids where k = 'inv_m'),
                       '00000000-0000-0000-0000-0000000000d1', 'instamojo')->>'invoice_id')::bigint
                     = (select v from ids where k = 'inv_m'), 'the branch manager can pay it online too');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.mark_invoice_paid((select v from ids where k = 'inv_m'), 'upi');
reset role;
select pg_temp.check((select status = 'live' and branch_id = (select v from ids where k = 'b1_tsr') from public.top_picks
                      where district_id = (select v from ids where k = 'tsr')), 'the manager''s Top Pick is live in Thrissur');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000d1'
                             and title like 'Payment received%'), 'the manager hears the payment went through');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_managers_can_sponsor(false);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.check(not (public.my_top_picks()->>'allowed')::boolean, 'the owner can stop managers buying');
select pg_temp.check(pg_temp.err($$select public.buy_top_pick((select v from ids where k = 'o1_short'),
  (select v from ids where k = 'tsr'), (select v from ids where k = 'len7'))$$) is not null,
  'a manager cannot buy when the owner switched it off');
reset role;

-- Swapping the offer keeps the place ------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.swap_top_pick_offer((select v from ids where k = 'tp1'), (select v from ids where k = 'o1_short'))$$)
  like 'The offer ends on%', 'cannot swap in an offer that ends before the sponsorship');
update public.offers set ends_on = null where id = (select v from ids where k = 'o1_short');
reset role;
update public.offers set status = 'approved' where id = (select v from ids where k = 'o1_short');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.swap_top_pick_offer((select v from ids where k = 'tp1'), (select v from ids where k = 'o1_short'));
reset role;
select pg_temp.check((select offer_id = (select v from ids where k = 'o1_short') and status = 'live'
                      from public.top_picks where id = (select v from ids where k = 'tp1')),
  'swapping in another approved offer keeps the place');

-- Admin removes one: the next in line moves up --------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.admin_remove_top_pick((select v from ids where k = 'tp3'), '')$$)
  like 'Give a reason%', 'removing needs a reason');
select public.admin_remove_top_pick((select v from ids where k = 'tp3'), 'Wrong picture');
select pg_temp.check(jsonb_array_length(public.admin_top_picks()) >= 4, 'admins see the Top Picks list');
reset role;
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b3'
                             and body like '%Reason: Wrong picture%'), 'the vendor is told why it was removed');
select pg_temp.check((select status from public.top_picks where offer_id = (select v from ids where k = 'o2')
                      and status in ('waiting', 'live')) = 'live', 'the waiting shop takes the freed place');

-- Free days from the admin --------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.offers set ends_on = private.today_ist() + 3 where id = (select v from ids where k = 'o3');
select pg_temp.check(pg_temp.err($$select public.admin_give_top_pick((select v from ids where k = 'o3'), (select v from ids where k = 'ekm'), 5, null)$$)
  like 'The offer ends on%', 'free days cannot run past the offer end date');
update public.offers set ends_on = null where id = (select v from ids where k = 'o3');
select public.admin_give_top_pick((select v from ids where k = 'o3'), (select v from ids where k = 'ekm'), 5, 'Sorry about that');
reset role;
select pg_temp.check((select status = 'waiting' and waiting_days = 5 from public.top_picks
                      where offer_id = (select v from ids where k = 'o3') and status in ('waiting', 'live')),
  'free days from the admin join the line like any other');

-- A cancelled unpaid invoice cancels the new Top Pick -------------------------------------------------------
update public.top_pick_settings set places_per_district = 5;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into ids select 'inv_x', public.buy_top_pick((select v from ids where k = 'o1_short'), (select v from ids where k = 'tsr'),
  (select v from ids where k = 'len7'));
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.void_invoice((select v from ids where k = 'inv_x'), 'Test');
reset role;
select pg_temp.check((select status from public.top_picks t join public.invoice_items it on it.top_pick_id = t.id
                      where it.invoice_id = (select v from ids where k = 'inv_x')) = 'cancelled',
  'cancelling the unpaid invoice cancels the Top Pick');

rollback;
