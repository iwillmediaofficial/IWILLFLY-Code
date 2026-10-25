-- Branch logins and offers per branch: branch managers touch only their branch, offers run at all or some
-- branches, per-branch offer limits, new branches wait for an admin, invite links, username logins,
-- extra-branch pricing and branch-aware customer search.
-- Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/branch_logins_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@test.local', '{"full_name":"Lulu Owner"}', '{}'),
  ('00000000-0000-0000-0000-0000000000e1', 'kakkanad@test.local', '{"full_name":"Kakkanad Manager"}', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'edappally@test.local', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000e3', 'cashier@test.local', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000e4', 'invited@test.local', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'customer@test.local', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{}', '{}');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'BRANCH TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs a statement and returns the error message, or null when it went through.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create temp table ids (k text primary key, v bigint);
grant all on ids to authenticated, anon;
grant execute on function pg_temp.err(text), pg_temp.check(boolean, text) to authenticated;

insert into public.plans (name, price, period_days, max_live_offers, included_branches, extra_branch_price)
  values ('Brand', 1000, 30, 2, 2, 100);
insert into ids select 'plan', id from public.plans where name = 'Brand';
insert into public.vendors (owner_id, business_name, status, plan_id)
  values ('00000000-0000-0000-0000-0000000000b1', 'Lulu Group', 'pending', (select v from ids where k = 'plan'));
insert into ids select 'v', id from public.vendors where business_name = 'Lulu Group';
insert into public.locations (kind, name, slug) values ('area', 'Kakkanad', 'kakkanad-test');
insert into ids select 'loc', id from public.locations where slug = 'kakkanad-test';

-- While the business is pending, its branches are reviewed with it -----------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.shops (vendor_id, name) values ((select v from ids where k = 'v'), 'Lulu Hypermarket');
insert into ids select 'shop', id from public.shops where name = 'Lulu Hypermarket';
insert into public.branches (shop_id, name, location_id, lat, lng)
  values ((select v from ids where k = 'shop'), 'Main branch', (select v from ids where k = 'loc'), 10.01, 76.35);
insert into public.branches (shop_id, name, lat, lng)
  values ((select v from ids where k = 'shop'), 'Edappally', 10.03, 76.30);
insert into ids select 'b_main', id from public.branches where name = 'Main branch' and shop_id = (select v from ids where k = 'shop');
insert into ids select 'b_edap', id from public.branches where name = 'Edappally';
select pg_temp.check((select slug from public.branches where id = (select v from ids where k = 'b_main')) = 'kakkanad',
  'main branch link uses its area name');
select pg_temp.check((select slug from public.branches where id = (select v from ids where k = 'b_edap')) = 'edappally',
  'branch link made from the branch name');
select pg_temp.check((select bool_and(review_status = 'approved') from public.branches
                      where shop_id = (select v from ids where k = 'shop')),
  'branches sent before approval need no separate review');
reset role;
update public.vendors set status = 'approved' where id = (select v from ids where k = 'v');

-- New branches after approval wait for an admin ------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.branches (shop_id, name, lat, lng, slug, review_status)
  values ((select v from ids where k = 'shop'), 'Edappally', 10.05, 76.32, 'hacked', 'approved');
insert into ids select 'b_new', id from public.branches where shop_id = (select v from ids where k = 'shop') and id > (select v from ids where k = 'b_edap');
select pg_temp.check((select review_status = 'pending' and slug = 'edappally-2' from public.branches
                      where id = (select v from ids where k = 'b_new')),
  'a new branch waits for review and gets its own link whatever the vendor sends');
update public.branches set review_status = 'approved', slug = 'x' where id = (select v from ids where k = 'b_new');
select pg_temp.check((select review_status = 'pending' and slug = 'edappally-2' from public.branches
                      where id = (select v from ids where k = 'b_new')),
  'vendors cannot approve their own branch or change its link');
reset role;
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'
                             and link = '/admin/branches'), 'admins are told about the new branch');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.branches where shop_id = (select v from ids where k = 'shop')) = 2,
  'customers do not see a branch waiting for review');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.check((select count(*) from public.admin_pending_branches()) = 1, 'admin lists the waiting branch');
