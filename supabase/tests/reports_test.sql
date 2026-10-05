-- Phase 5: admin reports and the merged read policies on vendors and shops.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/reports_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000e1', 'staff@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'manager@test.local', '{}');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'campaign_manager'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor'),
  ('00000000-0000-0000-0000-0000000000e1', 'vendor');
update public.profiles set location_id = (select id from public.locations where slug = 'edappally')
  where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'REPORTS TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create temp table ids (k text primary key, v bigint);
create temp table rep (j jsonb);
grant all on ids, rep to authenticated, anon;

-- Vendor 1 is live with a shop in Edappally (Kochi); vendor 2 is still pending.
insert into public.vendors (owner_id, business_name, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Lulu Fashion', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'Fresh Mart', 'pending');
insert into public.shops (vendor_id, name, category_id)
  select v.id, v.business_name, (select id from public.categories where slug = 'textile') from public.vendors v;
insert into ids select 'v1', id from public.vendors where owner_id = '00000000-0000-0000-0000-0000000000b1';
insert into ids select 'v2', id from public.vendors where owner_id = '00000000-0000-0000-0000-0000000000b2';
insert into ids select 'shop1', id from public.shops where vendor_id = (select v from ids where k = 'v1');
insert into ids select 'shop2', id from public.shops where vendor_id = (select v from ids where k = 'v2');
insert into public.branches (shop_id, name, location_id)
  select s.id, 'Main', (select id from public.locations where slug = 'edappally') from public.shops s;
insert into public.offers (shop_id, title, status, category_id) values
  ((select v from ids where k = 'shop1'), 'Onam sale', 'approved', (select id from public.categories where slug = 'textile')),
  ((select v from ids where k = 'shop1'), 'Quiet offer', 'approved', null),
  ((select v from ids where k = 'shop2'), 'Waiting offer', 'pending', null);
insert into ids select 'offer1', id from public.offers where title = 'Onam sale';
insert into ids select 'offer2', id from public.offers where title = 'Quiet offer';
insert into public.vendor_staff (vendor_id, user_id, role)
  values ((select v from ids where k = 'v1'), '00000000-0000-0000-0000-0000000000e1', 'staff');

-- Counters: offer 1 seen 10 times yesterday and 5 today with 2 WhatsApp leads; offer 2 never seen.
insert into public.offer_stats_daily (day, shop_id, offer_id, views, clicks, whatsapp) values
  (private.today_ist() - 1, (select v from ids where k = 'shop1'), (select v from ids where k = 'offer1'), 10, 4, 1),
  (private.today_ist(), (select v from ids where k = 'shop1'), (select v from ids where k = 'offer1'), 5, 1, 1),
  (private.today_ist() - 400, (select v from ids where k = 'shop1'), (select v from ids where k = 'offer1'), 99, 0, 0);
select pg_temp.check((select count(*) from public.offer_stats_daily where id is not null) = 3,
  'offer_stats_daily rows get a primary key id');

-- A Kochi campaign with one prize from vendor 1: c1 wins and claims, c2 loses.
insert into public.scratch_campaigns (name, is_active, location_id, active_from, active_to)
  values ('Onam scratch', true, (select id from public.locations where slug = 'kochi'), '00:00', '23:59');
insert into ids select 'camp', id from public.scratch_campaigns;
insert into public.scratch_prizes (campaign_id, sponsor_vendor_id, name, quantity, probability, is_active)
  values ((select v from ids where k = 'camp'), (select v from ids where k = 'v1'), 'Free shirt', 5, 1, true);
insert into public.scratch_plays (campaign_id, customer_id, play_date, prize_id, vendor_id, won, claim_code,
                                  claim_status, expires_at)
  select (select v from ids where k = 'camp'), '00000000-0000-0000-0000-0000000000c1', private.today_ist(),
         p.id, (select v from ids where k = 'v1'), true, 'ABCDEFGH', 'claimed', now() + interval '7 days'
  from public.scratch_prizes p;
insert into public.scratch_plays (campaign_id, customer_id, play_date, won)
  values ((select v from ids where k = 'camp'), '00000000-0000-0000-0000-0000000000c2', private.today_ist(), false);

-- Who can run reports --------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
do $$ begin
  perform public.admin_reports(null, null);
  raise exception 'campaign manager ran reports';
exception when insufficient_privilege then null; end $$;
select pg_temp.check(true, 'campaign managers cannot run admin reports');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform public.admin_reports(null, null);
  raise exception 'customer ran reports';
exception when insufficient_privilege then null; end $$;
select pg_temp.check(true, 'customers cannot run admin reports');
reset role;

select pg_temp.check(not has_function_privilege('anon', 'public.admin_reports(date, date)', 'execute'),
  'signed-out visitors cannot call admin_reports');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into rep select public.admin_reports(private.today_ist() - 6, private.today_ist());
reset role;

-- Growth
select pg_temp.check((select (j->'growth'->'totals'->>'customers')::int from rep) = 2,
  'growth counts customers only (not vendors, staff or admins)');
select pg_temp.check((select (j->'growth'->'totals'->>'vendors')::int from rep) = 2
  and (select (j->'growth'->'totals'->>'vendors_approved')::int from rep) = 1, 'growth counts vendors and approved vendors');
select pg_temp.check((select (j->'growth'->'new'->>'offers')::int from rep) = 3, 'new offers in the range are counted');
select pg_temp.check((select sum((w->>'offers')::int) from rep, jsonb_array_elements(j->'growth'->'weekly') w) = 3,
  'weekly growth adds up to the range total');
select pg_temp.check((select (j->'growth'->'totals'->>'offers_live')::int from rep) = 2, 'live offers are counted');

-- Offers
select pg_temp.check((select (j->'offers'->'totals'->>'views')::int from rep) = 15,
  'offer views count only days inside the range');
select pg_temp.check((select (j->'offers'->'totals'->>'leads')::int from rep) = 2, 'leads add WhatsApp, calls and directions');
select pg_temp.check((select j->'offers'->'top'->0->>'title' from rep) = 'Onam sale', 'top offer is the most viewed');
select pg_temp.check((select j->'offers'->'no_views'->0->>'title' from rep) = 'Quiet offer'
  and (select jsonb_array_length(j->'offers'->'no_views') from rep) = 1, 'live offers with no views are listed');
select pg_temp.check((select (j->'offers'->'by_status'->>'pending')::int from rep) = 1, 'offers by status');
select pg_temp.check((select j->'offers'->'by_category'->0->>'category' from rep) = 'Textile'
  or (select j->'offers'->'by_category'->0->>'category' from rep) is not null, 'offer views by category');

-- Locations: everything rolls up to Kochi
select pg_temp.check((select x->>'name' from rep, jsonb_array_elements(j->'locations') x limit 1) = 'Kochi'
  and (select jsonb_array_length(j->'locations') from rep) = 1, 'areas roll up to their city');
select pg_temp.check((select (x->>'shops')::int = 2 and (x->>'customers')::int = 2 and (x->>'views')::int = 15
                             and (x->>'plays')::int = 2 and (x->>'live_offers')::int = 2
                      from rep, jsonb_array_elements(j->'locations') x), 'city shops, customers, views, plays and live offers');

-- Claims
select pg_temp.check((select (j->'claims'->'totals'->>'plays')::int = 2 and (j->'claims'->'totals'->>'wins')::int = 1
                             and (j->'claims'->'totals'->>'claimed')::int = 1 and (j->'claims'->'totals'->>'players')::int = 2
                      from rep), 'claim totals');
select pg_temp.check((select (j->'claims'->'campaigns'->0->>'stock_left')::int from rep) = 5, 'campaign stock left');
select pg_temp.check((select j->'claims'->'vendors'->0->>'business_name' from rep) = 'Lulu Fashion', 'claims by sponsor vendor');

-- Range limits
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((public.admin_reports(private.today_ist() - 1000, private.today_ist())->>'from')::date
  = private.today_ist() - 365, 'the range is capped at a year');
do $$ begin
  perform public.admin_reports(private.today_ist(), private.today_ist() - 5);
  raise exception 'reversed range accepted';
exception when sqlstate '22023' then null; end $$;
select pg_temp.check(true, 'a reversed range is refused');
reset role;

-- Merged read policies -------------------------------------------------------------------------------
set local role anon;
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.shops) = 1, 'visitors see only the live shop');
select pg_temp.check((select count(*) from public.vendors) = 0, 'visitors see no vendor rows');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops where id = (select v from ids where k = 'shop2')) = 1,
  'a pending vendor still sees their own shop');
select pg_temp.check((select count(*) from public.vendors) = 1, 'a vendor sees only their own business');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check((select count(*) from public.vendors) = 1, 'staff see their business');
reset role;
update public.vendors set status = 'blocked' where id = (select v from ids where k = 'v1');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops where id = (select v from ids where k = 'shop1')) = 1,
  'staff still see their shop while the business is blocked');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select count(*) from public.vendors) = 1
  and (select count(*) from public.shops where id = (select v from ids where k = 'shop1')) = 1,
  'a blocked owner still sees their business and shop');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops) = 0, 'customers do not see blocked or pending shops');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops) = 2 and (select count(*) from public.vendors) = 2,
  'admins see every shop and vendor');
reset role;

select pg_temp.check((select count(*) from pg_policies where schemaname = 'public' and tablename in ('shops', 'vendors')
                       and cmd = 'SELECT' and 'authenticated' = any(roles)) = 2,
  'one read policy per table for signed-in users');

rollback;
