-- Vendor onboarding: an applicant picks a plan and sends shop + branches in one go; paid plans are
-- approved only after payment; plans can limit branches.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/vendor_onboarding_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'free@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'paid@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d3', 'old@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'ONBOARDING TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs an application and returns the error message, or null when it went through.
create function pg_temp.try_apply(p jsonb) returns text language plpgsql as $$
begin
  perform public.submit_vendor_application(p);
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.try_sql(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
end $$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;
grant execute on function pg_temp.try_apply(jsonb), pg_temp.try_sql(text) to authenticated;

insert into public.locations (kind, name, slug, lat, lng) values ('area', 'Test Area', 'test-area', 9.9, 76.3);
insert into ids select 'area', id from public.locations where slug = 'test-area';
insert into public.categories (name, slug) values ('Test Fashion', 'test-fashion');
insert into ids select 'cat', id from public.categories where slug = 'test-fashion';
update public.plans set is_active = false;
insert into public.plans (name, price, period_days, max_shops, max_live_offers, max_branches)
  values ('T Free', 0, 30, 1, 3, 1), ('T Pro', 499, 30, null, 10, null), ('T Old', 99, 30, null, 5, null);
update public.plans set is_active = false where name = 'T Old';
insert into ids select 'free', id from public.plans where name = 'T Free';
insert into ids select 'pro', id from public.plans where name = 'T Pro';
insert into ids select 'old', id from public.plans where name = 'T Old';

create function pg_temp.app(plan text, nbranches int default 1, tweak jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'plan_id', (select v from ids where k = plan),
    'shop', jsonb_build_object('name', 'Lulu Fashion', 'category_id', (select v from ids where k = 'cat'),
                               'description', 'Sarees and kurtas', 'phone', '+91 98765 43210',
                               'whatsapp', '9876543210'),
    'branches', (select jsonb_agg(jsonb_build_object(
                   'name', 'Branch ' || g, 'address', 'MG Road, near the bus stand',
                   'location_id', (select v from ids where k = 'area'), 'lat', 9.91, 'lng', 76.31,
                   'parking', 'free', 'parking_note', 'Basement',
                   'hours', '{"mon":{"open":"09:00","close":"21:00"},"sun":{"open":"18:00","close":"01:00"}}'::jsonb))
                 from generate_series(1, nbranches) g)) || tweak;
$$;
grant execute on function pg_temp.app(text, int, jsonb) to authenticated;

-- Free plan applicant -------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;

select pg_temp.check(pg_temp.try_apply(pg_temp.app('old')) like 'Step 1%', 'an inactive plan is refused');
select pg_temp.check(pg_temp.try_apply(pg_temp.app('free') || '{"plan_id": null}') like 'Step 1%',
  'a plan must be chosen');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{shop,category_id}', 'null')) like 'Step 2%category%',
  'category is required');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{shop,description}', '""')) like 'Step 2%describe%',
  'description is required');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{shop,whatsapp}', '""')) like 'Step 2%WhatsApp%',
  'WhatsApp is required');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{branches,0,parking}', 'null')) like 'Step 3%parking%',
  'parking is required');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{branches,0,lat}', 'null')) like 'Step 3%pin%',
  'map pin is required');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{branches,0,hours}', '{}')) like 'Step 3%hours%',
  'at least one open day is required');
select pg_temp.check(pg_temp.try_apply(jsonb_set(pg_temp.app('free'), '{branches,0,hours}',
  '{"mon":{"open":"9am","close":"21:00"}}')) like 'Step 3%hours%', 'bad times are refused');
select pg_temp.check(pg_temp.try_apply(pg_temp.app('pro', 3)) like 'Step 5%up to 2%', 'at most 2 branches in the form');
select pg_temp.check(pg_temp.try_apply(pg_temp.app('free', 2)) like 'Step 5%T Free plan allows 1%',
  'the plan''s branch limit applies');
select pg_temp.check(not exists (select 1 from public.vendors where owner_id = auth.uid()),
  'failed applications save nothing');

