-- Bills name the branch: the "Which branch?" list, the branch rule in check_bill / submit_bill, branch staff,
-- the per-shop duplicate rule, fixing a rejected bill, and the branch in my_bills / admin_bills.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/bill_branch_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', '{"full_name":"Anjali Menon"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'solo@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b3', 'bare@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'kakkanad.staff@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'BILL BRANCH TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs sql and passes when it raises an error whose message contains `expect`.
create function pg_temp.refused(sql text, expect text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'BILL BRANCH TEST FAILED: % (was accepted)', what;
exception when others then
  if sqlerrm like 'BILL BRANCH TEST FAILED%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'BILL BRANCH TEST FAILED: % (wrong error: %)', what, sqlerrm;
  end if;
  raise notice 'ok - %', what;
end $$;

create function pg_temp.photo(uid text, seed text) returns text language sql as $$
  select 'bills/' || uid || '/' || md5(seed) || md5(seed || '#') || '.webp'
$$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;
create function pg_temp.id(key text) returns bigint language sql as $$ select v from ids where k = key $$;
grant execute on function pg_temp.check(boolean, text), pg_temp.refused(text, text, text),
  pg_temp.photo(text, text), pg_temp.id(text) to authenticated, anon;

-- Lulu has two live branches, one waiting for review and one waiting for payment; Solo has one branch;
-- Bare has none. A Kakkanad branch login works for Lulu.
insert into public.locations (kind, name, slug) values ('area', 'Edappally', 'edappally-bt'), ('area', 'Kakkanad', 'kakkanad-bt');
insert into public.vendors (owner_id, business_name, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Lulu Group', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'Solo Stores', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'Bare Bakes', 'approved');
insert into public.shops (vendor_id, name)
  select id, case business_name when 'Lulu Group' then 'Lulu BT' when 'Solo Stores' then 'Solo BT' else 'Bare BT' end
  from public.vendors where business_name in ('Lulu Group', 'Solo Stores', 'Bare Bakes');
insert into ids select 'lulu', id from public.shops where name = 'Lulu BT';
insert into ids select 'solo', id from public.shops where name = 'Solo BT';
insert into ids select 'bare', id from public.shops where name = 'Bare BT';
insert into public.branches (shop_id, name, address, location_id, lat, lng) values
  (pg_temp.id('lulu'), 'Lulu Edappally', 'NH 66', (select id from public.locations where slug = 'edappally-bt'), 10.027, 76.308),
  (pg_temp.id('lulu'), 'Lulu Kakkanad', 'Infopark Rd', (select id from public.locations where slug = 'kakkanad-bt'), 10.015, 76.341),
  (pg_temp.id('lulu'), 'Lulu Aluva', null, null, null, null),
  (pg_temp.id('lulu'), 'Lulu Vyttila', null, null, null, null),
  (pg_temp.id('solo'), 'Solo Main', 'Market Rd', null, null, null);
insert into ids select 'edappally', id from public.branches where name = 'Lulu Edappally';
insert into ids select 'kakkanad', id from public.branches where name = 'Lulu Kakkanad';
insert into ids select 'aluva', id from public.branches where name = 'Lulu Aluva';
insert into ids select 'vyttila', id from public.branches where name = 'Lulu Vyttila';
insert into ids select 'solo_main', id from public.branches where name = 'Solo Main';
update public.branches set review_status = 'pending' where id = pg_temp.id('aluva');
update public.branches set awaiting_payment = true where id = pg_temp.id('vyttila');
insert into public.vendor_staff (vendor_id, user_id, role, branch_id)
  select v.id, '00000000-0000-0000-0000-0000000000d1', 'staff', pg_temp.id('kakkanad')
  from public.vendors v where v.business_name = 'Lulu Group';
select pg_temp.check((select review_status from public.branches where id = pg_temp.id('aluva')) = 'pending'
                     and (select awaiting_payment from public.branches where id = pg_temp.id('vyttila')),
  'setup: Aluva waits for review and Vyttila for payment');

-- The pickers -----------------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select branch_count from public.points_shops('BT', 50) where id = pg_temp.id('lulu')) = 2
                     and (select branch_count from public.points_shops('BT', 50) where id = pg_temp.id('solo')) = 1
                     and (select branch_count from public.points_shops('BT', 50) where id = pg_temp.id('bare')) = 0,
  'the shop picker counts live branches only');
select pg_temp.check((select string_agg(name || '/' || coalesce(area, '-') || '/' || coalesce(address, '-'), ', ')
                      from public.points_shop_branches(pg_temp.id('lulu')))
                     = 'Lulu Edappally/Edappally/NH 66, Lulu Kakkanad/Kakkanad/Infopark Rd',
  'the branch list shows live branches with area and address, by name');
select pg_temp.check((select lat from public.points_shop_branches(pg_temp.id('lulu')) limit 1) = 10.027,
  'the branch list carries the map point for nearest-first');
reset role;
select pg_temp.act_as(null);
set local role anon;
select pg_temp.refused($$select * from public.points_shop_branches(pg_temp.id('lulu'))$$, 'permission denied',
  'guests cannot call the branch list');
reset role;

-- The branch rule -------------------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select public.check_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500)$$,
  'Pick the branch the bill is from', 'a shop with several branches needs the branch');
