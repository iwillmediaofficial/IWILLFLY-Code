-- Phase 3 gate: festivals, ads, placement requests, notifications, push queue and analytics counters.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/engagement_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', '{"full_name":"Anjali Menon"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'manager@test.local', '{}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000d1', 'campaign_manager');
update public.profiles set location_id = (select id from public.locations where slug = 'edappally')
  where id = '00000000-0000-0000-0000-0000000000c1';

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'ENGAGEMENT TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;

-- Two vendors with a shop, branch and offer each (set up directly, as the database owner)
insert into public.vendors (owner_id, business_name, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Lulu Fashion', 'pending'),
  ('00000000-0000-0000-0000-0000000000b2', 'Fresh Mart', 'approved');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'vendor'), ('00000000-0000-0000-0000-0000000000b2', 'vendor');
insert into public.shops (vendor_id, name, category_id)
  select v.id, v.business_name, (select id from public.categories where slug = 'textile') from public.vendors v;
insert into public.branches (shop_id, name, lat, lng, location_id)
  select s.id, 'Main', 10.0261, 76.3083, (select id from public.locations where slug = 'edappally') from public.shops s;
insert into public.offers (shop_id, title, discount_label, status)
  select s.id, 'Offer of ' || s.name, '20% OFF', 'pending' from public.shops s;
insert into ids select 'shop1', s.id from public.shops s join public.vendors v on v.id = s.vendor_id
  where v.owner_id = '00000000-0000-0000-0000-0000000000b1';
insert into ids select 'offer1', o.id from public.offers o where o.shop_id = (select v from ids where k = 'shop1');
insert into ids select 'shop2', s.id from public.shops s where s.id <> (select v from ids where k = 'shop1');
insert into ids select 'offer2', o.id from public.offers o where o.shop_id = (select v from ids where k = 'shop2');

-- Approvals send alerts to the vendor
update public.vendors set status = 'approved' where owner_id = '00000000-0000-0000-0000-0000000000b1';
update public.offers set status = 'approved';
select pg_temp.check((select count(*) from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind in ('vendor_review', 'offer_review')) = 2,
  'vendor is alerted when their business and offer are approved');

-- Festivals ----------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into public.festivals (name, slug, starts_on, ends_on, is_active)
  values ('Onam 2026', 'onam-2026', private.today_ist(), private.today_ist() + 10, true);
insert into ids select 'fest', id from public.festivals;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.festival_offers (festival_id, offer_id, status)
  values ((select v from ids where k = 'fest'), (select v from ids where k = 'offer1'), 'approved');
select pg_temp.check((select status = 'pending' from public.festival_offers), 'vendor submission starts pending');
do $$ begin
  insert into public.festival_offers (festival_id, offer_id)
    values ((select v from ids where k = 'fest'), (select v from ids where k = 'offer2'));
  raise exception 'ENGAGEMENT TEST FAILED: vendor submitted another vendor''s offer';
exception when insufficient_privilege then raise notice 'ok - vendors submit only their own offers';
end $$;
update public.festival_offers set status = 'approved';
select pg_temp.check((select status = 'pending' from public.festival_offers), 'vendor cannot approve their submission');
reset role;

select pg_temp.act_as(null);
set local role anon;
select pg_temp.check((select count(*) from public.festivals) = 1, 'public sees the active festival');
select pg_temp.check((select count(*) from public.festival_offers_live((select v from ids where k = 'fest'))) = 0,
  'pending submission is not on the festival page');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
update public.festival_offers set status = 'approved';
select pg_temp.check((select reviewed_by = '00000000-0000-0000-0000-0000000000d1' from public.festival_offers),
  'review records the manager');
reset role;
select pg_temp.act_as(null);
set local role anon;
select pg_temp.check((select count(*) from public.festival_offers_live((select v from ids where k = 'fest'))) = 1,
  'approved offer is on the festival page');
reset role;
select pg_temp.check((select count(*) from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'festival_review') = 1,
  'vendor is alerted about the festival decision');

-- Ads ------------------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into public.ads (title, style, link_kind, link_target) values ('Onam deals', 'ad1', 'festival', 'onam-2026');
insert into public.ads (title, is_active) values ('Hidden', false);
insert into public.ads (title, starts_on) values ('Next week', private.today_ist() + 7);
reset role;
select pg_temp.act_as(null);
set local role anon;
select pg_temp.check((select string_agg(title, ',') from public.ads) = 'Onam deals', 'only running ads are public');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  insert into public.ads (title) values ('Spam');
  raise exception 'ENGAGEMENT TEST FAILED: customer created an ad';
