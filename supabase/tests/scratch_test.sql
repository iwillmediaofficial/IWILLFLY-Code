-- Phase 2 gate: Scratch & Win rules, RLS and stock accounting. Run against a LOCAL database only (never production):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tA -v ON_ERROR_STOP=1 -f supabase/tests/scratch_test.sql
-- Everything runs in one transaction and is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local', '{"full_name":"Anjali Menon"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'c3@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c4', 'c4@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000c5', 'c5@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'vendor2@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'manager@test.local', '{}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000d1', 'campaign_manager');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'SCRATCH TEST FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- results of plays, kept outside RLS so later steps can refer to them
create temp table r (who text primary key, res jsonb);
grant all on r to authenticated, anon;

-- Two vendors apply; only vendor 1 is approved
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.apply_as_vendor('Lulu Fashion', null, null);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select public.apply_as_vendor('Fresh Mart', null, null);
reset role;
update public.vendors set status = 'approved'
  where owner_id = '00000000-0000-0000-0000-0000000000b1';

-- A campaign manager sets up an all-day campaign
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into public.scratch_campaigns (name, active_from, active_to, is_active, claim_valid_days)
  values ('Onam Scratch', '00:00', '23:59:59', true, 7);
select pg_temp.check((select created_by from public.scratch_campaigns) = '00000000-0000-0000-0000-0000000000d1',
  'campaign records who created it');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
do $$ begin
  insert into public.scratch_campaigns (name, is_active) values ('Fake', true);
  raise exception 'SCRATCH TEST FAILED: customer created a campaign';
exception when insufficient_privilege then raise notice 'ok - customers cannot create campaigns';
end $$;
select pg_temp.check((select count(*) from public.scratch_today()) = 1, 'customer sees today''s campaign');
reset role;

-- Vendors join and stock a prize
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
do $$ begin
  insert into public.campaign_vendors (campaign_id, vendor_id)
    select (select id from public.scratch_campaigns), (select id from public.vendors);
  raise exception 'SCRATCH TEST FAILED: pending vendor joined a campaign';
exception when insufficient_privilege then raise notice 'ok - a vendor awaiting approval cannot join';
end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.campaign_vendors (campaign_id, vendor_id)
  select (select id from public.scratch_campaigns), (select id from public.vendors);
insert into public.scratch_prizes (campaign_id, sponsor_vendor_id, name, quantity, remaining, probability, is_active)
  select (select id from public.scratch_campaigns), (select id from public.vendors), 'Free T-shirt', 2, 50, 0.9, true;
select pg_temp.check((select (not is_active) and probability = 0 and remaining = 2 from public.scratch_prizes),
  'vendor prize starts switched off with no chance, stock = quantity');
update public.scratch_prizes set quantity = 3, probability = 1, is_active = true, remaining = 99;
select pg_temp.check((select quantity = 3 and remaining = 3 and probability = 0 and not is_active from public.scratch_prizes),
  'vendor raises stock but cannot set chance, switch on, or edit remaining');
do $$ begin
  insert into public.scratch_prizes (campaign_id, sponsor_vendor_id, name, quantity)
    select (select id from public.scratch_campaigns), (select id from public.vendors) + 1, 'Hijack', 1;
  raise exception 'SCRATCH TEST FAILED: vendor sponsored a prize as another vendor';
exception when insufficient_privilege then raise notice 'ok - vendors sponsor prizes only as themselves';
end $$;
reset role;

select pg_temp.act_as(null);
set local role anon;
select pg_temp.check((select count(*) from public.scratch_prizes) = 0, 'switched-off prize is hidden from the public');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
update public.scratch_prizes set probability = 1, is_active = true;
select pg_temp.check((select probability = 1 and is_active and remaining = 3 from public.scratch_prizes),
  'manager switches the prize on with a 100% chance');
reset role;

select pg_temp.act_as(null);
set local role anon;
select pg_temp.check((select count(*) from public.scratch_prizes) = 1, 'live prize is public');
do $$ begin
  perform public.play_scratch((select id from public.scratch_campaigns));
  raise exception 'SCRATCH TEST FAILED: anon played';
exception when insufficient_privilege then raise notice 'ok - signed-out visitors cannot play';
end $$;
reset role;

-- Customer 1 wins; a second scratch the same day returns the same result
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into r select 'c1', public.play_scratch((select id from public.scratch_campaigns));
select pg_temp.check((select res->>'status' = 'won' and res->>'claim_code' ~ '^[A-Z2-9]{8}$'
  and res->>'claim_status' = 'unclaimed' and res->'prize'->>'name' = 'Free T-shirt'
  and res->'sponsor'->>'name' = 'Lulu Fashion' from r where who = 'c1'), 'customer wins with an 8-character claim code');