select public.review_branch((select v from ids where k = 'b_new'), false, 'Wrong address');
reset role;
select pg_temp.check((select review_status from public.branches where id = (select v from ids where k = 'b_new')) = 'rejected',
  'admin can refuse a branch');
select pg_temp.check(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1'
                             and title like 'Branch not approved%'), 'owner is told the branch was refused');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.branches set address = 'Opp. metro, Edappally' where id = (select v from ids where k = 'b_new');
reset role;
select pg_temp.check((select review_status from public.branches where id = (select v from ids where k = 'b_new')) = 'pending',
  'a corrected branch goes back for review');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.review_branch((select v from ids where k = 'b_new'), true);
reset role;
select pg_temp.check((select review_status from public.branches where id = (select v from ids where k = 'b_new')) = 'approved',
  'admin approves the branch');

-- Team: email, username login, invite link -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.add_vendor_staff('kakkanad@test.local', 'manager', (select v from ids where k = 'b_main'));
select pg_temp.check(pg_temp.err($$select public.add_vendor_staff('cashier@test.local', 'staff', 999999)$$)
  like 'Choose one of your branches%', 'owner can only pick their own branches');
select pg_temp.check(public.check_branch_login((select v from ids where k = 'b_edap'), 'lulu-edappally', 'manager')
  = (select v from ids where k = 'v'), 'owner may make a username login');
select pg_temp.check(pg_temp.err($$select public.check_branch_login((select v from ids where k = 'b_edap'), 'A', 'manager')$$)
  like 'Username:%', 'usernames are checked');
reset role;

-- The Worker makes the account (server-only app_metadata names the business and branch).
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'lulu-edappally@branch.iwillfly.in',
   jsonb_build_object('branch_login', jsonb_build_object('vendor_id', (select v from ids where k = 'v')::text,
                                                         'branch_id', (select v from ids where k = 'b_edap')::text))),
  ('00000000-0000-0000-0000-0000000000f2', 'someone-else@branch.iwillfly.in',
   jsonb_build_object('branch_login', jsonb_build_object('vendor_id', '999', 'branch_id', '999')));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.check_branch_login((select v from ids where k = 'b_edap'), 'lulu-edappally', 'manager')$$)
  like 'That username is taken%', 'a username can be used once');
select public.attach_branch_login('00000000-0000-0000-0000-0000000000f1', (select v from ids where k = 'b_edap'), 'manager');
select pg_temp.check(pg_temp.err($$select public.attach_branch_login('00000000-0000-0000-0000-0000000000f2', (select v from ids where k = 'b_edap'), 'manager')$$)
  like 'That login was not made for this branch%', 'a login made for another business cannot be attached');
select pg_temp.check(pg_temp.err($$select public.attach_branch_login('00000000-0000-0000-0000-0000000000e3', (select v from ids where k = 'b_edap'), 'manager')$$)
  like 'That login was not made for this branch%', 'ordinary accounts cannot be attached as username logins');
select pg_temp.check((select login_name = 'lulu-edappally' and email is null and branch_name = 'Edappally'
                      from public.vendor_team() where user_id = '00000000-0000-0000-0000-0000000000f1'),
  'team list shows the username login and its branch');
select pg_temp.check(public.can_manage_branch_login('00000000-0000-0000-0000-0000000000f1'),
  'owner may reset the username login password');
insert into ids select 'invite', 0;
update ids set v = length(public.create_vendor_invite('staff', (select v from ids where k = 'b_main'))) where k = 'invite';
select pg_temp.check((select v from ids where k = 'invite') = 64, 'owner makes an invite link');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e4');
set local role authenticated;
select pg_temp.check((select public.vendor_invite_info(token) ->> 'branch_name' from public.vendor_invites limit 1) is null,
  'invite tokens are not readable by outsiders');
