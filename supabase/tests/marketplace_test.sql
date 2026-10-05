-- Phase 1 gate: marketplace RLS and RPC checks. Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'customer@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor2@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'MARKETPLACE TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Two customers apply as vendors and set up a shop, a branch and an offer each
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(public.apply_as_vendor('Lulu Fashion LLP', '9999999999', '9999999999') is not null, 'customer applies as vendor');
select pg_temp.check(public.apply_as_vendor('Again', '', '') = (select id from public.vendors), 'applying twice returns the same vendor');
select pg_temp.check((select count(*) from public.user_roles where role = 'vendor') = 1, 'applying grants the vendor role');
insert into public.shops (vendor_id, name, category_id)
  select (select id from public.vendors), 'Lulu Fashion', (select id from public.categories where slug = 'textile');
insert into public.branches (shop_id, name, lat, lng, hours)
  select id, 'Edappally', 10.0261, 76.3083, '{"mon":{"open":"09:00","close":"22:00"}}' from public.shops;
insert into public.offers (shop_id, title, discount_label, status, is_featured)
  select id, 'Onam sale', '50% OFF', 'approved', true from public.shops;
select pg_temp.check((select status from public.offers) = 'pending' and not (select is_featured from public.offers),
  'vendor cannot self-approve or feature an offer');
update public.vendors set status = 'approved', is_verified = true;
select pg_temp.check((select status from public.vendors) = 'pending' and not (select is_verified from public.vendors),
  'vendor cannot approve or verify themselves');
update public.vendors set business_name = 'Lulu Fashion Pvt Ltd';
select pg_temp.check((select business_name from public.vendors) = 'Lulu Fashion Pvt Ltd', 'vendor edits own business name');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check(public.apply_as_vendor('Fresh Mart', null, null) is not null, 'second vendor applies');
select pg_temp.check((select count(*) from public.vendors) = 1, 'vendor 2 sees only their own vendor row');
select pg_temp.check((select count(*) from public.shops) = 0, 'vendor 2 cannot see vendor 1 pending shop');
do $$ begin
  insert into public.shops (vendor_id, name) values (
    (select id from public.vendors) - 1, 'Hijack');
  raise exception 'MARKETPLACE TEST FAILED: vendor 2 created a shop for vendor 1';
exception when insufficient_privilege then raise notice 'ok - vendor cannot create shops for another vendor';
end $$;
insert into public.shops (vendor_id, name) select id, 'Fresh Mart' from public.vendors;
insert into public.branches (shop_id, name, lat, lng) select id, 'Aluva', 10.1076, 76.3516 from public.shops;
insert into public.offers (shop_id, title, discount_label) select id, 'Flat 25%', '25% OFF' from public.shops;
reset role;

-- Anonymous visitors see nothing until an admin approves
set local role anon;
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.shops) = 0, 'anon sees no shops of pending vendors');
select pg_temp.check((select count(*) from public.search_shops()) = 0, 'search_shops is empty before approval');
reset role;

-- Admin approves both vendors and only vendor 1's offer
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((public.admin_stats() ->> 'vendors_pending')::int = 2, 'admin stats count pending vendors');
update public.vendors set status = 'approved', is_verified = true;
select pg_temp.check((select count(*) from public.vendors where status = 'approved' and reviewed_by is not null) = 2,
  'admin approves vendors and the reviewer is recorded');
update public.offers set status = 'approved', is_featured = true where title = 'Onam sale';
select pg_temp.check((select reviewed_at from public.offers where title = 'Onam sale') is not null, 'admin approves an offer');
insert into public.malls (name, slug, lat, lng) values ('Grand Mall', 'grand-mall', 10.0270, 76.3080);
insert into public.mall_shops (mall_id, branch_id)
  select (select id from public.malls), b.id from public.branches b where b.name = 'Edappally';
reset role;