select pg_temp.check((select remaining from public.scratch_prizes) = 2, 'stock drops by one');
select pg_temp.check((select (x->>'status') = 'already_played' and x->>'claim_code' = (select res->>'claim_code' from r where who = 'c1')
  from public.play_scratch((select id from public.scratch_campaigns)) x), 'second scratch today shows the first result');
select pg_temp.check((select remaining from public.scratch_prizes) = 2, 'a repeat scratch takes no stock');
select pg_temp.check((select today_play->>'play_id' is not null from public.scratch_today()), 'today''s play shows on the campaign');
select pg_temp.check((select count(*) from public.my_prizes()) = 1, 'win appears in My Prizes');
do $$ begin
  insert into public.scratch_plays (campaign_id, customer_id, play_date, won)
    select id, '00000000-0000-0000-0000-0000000000c1', current_date + 1, false from public.scratch_campaigns;
  raise exception 'SCRATCH TEST FAILED: customer inserted a play';
exception when insufficient_privilege then raise notice 'ok - customers cannot write plays directly';
end $$;
update public.scratch_plays set claim_status = 'claimed';
select pg_temp.check((select claim_status = 'unclaimed' from public.scratch_plays), 'customer cannot mark their own prize claimed');
reset role;

-- The sponsor's owner never wins their own prize
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select x->>'status' = 'lost' from public.play_scratch((select id from public.scratch_campaigns)) x),
  'sponsor cannot win their own prize');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
insert into r select 'c2', public.play_scratch((select id from public.scratch_campaigns));
select pg_temp.check((select count(*) from public.scratch_plays) = 1, 'customer sees only their own plays');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
set local role authenticated;
insert into r select 'c3', public.play_scratch((select id from public.scratch_campaigns));
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');
set local role authenticated;
insert into r select 'c4', public.play_scratch((select id from public.scratch_campaigns));
reset role;
select pg_temp.check((select string_agg(res->>'status', ',' order by who) from r) = 'won,won,won,lost',
  'three prizes go to three winners, then stock runs out and the next customer loses');
select pg_temp.check((select remaining from public.scratch_prizes) = 0, 'stock is exactly zero');

-- Quantity can be raised but never below what was already won
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  update public.scratch_prizes set quantity = 2;
  raise exception 'SCRATCH TEST FAILED: quantity dropped below prizes won';
exception when check_violation then raise notice 'ok - quantity cannot drop below prizes already won';
end $$;

-- Vendor winners list and claim verification
select pg_temp.check((select count(*) from public.vendor_winners()) = 3, 'vendor sees their three winners');
select pg_temp.check((select customer_name from public.vendor_winners() where customer_name <> 'Customer') = 'Anjali M.',
  'winner names are masked');
reset role;

update public.vendors set status = 'approved' where owner_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select pg_temp.check((select public.claim_prize((select res->>'claim_code' from r where who = 'c1'), true)->>'status') = 'not_found',
  'another vendor cannot look up or claim the code');
select pg_temp.check((select count(*) from public.vendor_winners()) = 0, 'another vendor sees no winners');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select x->>'status' = 'unclaimed' and x->>'customer_name' = 'Anjali M.' and not (x ? 'sponsor')
  from public.claim_prize((select lower(substr(res->>'claim_code', 1, 4)) || '-' || substr(res->>'claim_code', 5) from r where who = 'c1')) x),
  'sponsor looks up a code typed in lower case with a dash');
select pg_temp.check((select public.claim_prize((select res->>'claim_code' from r where who = 'c1'), true)->>'status') = 'claimed_now',
  'sponsor hands the prize over');
select pg_temp.check((select public.claim_prize((select res->>'claim_code' from r where who = 'c1'), true)->>'status') = 'claimed',
  'a prize cannot be claimed twice');
select pg_temp.check((select public.claim_prize('ZZZZZZZZ')->>'status') = 'not_found', 'unknown code is not found');
reset role;

-- Fraud flag blocks the claim; managers cannot edit results directly
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
update public.scratch_plays set fraud_flag = true, fraud_note = 'Same phone as c3'
  where claim_code = (select res->>'claim_code' from r where who = 'c2');
do $$ begin
  update public.scratch_plays set claim_status = 'claimed' where claim_code = (select res->>'claim_code' from r where who = 'c2');
  raise exception 'SCRATCH TEST FAILED: manager edited a claim directly';
exception when insufficient_privilege then raise notice 'ok - results change only through the claim flow';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select public.claim_prize((select res->>'claim_code' from r where who = 'c2'), true)->>'status') = 'flagged',
  'a flagged prize cannot be handed over');
reset role;

-- Expiry
update public.scratch_plays set expires_at = now() - interval '1 minute'
  where claim_code = (select res->>'claim_code' from r where who = 'c3');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