reset role;
create temp table tok as select token from public.vendor_invites;
grant select on tok to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e4');
set local role authenticated;
select pg_temp.check(public.vendor_invite_info((select token from tok)) ->> 'state' = 'ok', 'invite page shows the invite');
select public.accept_vendor_invite((select token from tok));
select pg_temp.check((public.my_vendor() ->> 'my_branch_id')::bigint = (select v from ids where k = 'b_main')
  and public.my_vendor() ->> 'my_role' = 'staff', 'invite link joins the branch as staff');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e3');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.accept_vendor_invite((select token from tok))$$)
  like 'This invite link was already used%', 'an invite link works once');
reset role;

-- Branch manager scope -------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check(public.my_vendor() ->> 'my_branch_name' = 'Main branch', 'branch manager sees their branch');
update public.branches set phone = '9999999999' where id = (select v from ids where k = 'b_main');
update public.branches set phone = '1111111111' where id = (select v from ids where k = 'b_edap');
update public.shops set name = 'Hacked' where id = (select v from ids where k = 'shop');
select pg_temp.check(pg_temp.err($$insert into public.branches (shop_id, name) values ((select v from ids where k = 'shop'), 'Mine')$$)
  is not null, 'branch manager cannot add branches');
select pg_temp.check(pg_temp.err($$select public.add_vendor_staff('cashier@test.local', 'manager', (select v from ids where k = 'b_main'))$$)
  like 'Only the business owner%', 'branch manager cannot add managers');
select public.add_vendor_staff('cashier@test.local', 'staff', (select v from ids where k = 'b_main'));
select pg_temp.check((select count(*) from public.vendor_team()) = 4, 'branch manager sees the owner and their branch team');
reset role;
select pg_temp.check((select phone from public.branches where id = (select v from ids where k = 'b_main')) = '9999999999',
  'branch manager edits their own branch');
select pg_temp.check((select phone from public.branches where id = (select v from ids where k = 'b_edap')) is null,
  'branch manager cannot edit another branch');
select pg_temp.check((select name from public.shops where id = (select v from ids where k = 'shop')) = 'Lulu Hypermarket',
  'branch manager cannot edit the brand');

-- Offers per branch and limits (plan: 2 brand-wide, 2 per branch) ----------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop'), 'Brand offer 1');
insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop'), 'Brand offer 2');
select pg_temp.check(pg_temp.err($$insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop'), 'Brand offer 3')$$)
  like '%live offer(s) for all branches%', 'brand-wide offers have their own limit');
insert into public.offers (shop_id, title, all_branches) values ((select v from ids where k = 'shop'), 'Edappally only', false);
insert into ids select 'o_edap', id from public.offers where title = 'Edappally only';
select public.set_offer_branches((select v from ids where k = 'o_edap'), false, array[(select v from ids where k = 'b_edap')]);
reset role;
insert into ids select 'o_brand1', id from public.offers where title = 'Brand offer 1';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
insert into public.offers (shop_id, title, all_branches) values ((select v from ids where k = 'shop'), 'Kakkanad 1', true);
insert into ids select 'o_kak1', id from public.offers where title = 'Kakkanad 1';
select public.set_offer_branches((select v from ids where k = 'o_kak1'), true, array[(select v from ids where k = 'b_edap')]);
reset role;
select pg_temp.check((select not all_branches from public.offers where id = (select v from ids where k = 'o_kak1'))
  and (select array_agg(branch_id) from public.offer_branches where offer_id = (select v from ids where k = 'o_kak1'))
      = array[(select v from ids where k = 'b_main')],
  'a branch manager''s offer is for their branch only, whatever they ask');
select pg_temp.check((select created_by from public.offers where id = (select v from ids where k = 'o_kak1'))
  = '00000000-0000-0000-0000-0000000000e1', 'offer remembers who made it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop'), 'Kakkanad 2');