select pg_temp.refused($$select public.check_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500, null,
  pg_temp.id('aluva'))$$, 'Pick a branch of this shop', 'a branch waiting for review cannot be picked');
select pg_temp.refused($$select public.check_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500, null,
  pg_temp.id('vyttila'))$$, 'Pick a branch of this shop', 'a branch waiting for payment cannot be picked');
select pg_temp.refused($$select public.check_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500, null,
  pg_temp.id('solo_main'))$$, 'Pick a branch of this shop', 'a branch of another shop cannot be picked');
select pg_temp.check(public.check_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500, null,
  pg_temp.id('kakkanad')) = 10, 'a live branch of the shop is accepted');

select public.submit_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'l1'), null, null, pg_temp.id('kakkanad'));
select public.submit_bill(pg_temp.id('solo'), 'S-1', private.today_ist(), 200,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 's1'));
select public.submit_bill(pg_temp.id('bare'), 'B-1', private.today_ist(), 100,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'b1'));
reset role;
insert into ids select 'bill_l1', id from public.bill_submissions where bill_number = 'L-1';
insert into ids select 'bill_s1', id from public.bill_submissions where bill_number = 'S-1';
insert into ids select 'bill_b1', id from public.bill_submissions where bill_number = 'B-1';
select pg_temp.check((select branch_id from public.bill_submissions where id = pg_temp.id('bill_l1')) = pg_temp.id('kakkanad'),
  'the picked branch is stored with the bill');
select pg_temp.check((select branch_id from public.bill_submissions where id = pg_temp.id('bill_s1')) = pg_temp.id('solo_main'),
  'a shop with one branch gets it filled in (the app before this change keeps working)');
select pg_temp.check((select branch_id from public.bill_submissions where id = pg_temp.id('bill_b1')) is null,
  'a shop with no live branch stores no branch');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select public.submit_bill(pg_temp.id('lulu'), 'l 1', private.today_ist(), 500,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'l1-again'), null, null, pg_temp.id('edappally'))$$,
  'already been added', 'the same bill number and date at another branch of the shop is a duplicate');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.refused($$select public.check_bill(pg_temp.id('lulu'), 'L-9', private.today_ist(), 500, null,
  pg_temp.id('edappally'))$$, 'own shop', 'branch staff cannot earn at any branch of their shop');
select pg_temp.check(public.check_bill(pg_temp.id('solo'), 'S-9', private.today_ist(), 500) = 10,
  'branch staff can earn at other shops');
reset role;

-- My bills and the admin queue show the branch -------------------------------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select branch_id = pg_temp.id('kakkanad') and branch_name = 'Lulu Kakkanad' and branch_area = 'Kakkanad'
                      from public.my_bills() where id = pg_temp.id('bill_l1')),
  'my bills show the branch and its area');
select pg_temp.check((select branch_name is null from public.my_bills() where id = pg_temp.id('bill_b1')),
  'a bill with no branch shows none');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select branch_name = 'Lulu Kakkanad' and branch_area = 'Kakkanad'
                      from public.admin_bills('pending') where id = pg_temp.id('bill_l1')),
  'the admin queue shows the branch and its area');
select pg_temp.check((select branch_name = 'Solo Main' from public.admin_bills(null, null, 50, pg_temp.id('bill_s1'))),
  'one bill in the admin queue shows its branch');
select public.reject_bill(pg_temp.id('bill_l1'), 'blurry');
select public.reject_bill(pg_temp.id('bill_s1'), 'wrong_shop');
reset role;

-- Fixing a rejected bill keeps the branch, unless it was the wrong shop ------------------------------

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.submit_bill(pg_temp.id('lulu'), 'L-1', private.today_ist(), 500,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 'l1-fixed'), null, pg_temp.id('bill_l1'));
reset role;
select pg_temp.check((select branch_id from public.bill_submissions where resubmit_of = pg_temp.id('bill_l1'))
                     = pg_temp.id('kakkanad'), 'a bill fixed after a blurry photo keeps its branch');

-- the wrong-shop bill is sent again for Lulu: the branch must be picked again
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.refused($$select public.submit_bill(pg_temp.id('lulu'), 'S-1', private.today_ist(), 200,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 's1-fixed'), null, pg_temp.id('bill_s1'))$$,
  'Pick the branch the bill is from', 'a bill fixed after "wrong shop" needs the branch again');
select public.submit_bill(pg_temp.id('lulu'), 'S-1', private.today_ist(), 200,
  pg_temp.photo('00000000-0000-0000-0000-0000000000c1', 's1-fixed'), null, pg_temp.id('bill_s1'), pg_temp.id('edappally'));
reset role;
select pg_temp.check((select shop_id = pg_temp.id('lulu') and branch_id = pg_temp.id('edappally')
                      from public.bill_submissions where resubmit_of = pg_temp.id('bill_s1')),
  'the fixed bill is stored with the newly picked shop and branch');

-- A branch deleted later leaves its bills without a branch -------------------------------------------
select pg_temp.check((select confdeltype from pg_constraint
                      where conrelid = 'public.bill_submissions'::regclass and contype = 'f'
                        and conkey = array[(select attnum from pg_attribute
                                            where attrelid = 'public.bill_submissions'::regclass
                                              and attname = 'branch_id')]) = 'n',
  'deleting a branch keeps its bills (branch_id set to null)');

rollback;