select pg_temp.check(pg_temp.try_apply(pg_temp.app('free')) is null, 'a free-plan application goes through');
select pg_temp.check((select status = 'pending' and plan_id = (select v from ids where k = 'free')
                        and business_name = 'Lulu Fashion' and whatsapp = '9876543210'
                      from public.vendors where owner_id = auth.uid()), 'vendor is pending with the plan');
select pg_temp.check(exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'vendor'),
  'vendor role granted');
insert into ids select 'v_free', id from public.vendors where owner_id = auth.uid();
select pg_temp.check((select count(*) = 1 and bool_and(b.name = 'Main branch' and b.parking = 'free'
                        and b.phone = '+91 98765 43210' and b.parking_note = 'Basement')
                      from public.branches b join public.shops s on s.id = b.shop_id
                      where s.vendor_id = (select v from ids where k = 'v_free')),
  'one shop = Main branch, phone falls back to the shop phone');
select pg_temp.check((select count(*) = 1 from public.subscriptions where vendor_id = (select v from ids where k = 'v_free')),
  'free plan is switched on at once');
select pg_temp.check(pg_temp.try_apply(pg_temp.app('free')) like '%already has a business%',
  'cannot apply twice');
select pg_temp.check(pg_temp.try_sql(format('update public.vendors set plan_id = %s where id = %s',
  (select v from ids where k = 'pro'), (select v from ids where k = 'v_free'))) is null
  and (select plan_id = (select v from ids where k = 'free') from public.vendors where id = (select v from ids where k = 'v_free')),
  'vendors cannot change their own plan');
select pg_temp.check(pg_temp.try_sql(format(
  'insert into public.branches (shop_id, name) select id, ''Second'' from public.shops where vendor_id = %s',
  (select v from ids where k = 'v_free'))) like '%allows 1 branch%', 'branch limit applies to later branches too');

-- Paid plan applicant with two branches -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select pg_temp.check(pg_temp.try_apply(pg_temp.app('pro', 2)) is null, 'a paid-plan application with 2 branches goes through');
insert into ids select 'v_pro', id from public.vendors where owner_id = auth.uid();
select pg_temp.check((select array_agg(b.name order by b.id) = array['Branch 1', 'Branch 2']
                      from public.branches b join public.shops s on s.id = b.shop_id
                      where s.vendor_id = (select v from ids where k = 'v_pro')), 'both branches keep their names');
select pg_temp.check((select count(*) = 1 and bool_and(status = 'unpaid' and total > 0) from public.invoices
                      where vendor_id = (select v from ids where k = 'v_pro')), 'an unpaid plan invoice is made');
insert into ids select 'inv_pro', id from public.invoices where vendor_id = (select v from ids where k = 'v_pro');

-- Admin review ----------------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check(pg_temp.try_sql(format('update public.vendors set status = ''approved'' where id = %s',
  (select v from ids where k = 'v_pro'))) like 'Waiting for payment%', 'paid plan: approve is refused before payment');
select public.mark_invoice_paid((select v from ids where k = 'inv_pro'), 'upi', 'UTR123', null);
select pg_temp.check(pg_temp.try_sql(format('update public.vendors set status = ''approved'' where id = %s',
  (select v from ids where k = 'v_pro'))) is null, 'paid plan: approve works once paid');
select pg_temp.check(pg_temp.try_sql(format('update public.vendors set status = ''approved'' where id = %s',
  (select v from ids where k = 'v_free'))) is null, 'free plan: approve works straight away');
reset role;
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000d1'
                               and kind = 'vendor_review' and link = '/vendor/offers/new'),
  'approval message points to adding an offer');
set local role authenticated;

-- An earlier three-field application can be completed -----------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d3');
select public.apply_as_vendor('Old Style Shop', '', '');
select pg_temp.check(pg_temp.try_apply(pg_temp.app('free') || '{"business_name": "Old Style Pvt Ltd"}') is null,
  'an empty earlier application is completed');
select pg_temp.check((select count(*) = 1 from public.vendors where owner_id = auth.uid() and business_name = 'Old Style Pvt Ltd'),
  'still one business, with the given business name');

reset role;
rollback;