insert into ids select 'o_kak2', id from public.offers where title = 'Kakkanad 2';
select public.set_offer_branches((select v from ids where k = 'o_kak2'), false, null);
select pg_temp.check(pg_temp.err($$insert into public.offers (shop_id, title) values ((select v from ids where k = 'shop'), 'Kakkanad 3')$$)
  like '%per branch%', 'each branch has its own offer limit');
update public.offers set title = 'Brand offer hacked' where id = (select v from ids where k = 'o_brand1');
update public.offers set title = 'Edappally hacked' where id = (select v from ids where k = 'o_edap');
update public.offers set title = 'Kakkanad 1 new' where id = (select v from ids where k = 'o_kak1');
select pg_temp.check(pg_temp.err($$select public.set_offer_branches((select v from ids where k = 'o_edap'), false, null)$$)
  like 'You can only change offers of your own branch%', 'branch manager cannot move another branch''s offer');
reset role;
select pg_temp.check((select title from public.offers where id = (select v from ids where k = 'o_brand1')) = 'Brand offer 1',
  'branch manager cannot change brand-wide offers');
select pg_temp.check((select title from public.offers where id = (select v from ids where k = 'o_edap')) = 'Edappally only',
  'branch manager cannot change another branch''s offers');
select pg_temp.check((select title from public.offers where id = (select v from ids where k = 'o_kak1')) = 'Kakkanad 1 new',
  'branch manager changes their own offers');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check(pg_temp.err($$select public.set_offer_branches((select v from ids where k = 'o_edap'), false,
  array[(select v from ids where k = 'b_edap'), (select v from ids where k = 'b_main')])$$)
  like 'Main branch already has 2 live offer(s)%', 'owner cannot push a branch over its limit');
select pg_temp.check(pg_temp.err($$select public.set_offer_branches((select v from ids where k = 'o_edap'), true, null)$$)
  like '%for all branches%', 'switching to all branches checks the brand-wide limit');
reset role;

-- Customers see offers by branch ---------------------------------------------------------------------
update public.offers set status = 'approved' where shop_id = (select v from ids where k = 'shop');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.live_offers where shop_id = (select v from ids where k = 'shop')) = 5,
  'customers see the live offers');
select pg_temp.check((select offer_count from public.search_shops(10.01, 76.35) where shop_id = (select v from ids where k = 'shop')) = 4
  and (select branch_slug from public.search_shops(10.01, 76.35) where shop_id = (select v from ids where k = 'shop')) = 'kakkanad',
  'shop search counts the nearest branch''s offers and gives its link');
select pg_temp.check((select branch_slug from public.search_offers(10.01, 76.35) where offer_id = (select v from ids where k = 'o_edap')) = 'edappally'
  and (select branch_slug from public.search_offers(10.01, 76.35) where offer_id = (select v from ids where k = 'o_brand1')) = 'kakkanad',
  'offer search links to the nearest branch that has the offer');
reset role;

-- Switching a login off cuts access straight away ----------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_branch_login_active('00000000-0000-0000-0000-0000000000f1', false);
select pg_temp.check((select disabled from public.vendor_team() where user_id = '00000000-0000-0000-0000-0000000000f1'),
  'team list shows the switched-off login');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select pg_temp.check(public.my_vendor() is null, 'a switched-off login has no access');
reset role;

-- Extra branches are charged on the plan invoice ----------------------------------------------------------
update public.billing_settings set gst_percent = 0;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into ids select 'inv', public.create_invoice(jsonb_build_array(jsonb_build_object('plan_id', (select v from ids where k = 'plan'))));
select pg_temp.check((select amount = 1100 and description like '%+ 1 extra branch × ₹100.00' from public.invoice_items
                      where invoice_id = (select v from ids where k = 'inv')),
  'plan invoice adds each branch over the included ones');
select pg_temp.check((public.my_billing() -> 'usage' ->> 'extra_branches')::int = 1, 'billing page shows extra branches');
reset role;

rollback;
