-- Load test for play_scratch: 2,000 customers and a campaign with 50 prizes. LOCAL database only.
-- Run: psql <local url> -tA -f scratch_setup.sql   (prints the campaign id), then
--      pgbench <local url> -n -c 40 -j 8 -t 125 -D camp=<id> -f scratch_play.pgbench
-- then: CAMP=<id> psql <local url> -f scratch_check.sql   (stock must match wins; nobody plays twice a day).
insert into auth.users (id, email, raw_user_meta_data)
  select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'load' || g || '@test.local', '{}'
  from generate_series(1, 2000) g;
insert into public.scratch_campaigns (name, is_active, active_from, active_to) values ('Load test', true, '00:00', '23:59');
insert into public.scratch_prizes (campaign_id, name, quantity, probability, is_active)
  select id, 'Coupon A', 40, 0.30, true from public.scratch_campaigns where name = 'Load test';
insert into public.scratch_prizes (campaign_id, name, quantity, probability, is_active)
  select id, 'Coupon B', 10, 0.20, true from public.scratch_campaigns where name = 'Load test';
select id from public.scratch_campaigns where name = 'Load test';
