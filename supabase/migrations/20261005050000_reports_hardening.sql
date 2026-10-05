-- IWILLFLY Phase 5: admin reports, plus the fixes the Supabase performance advisor asked for.

-- Performance advisor ------------------------------------------------------------------------------

-- offer_stats_daily had no primary key (offer_id is null for shop-level counters, so the natural key
-- can't be one). The upsert key stays the existing unique (day, shop_id, offer_id).
alter table public.offer_stats_daily add column id bigint generated always as identity primary key;

-- One read policy per role instead of two, so Postgres checks one expression per row.
drop policy "vendors: read own or admin" on public.vendors;
drop policy "vendors: team read" on public.vendors;
create policy "vendors: read own, team or admin" on public.vendors
  for select to authenticated
  using (owner_id = (select auth.uid()) or id = (select private.my_member_vendor_id()) or (select private.is_admin()));

drop policy "shops: public read live" on public.shops;
drop policy "shops: team read" on public.shops;
create policy "shops: public read live" on public.shops
  for select to anon
  using (is_active and private.vendor_is_live(vendor_id));
create policy "shops: read live, own team or admin" on public.shops
  for select to authenticated
  using ((is_active and private.vendor_is_live(vendor_id)) or private.can_see_own_shop(id) or (select private.is_admin()));

-- Reports -----------------------------------------------------------------------------------------

-- The city each location belongs to (an area maps to its city; a city maps to itself). Locations above
-- city level (state, district) map to themselves so nothing is dropped.
create or replace function private.location_city()
returns table (location_id bigint, city_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select l.id as location_id, l.id as cur, l.parent_id, l.kind
    from public.locations l
    union all
    select up.location_id, p.id, p.parent_id, p.kind
    from up join public.locations p on p.id = up.parent_id
    where up.kind <> 'city'
  )
  select l.id, coalesce((select u.cur from up u where u.location_id = l.id and u.kind = 'city' limit 1), l.id)
  from public.locations l;
$$;
revoke execute on function private.location_city() from public, anon, authenticated;

-- Admin reports for a date range (India dates, at most a year): growth, offer performance, locations
-- and Scratch & Win claims. Admins and super admins only.
create or replace function public.admin_reports(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d_to date := least(coalesce(p_to, private.today_ist()), private.today_ist());
  d_from date := greatest(coalesce(p_from, d_to - 29), d_to - 365);
  t_from timestamptz := d_from::timestamp at time zone 'Asia/Kolkata';
  t_to timestamptz := (d_to + 1)::timestamp at time zone 'Asia/Kolkata';
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d_from > d_to then
    raise exception 'The start date must be before the end date' using errcode = '22023';
  end if;

  return (
    with
    customers as (
      select p.id, p.created_at, p.location_id from public.profiles p
      where not exists (select 1 from public.user_roles r
                        where r.user_id = p.id and r.role in ('vendor', 'admin', 'super_admin', 'support',
                                                              'campaign_manager'))
    ),
    weeks as (
      select w::date as week
      from generate_series(date_trunc('week', d_from::timestamp), d_to::timestamp, interval '1 week') w
    ),
    wk as (select (date_trunc('week', (ts at time zone 'Asia/Kolkata')))::date as week, kind
           from (select created_at as ts, 'customers' as kind from customers
                 union all select created_at, 'vendors' from public.vendors
                 union all select created_at, 'shops' from public.shops
                 union all select created_at, 'offers' from public.offers) x
           where ts >= t_from and ts < t_to),
    stats as (select * from public.offer_stats_daily where day between d_from and d_to),
    city as (select * from private.location_city()),
    shop_city as (
      select distinct b.shop_id, c.city_id from public.branches b join city c on c.location_id = b.location_id
    ),
    plays as (
      select * from public.scratch_plays where played_at >= t_from and played_at < t_to
    )
    select jsonb_build_object(
      'from', d_from,
      'to', d_to,

      'growth', jsonb_build_object(
        'totals', jsonb_build_object(
          'customers', (select count(*) from customers),
          'vendors', (select count(*) from public.vendors),
          'vendors_approved', (select count(*) from public.vendors where status = 'approved'),
          'shops', (select count(*) from public.shops),
          'offers_live', (select count(*) from public.offers o
                          where o.status = 'approved' and not o.is_paused
                            and o.starts_on <= d_to and (o.ends_on is null or o.ends_on >= private.today_ist()))),
        'new', jsonb_build_object(
          'customers', (select count(*) from wk where kind = 'customers'),
          'vendors', (select count(*) from wk where kind = 'vendors'),
          'shops', (select count(*) from wk where kind = 'shops'),
          'offers', (select count(*) from wk where kind = 'offers')),
        'weekly', coalesce((select jsonb_agg(jsonb_build_object(
            'week', w.week,
            'customers', (select count(*) from wk where wk.week = w.week and kind = 'customers'),
            'vendors', (select count(*) from wk where wk.week = w.week and kind = 'vendors'),
            'shops', (select count(*) from wk where wk.week = w.week and kind = 'shops'),
            'offers', (select count(*) from wk where wk.week = w.week and kind = 'offers')) order by w.week)
          from weeks w), '[]'::jsonb)
      ),

      'offers', jsonb_build_object(
        'by_status', jsonb_build_object(
          'pending', (select count(*) from public.offers where status = 'pending'),
          'approved', (select count(*) from public.offers where status = 'approved'),
          'rejected', (select count(*) from public.offers where status = 'rejected'),
          'paused', (select count(*) from public.offers where is_paused),
          'expiring_7d', (select count(*) from public.offers
                          where status = 'approved' and ends_on between private.today_ist() and private.today_ist() + 7)),
        'totals', (select jsonb_build_object('views', coalesce(sum(views), 0), 'clicks', coalesce(sum(clicks), 0),
                     'saves', coalesce(sum(saves), 0), 'leads', coalesce(sum(whatsapp + calls + directions), 0))
                   from stats),
        'top', coalesce((select jsonb_agg(x) from (
            select o.id as offer_id, o.title, sh.name as shop_name, sum(s.views)::int as views,
                   sum(s.clicks)::int as clicks, sum(s.saves)::int as saves,
                   sum(s.whatsapp + s.calls + s.directions)::int as leads
            from stats s join public.offers o on o.id = s.offer_id join public.shops sh on sh.id = o.shop_id
            group by o.id, o.title, sh.name
            order by sum(s.views) desc, sum(s.clicks) desc, o.id
            limit 20) x), '[]'::jsonb),
        'no_views', coalesce((select jsonb_agg(x) from (
            select o.id as offer_id, o.title, sh.name as shop_name
            from public.offers o join public.shops sh on sh.id = o.shop_id
            where o.status = 'approved' and not o.is_paused
              and (o.ends_on is null or o.ends_on >= private.today_ist())
              and not exists (select 1 from stats s where s.offer_id = o.id and s.views > 0)
            order by o.created_at
            limit 20) x), '[]'::jsonb),
        'by_category', coalesce((select jsonb_agg(x order by x.views desc, x.category) from (
            select coalesce(c.name, 'No category') as category, count(distinct s.offer_id)::int as offers,
                   sum(s.views)::int as views, sum(s.clicks)::int as clicks,
                   sum(s.whatsapp + s.calls + s.directions)::int as leads
            from stats s join public.offers o on o.id = s.offer_id
            left join public.categories c on c.id = o.category_id
            group by c.name) x), '[]'::jsonb)
      ),

      'locations', coalesce((select jsonb_agg(x order by x.shops desc, x.customers desc, x.name) from (
          select l.id as location_id, l.name, l.kind,
                 (select count(*) from shop_city sc where sc.city_id = l.id)::int as shops,
                 (select count(*) from public.offers o join shop_city sc on sc.shop_id = o.shop_id
                  where sc.city_id = l.id and o.status = 'approved' and not o.is_paused
                    and (o.ends_on is null or o.ends_on >= private.today_ist()))::int as live_offers,
                 (select count(*) from customers cu join city c on c.location_id = cu.location_id
                  where c.city_id = l.id)::int as customers,
                 (select coalesce(sum(s.views), 0) from stats s join shop_city sc on sc.shop_id = s.shop_id
                  where sc.city_id = l.id)::int as views,
                 (select count(*) from plays p join public.scratch_campaigns sc on sc.id = p.campaign_id
                  join city c on c.location_id = sc.location_id where c.city_id = l.id)::int as plays
          from public.locations l
          where l.id in (select city_id from city)
        ) x where x.shops + x.customers + x.views + x.plays > 0), '[]'::jsonb),

      'claims', jsonb_build_object(
        'totals', (select jsonb_build_object(
                     'plays', count(*),
                     'wins', count(*) filter (where won),
                     'claimed', count(*) filter (where claim_status = 'claimed'),
                     'unclaimed', count(*) filter (where claim_status = 'unclaimed'),
                     'expired', count(*) filter (where claim_status = 'expired'),
                     'flagged', count(*) filter (where fraud_flag),
                     'players', count(distinct customer_id))
                   from plays),
        'campaigns', coalesce((select jsonb_agg(x order by x.plays desc) from (
            select c.id as campaign_id, c.name, count(*)::int as plays, count(*) filter (where p.won)::int as wins,
                   count(*) filter (where p.claim_status = 'claimed')::int as claimed,
                   count(*) filter (where p.claim_status = 'unclaimed')::int as unclaimed,
                   count(*) filter (where p.claim_status = 'expired')::int as expired,
                   (select coalesce(sum(z.remaining), 0) from public.scratch_prizes z where z.campaign_id = c.id)::int
                     as stock_left
            from plays p join public.scratch_campaigns c on c.id = p.campaign_id
            group by c.id, c.name) x), '[]'::jsonb),
        'vendors', coalesce((select jsonb_agg(x order by x.wins desc) from (
            select v.id as vendor_id, v.business_name, count(*)::int as wins,
                   count(*) filter (where p.claim_status = 'claimed')::int as claimed,
                   count(*) filter (where p.claim_status = 'expired')::int as expired
            from plays p join public.vendors v on v.id = p.vendor_id
            where p.won
            group by v.id, v.business_name
            limit 50) x), '[]'::jsonb)
      )
    )
  );
end;
$$;
revoke execute on function public.admin_reports(date, date) from public, anon, authenticated;
grant execute on function public.admin_reports(date, date) to authenticated;
