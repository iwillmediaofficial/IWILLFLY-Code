-- Phase 0 gate: RLS checks. Run against a LOCAL database only (never production):
--   supabase start && supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000c', 'customer@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'vendor@test.local'),
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local');
-- the sign-up trigger gave everyone 'customer'; promote two of them
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-00000000000b', 'vendor'),
  ('00000000-0000-0000-0000-00000000000a', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'RLS TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Customer
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select pg_temp.check((select count(*) from public.profiles) = 1, 'customer sees only own profile');
select pg_temp.check((select count(*) from public.user_roles) = 1, 'customer sees only own role');
select pg_temp.check((select count(*) from public.categories) = 6, 'customer reads categories');
do $$ begin
  insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000c', 'admin');
  raise exception 'RLS TEST FAILED: customer granted self admin';
exception when insufficient_privilege then raise notice 'ok - customer cannot grant roles';
end $$;
do $$ begin
  insert into public.categories (name, slug) values ('Hack', 'hack');
  raise exception 'RLS TEST FAILED: customer inserted category';
exception when insufficient_privilege then raise notice 'ok - customer cannot add categories';
end $$;
update public.profiles set full_name = 'x' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from public.profiles where full_name = 'x') = 0, 'customer cannot edit another profile');
reset role;

-- Vendor
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select pg_temp.check((select count(*) from public.user_roles) = 2, 'vendor sees own two roles');
select pg_temp.check((select count(*) from public.profiles) = 1, 'vendor sees only own profile');
reset role;

-- Admin
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.check((select count(*) from public.profiles) = 3, 'admin sees all profiles');
insert into public.categories (name, slug) values ('Jewellery', 'jewellery');
select pg_temp.check((select count(*) from public.categories) = 7, 'admin adds a category');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000c', 'vendor');
select pg_temp.check(true, 'admin grants vendor role');
do $$ begin
  insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000c', 'super_admin');
  raise exception 'RLS TEST FAILED: admin granted super_admin';
exception when insufficient_privilege then raise notice 'ok - admin cannot grant super_admin';
end $$;
reset role;

-- Anonymous visitor
set local role anon;
select pg_temp.check((select count(*) from public.categories) = 7, 'anon reads active categories');
select pg_temp.check((select count(*) from public.profiles) = 0, 'anon sees no profiles');
reset role;

rollback;