set local role authenticated;
select pg_temp.check((select x->>'claim_status' from public.my_prizes() x) = 'expired', 'an expired prize shows as expired');
do $$ begin
  perform public.expire_scratch_claims();
  raise exception 'SCRATCH TEST FAILED: customer ran the expiry job';
exception when insufficient_privilege then raise notice 'ok - only the scheduler runs the expiry job';
end $$;
reset role;
select pg_temp.check(public.expire_scratch_claims() = 1, 'expiry job marks one prize expired');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.check((select public.claim_prize((select res->>'claim_code' from r where who = 'c3'), true)->>'status') = 'expired',
  'an expired prize cannot be handed over');
reset role;

-- Stock accounting (the Phase 2 gate) and manager-only reports
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.check((select given_out = won and won = 3 and claimed = 1 and expired = 1 and unclaimed = 1
  and plays_total = 5 and players = 5 from public.campaign_stats((select id from public.scratch_campaigns))),
  'stock given out matches prizes won exactly');
select pg_temp.check((select count(*) from public.campaign_winners((select id from public.scratch_campaigns)) where customer_email like '%@test.local') = 3,
  'manager sees full winner history');
do $$ begin
  delete from public.scratch_prizes;
  raise exception 'SCRATCH TEST FAILED: deleted a prize that has winners';
exception when foreign_key_violation then raise notice 'ok - prizes with winners cannot be deleted';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
do $$ begin
  perform public.campaign_stats((select id from public.scratch_campaigns));
  raise exception 'SCRATCH TEST FAILED: vendor read campaign stats';
exception when insufficient_privilege then raise notice 'ok - only managers see campaign stats';
end $$;
reset role;

-- Win cap: a customer who already won once in this campaign cannot win again
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into public.scratch_campaigns (name, active_from, active_to, is_active, max_wins_per_customer)
  values ('Capped', '00:00', '23:59:59', true, 1);
insert into public.scratch_prizes (campaign_id, name, quantity, probability, is_active)
  select id, 'Coffee', 10, 1, true from public.scratch_campaigns where name = 'Capped';
reset role;
insert into public.scratch_plays (campaign_id, customer_id, play_date, prize_id, won, claim_code, claim_status, expires_at)
  select c.id, '00000000-0000-0000-0000-0000000000c5', private.today_ist() - 1, p.id, true, 'CAPTEST2', 'claimed', now()
  from public.scratch_campaigns c join public.scratch_prizes p on p.campaign_id = c.id where c.name = 'Capped';
update public.scratch_prizes set remaining = remaining - 1 where name = 'Coffee';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c5');
set local role authenticated;
select pg_temp.check((select x->>'status' = 'lost' from public.play_scratch((select id from public.scratch_campaigns where name = 'Capped')) x),
  'customer at the win cap always loses');
reset role;

-- Area eligibility
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into public.scratch_campaigns (name, active_from, active_to, is_active, location_id)
  select 'Kochi only', '00:00', '23:59:59', true, id from public.locations where slug = 'kochi';
reset role;
update public.profiles set location_id = (select id from public.locations where slug = 'edappally')
  where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select pg_temp.check((select not eligible from public.scratch_today() where name = 'Kochi only'), 'customer without an area is not eligible');
do $$ begin
  perform public.play_scratch((select id from public.scratch_campaigns where name = 'Kochi only'));
  raise exception 'SCRATCH TEST FAILED: customer outside the area played';
exception when raise_exception then raise notice 'ok - customers outside the area cannot play';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select eligible from public.scratch_today() where name = 'Kochi only'), 'customer in an area inside Kochi is eligible');
select pg_temp.check((select x->>'status' = 'lost' from public.play_scratch((select id from public.scratch_campaigns where name = 'Kochi only')) x),
  'eligible customer plays (no prizes, so a loss)');
reset role;

-- Opening hours and start date
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into public.scratch_campaigns (name, active_from, active_to, is_active)
  select 'Closed now',
    case when lt < '23:00' then (lt + interval '30 minutes')::time else '00:00'::time end,
    case when lt < '23:00' then '23:59:59'::time else '00:01'::time end, true
  from (select (now() at time zone 'Asia/Kolkata')::time as lt) t;
insert into public.scratch_campaigns (name, active_from, active_to, is_active, starts_on)
  values ('Starts tomorrow', '00:00', '23:59:59', true, private.today_ist() + 1);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
set local role authenticated;
select pg_temp.check((select not is_open_now from public.scratch_today() where name = 'Closed now'), 'campaign outside its hours shows as closed');
select pg_temp.check(not exists (select 1 from public.scratch_today() where name = 'Starts tomorrow'), 'future campaign is not listed today');
do $$ begin
  perform public.play_scratch((select id from public.scratch_campaigns where name = 'Closed now'));
  raise exception 'SCRATCH TEST FAILED: played outside opening hours';
exception when raise_exception then raise notice 'ok - no scratching outside opening hours';
end $$;
reset role;

rollback;