set local role anon;
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.shops) = 2, 'anon sees approved vendors'' shops');
select pg_temp.check((select count(*) from public.offers) = 1, 'anon sees only the approved offer');
select pg_temp.check((select count(*) from public.vendors) = 0, 'anon cannot read vendor business details');
select pg_temp.check((select name from public.search_shops(10.1, 76.35) limit 1) = 'Fresh Mart', 'search_shops sorts nearest first (Aluva)');
select pg_temp.check((select name from public.search_shops(10.02, 76.30) limit 1) = 'Lulu Fashion', 'search_shops sorts nearest first (Edappally)');
select pg_temp.check((select round(distance_km::numeric, 1) from public.search_shops(10.0261, 76.3083) limit 1) = 0, 'distance is 0 at the branch');
select pg_temp.check((select count(*) from public.search_shops(p_category => 'textile')) = 1, 'search_shops filters by category');
select pg_temp.check((select count(*) from public.search_shops(p_q => 'onam')) = 1, 'search_shops matches offer titles');
select pg_temp.check((select count(*) from public.search_shops(p_q => 'zzz')) = 0, 'search_shops no match');
select pg_temp.check((select top_offer from public.search_shops(p_q => 'lulu')) = '50% OFF', 'search_shops returns the top offer');
select pg_temp.check((select mall_name from public.search_shops(p_q => 'lulu')) = 'Grand Mall', 'search_shops returns the mall');
select pg_temp.check((select count(*) from public.search_shops(10.1, 76.35, p_mall_id => (select id from public.malls))) = 1,
  'search_shops filters by mall using the branch inside it');
select pg_temp.check((select count(*) from public.search_offers()) = 1, 'search_offers lists live offers');
select pg_temp.check((select shop_count from public.list_malls()) = 1 and (select offer_count from public.list_malls()) = 1,
  'list_malls counts live shops and offers');
do $$ begin
  insert into public.saved_offers (offer_id) select id from public.offers;
  raise exception 'MARKETPLACE TEST FAILED: anon saved an offer';
exception when insufficient_privilege then raise notice 'ok - anon cannot save offers';
end $$;
reset role;

-- Vendor edits: content changes go back to review, pausing does not
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.offers set is_paused = true;
select pg_temp.check((select status from public.offers) = 'approved', 'pausing keeps approval');
update public.offers set is_paused = false;
update public.offers set title = 'Onam mega sale';
select pg_temp.check((select status from public.offers) = 'pending' and not (select is_featured from public.offers),
  'editing an approved offer sends it back to review');
reset role;

-- Vendor 2 cannot touch vendor 1's data
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
update public.shops set name = 'Hacked' where name = 'Lulu Fashion';
update public.offers set title = 'Hacked' where title = 'Onam mega sale';
delete from public.branches where name = 'Edappally';
reset role;
select pg_temp.check((select count(*) from public.shops where name = 'Hacked') = 0, 'vendor cannot rename another vendor''s shop');
select pg_temp.check((select count(*) from public.offers where title = 'Hacked') = 0, 'vendor cannot edit another vendor''s offer');
select pg_temp.check((select count(*) from public.branches where name = 'Edappally') = 1, 'vendor cannot delete another vendor''s branch');

-- Customer saves
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into public.saved_shops (shop_id) select id from public.shops;
select pg_temp.check((select count(*) from public.saved_shops) = 2, 'customer saves shops');
do $$ begin
  insert into public.saved_shops (user_id, shop_id)
    select '00000000-0000-0000-0000-0000000000b1', id from public.shops limit 1;
  raise exception 'MARKETPLACE TEST FAILED: customer saved for someone else';
exception when insufficient_privilege then raise notice 'ok - customer cannot save for another user';
end $$;
do $$ begin
  insert into public.malls (name, slug) values ('Hack', 'hack');
  raise exception 'MARKETPLACE TEST FAILED: customer added a mall';
exception when insufficient_privilege then raise notice 'ok - customer cannot add malls';
end $$;
update public.offers set status = 'approved';
select pg_temp.check((select count(*) from public.offers where status = 'approved') = 0, 'customer cannot approve offers');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select count(*) from public.saved_shops) = 0, 'vendor cannot see the customer''s saves');
reset role;

-- Blocking a vendor hides their shop and freezes their edits
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.vendors set status = 'blocked' where business_name = 'Fresh Mart';
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
update public.shops set name = 'Still here';
reset role;
select pg_temp.check((select count(*) from public.shops where name = 'Still here') = 0, 'blocked vendor cannot edit');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops) = 2 and (select count(*) from public.offers where title = 'Flat 25%') = 1,
  'blocked vendor still sees their own shop and offers');
reset role;
set local role anon;
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.search_shops()) = 1, 'blocked vendor''s shop disappears');
reset role;

rollback;
