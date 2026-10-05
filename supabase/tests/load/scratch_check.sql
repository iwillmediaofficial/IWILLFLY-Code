-- After the load test: prize stock must match wins exactly and nobody may have two plays in one day.
\set camp `echo ${CAMP}`
select count(*) as plays, count(distinct customer_id) as players, count(*) filter (where won) as wins
from public.scratch_plays where campaign_id = :camp;
select name, quantity, remaining, (select count(*) from public.scratch_plays p where p.prize_id = z.id) as wins,
       quantity - remaining = (select count(*) from public.scratch_plays p where p.prize_id = z.id) as stock_matches
from public.scratch_prizes z where campaign_id = :camp;
select count(*) as customers_with_two_plays_in_a_day from (
  select 1 from public.scratch_plays where campaign_id = :camp group by customer_id, play_date having count(*) > 1) d;