exception when insufficient_privilege then raise notice 'ok - customers cannot create ads';
end $$;
reset role;

-- Placement requests -------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.placement_requests (vendor_id, kind, offer_id, status, admin_note)
  select (select id from public.vendors), 'featured_offer', (select v from ids where k = 'offer1'), 'approved', 'x';
select pg_temp.check((select status = 'pending' and admin_note is null from public.placement_requests),
  'vendor request starts pending');
update public.placement_requests set status = 'cancelled';
select pg_temp.check((select status = 'cancelled' from public.placement_requests), 'vendor cancels a pending request');
do $$ begin
  update public.placement_requests set status = 'pending';
  raise exception 'ENGAGEMENT TEST FAILED: vendor reopened a request';
exception when insufficient_privilege then raise notice 'ok - a cancelled request stays cancelled';
end $$;
insert into public.placement_requests (vendor_id, kind, offer_id, message)
  select (select id from public.vendors), 'featured_offer', (select v from ids where k = 'offer1'), 'Onam week please';
do $$ begin
  insert into public.placement_requests (vendor_id, kind, offer_id)
    select (select id from public.vendors), 'featured_offer', (select v from ids where k = 'offer2');
  raise exception 'ENGAGEMENT TEST FAILED: vendor asked to feature another vendor''s offer';
exception when insufficient_privilege then raise notice 'ok - vendors request placement only for their own offers';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
update public.placement_requests set status = 'approved', admin_note = 'Featured for Onam' where status = 'pending';
reset role;
select pg_temp.check((select is_featured from public.offers where id = (select v from ids where k = 'offer1')),
  'approving a featured-offer request features the offer');
select pg_temp.check((select count(*) from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'placement_review') = 1,
  'vendor is alerted about the placement decision');

-- Analytics ----------------------------------------------------------------------------------------
select pg_temp.act_as(null);
set local role anon;
select public.track_event('view', (select v from ids where k = 'shop1'), null);
select public.track_event('view', (select v from ids where k = 'shop1'), (select v from ids where k = 'offer1'));
select public.track_event('click', (select v from ids where k = 'shop1'), (select v from ids where k = 'offer1'));
select public.track_event('whatsapp', (select v from ids where k = 'shop1'), null);
select public.track_event('view', (select v from ids where k = 'shop1'), (select v from ids where k = 'offer2'));
do $$ begin
  perform public.track_event('hack', (select v from ids where k = 'shop1'), null);
  raise exception 'ENGAGEMENT TEST FAILED: unknown event accepted';
exception when invalid_parameter_value then raise notice 'ok - unknown events are refused';
end $$;
select pg_temp.check((select count(*) from public.offer_stats_daily) = 0, 'visitors cannot read the counters');
reset role;
select pg_temp.check((select count(*) from public.offer_stats_daily where offer_id = (select v from ids where k = 'offer2')) = 0,
  'an offer tracked under the wrong shop is ignored');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.track_event('view', (select v from ids where k = 'shop1'), (select v from ids where k = 'offer1'));
select public.track_event('call', (select v from ids where k = 'shop1'), null);
insert into public.saved_offers (offer_id) values ((select v from ids where k = 'offer1'));
insert into public.saved_shops (shop_id) values ((select v from ids where k = 'shop1'));
select pg_temp.check((select count(*) from public.my_offer_history()) = 1, 'viewed offer appears in Recently viewed');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
insert into public.saved_offers (offer_id) values ((select v from ids where k = 'offer2'));
select pg_temp.check((select count(*) from public.my_offer_history()) = 0, 'history is private to each customer');
reset role;

select pg_temp.check((select views = 2 and clicks = 1 and saves = 1 from public.offer_stats_daily
  where offer_id = (select v from ids where k = 'offer1')), 'offer counters: 2 views, 1 click, 1 save');
select pg_temp.check((select views = 1 and whatsapp = 1 and calls = 1 and saves = 1 from public.offer_stats_daily
  where shop_id = (select v from ids where k = 'shop1') and offer_id is null), 'shop counters: view, WhatsApp, call, save');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select count(*) from public.offer_stats_daily) = 2, 'vendor reads only their own counters');
select pg_temp.check((
  select (a->'totals'->>'views')::int = (select sum(views) from public.offer_stats_daily)
     and (a->'totals'->>'saves')::int = (select sum(saves) from public.offer_stats_daily)
     and (a->'totals'->>'whatsapp')::int = (select sum(whatsapp) from public.offer_stats_daily)
     and (a->'totals'->>'views')::int = 3
     and jsonb_array_length(a->'offers') = 1
  from public.vendor_analytics(private.today_ist() - 7, private.today_ist()) a),
  'vendor dashboard totals match the raw counters');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.check((
  select (a->'totals'->>'views')::int = (select sum(views) from public.offer_stats_daily)
     and (a->'totals'->>'clicks')::int = (select sum(clicks) from public.offer_stats_daily)
     and (a->'totals'->>'saves')::int = (select sum(saves) from public.offer_stats_daily)
     and (a->'totals'->>'saves')::int = 3
     and (select sum((d->>'views')::int) from jsonb_array_elements(a->'daily') d) = (a->'totals'->>'views')::int
  from public.admin_analytics(private.today_ist() - 7, private.today_ist()) a),
  'admin dashboard totals and daily rows match the raw counters');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  perform public.admin_analytics(private.today_ist() - 7, private.today_ist());
  raise exception 'ENGAGEMENT TEST FAILED: customer read admin analytics';
exception when insufficient_privilege then raise notice 'ok - only managers see admin analytics';
end $$;
reset role;

-- Broadcasts and push ------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  perform public.send_broadcast('Hi', null, null, 'everyone');
  raise exception 'ENGAGEMENT TEST FAILED: customer sent a broadcast';
exception when insufficient_privilege then raise notice 'ok - customers cannot broadcast';
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.check(public.broadcast_audience_size('customers', (select id from public.locations where slug = 'kochi')) = 1,
  'customers in Kochi: only the customer who set an area there');
select pg_temp.check(public.broadcast_audience_size('vendors', (select id from public.locations where slug = 'kochi')) = 2,
  'vendors with a branch in Kochi');
select pg_temp.check(public.broadcast_audience_size('customers', null, (select id from public.categories where slug = 'textile')) = 2,
  'customers who saved textile offers or shops');
select pg_temp.check((public.send_broadcast('Onam is here', 'Big deals near you', '/festival/onam-2026', 'customers',
  (select id from public.locations where slug = 'kochi'))->>'recipients')::int = 1, 'broadcast reaches the targeted customer');
do $$ begin
  perform public.send_broadcast('Bad link', null, 'https://evil.example', 'everyone');
  raise exception 'ENGAGEMENT TEST FAILED: external link accepted';
exception when invalid_parameter_value then raise notice 'ok - broadcast links must be in-app paths';
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.notifications) = 1 and (select title from public.notifications) = 'Onam is here',
  'customer sees the broadcast in their inbox');
update public.notifications set read_at = now(), title = 'changed';
select pg_temp.check((select read_at is not null and title = 'Onam is here' from public.notifications),
  'customer can mark read but not edit a message');
do $$ begin
  perform public.push_queue(10);
  raise exception 'ENGAGEMENT TEST FAILED: customer read the push queue';
exception when insufficient_privilege then raise notice 'ok - only the server reads the push queue';
end $$;
reset role;

set local role service_role;
select pg_temp.check(public.push_queue(40) = '[]'::jsonb, 'no browser subscribed: nothing to push');
reset role;
select pg_temp.check((select push_status = 'skipped' from public.notifications where kind = 'broadcast'),
  'message without a subscribed browser is skipped');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'test');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.send_broadcast('Scratch today', null, '/scratch', 'customers', (select id from public.locations where slug = 'kochi'));
reset role;
set local role service_role;
select pg_temp.check((select jsonb_array_length(q) = 1 and q->0->>'title' = 'Scratch today'
  and q->0->'subscriptions'->0->>'endpoint' = 'https://push.example/abc' from public.push_queue(40) q),
  'push queue hands out the message with the customer''s browser');
select pg_temp.check(public.push_queue(40) = '[]'::jsonb, 'each push is handed out once');
reset role;

-- Moving a browser to another account
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'test');
select pg_temp.check((select count(*) from public.push_subscriptions) = 1, 'signing in on the same browser moves its subscription');
reset role;

-- Winner alert -------------------------------------------------------------------------------------
insert into public.scratch_campaigns (name, active_from, active_to, is_active) values ('Daily', '00:00', '23:59:59', true);
insert into public.scratch_prizes (campaign_id, sponsor_vendor_id, name, quantity, probability, is_active)
  select c.id, v.id, 'Free bag', 5, 1, true from public.scratch_campaigns c, public.vendors v
  where v.owner_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.play_scratch((select id from public.scratch_campaigns));
reset role;
select pg_temp.check((select count(*) from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'new_winner' and body like '%Free bag%') = 1,
  'sponsor is alerted about a new winner');

select public.cleanup_engagement();
select pg_temp.check(true, 'clean-up job runs');

rollback;
