-- IWILLFLY Phase 1: marketplace. Vendors, shops, branches, malls, offers and saves, all with RLS.
--
-- Visibility rules
--   * A vendor applies (apply_as_vendor) and gets the vendor role at once, so they can set up shops
--     while an admin reviews them. Nothing they create is public until the vendor is approved.
--   * Customers see a shop only when it is active and its vendor is approved, and an offer only when
--     it is also approved, not paused and inside its dates (India time).
--   * Vendors never set status, featured or verified themselves; triggers keep those columns admin-only,
--     and editing an offer's content sends it back for review.

-- Coordinates: clients write lat/lng, PostGIS geography is derived for distance queries ----------

alter table public.locations drop column center;
alter table public.locations
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add column center extensions.geography(point, 4326) generated always as (
    case when lat is not null and lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
  ) stored;

update public.locations set lat = v.lat, lng = v.lng
from (values
  ('kerala', 10.1632, 76.6413),
  ('ernakulam', 10.0159, 76.3419),
  ('kochi', 9.9312, 76.2673),
  ('aluva', 10.1076, 76.3516),
  ('edappally', 10.0261, 76.3083),
  ('kakkanad', 10.0159, 76.3419),
  ('vyttila', 9.9696, 76.3209)
) as v(slug, lat, lng)
where public.locations.slug = v.slug;

-- Types -------------------------------------------------------------------------------------------

create type public.vendor_status as enum ('pending', 'approved', 'blocked');
create type public.offer_status as enum ('pending', 'approved', 'rejected');

-- Tables ------------------------------------------------------------------------------------------

create table public.vendors (
  id bigint generated always as identity primary key,
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  business_name text not null check (char_length(business_name) between 2 and 120),
  contact_phone text check (char_length(contact_phone) <= 20),
  whatsapp text check (char_length(whatsapp) <= 20),
  status public.vendor_status not null default 'pending',
  is_verified boolean not null default false,
  admin_note text check (char_length(admin_note) <= 500),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vendors_status_idx on public.vendors (status);
create index vendors_reviewed_by_idx on public.vendors (reviewed_by);

create table public.shops (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  category_id bigint references public.categories (id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 1000),
  logo_key text,                        -- R2 object keys, not URLs
  cover_key text,
  phone text check (char_length(phone) <= 20),
  whatsapp text check (char_length(whatsapp) <= 20),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shops_vendor_idx on public.shops (vendor_id);
create index shops_category_idx on public.shops (category_id);

create table public.branches (
  id bigint generated always as identity primary key,
  shop_id bigint not null references public.shops (id) on delete cascade,
  name text not null default 'Main branch' check (char_length(name) between 1 and 80),
  address text check (char_length(address) <= 300),
  location_id bigint references public.locations (id) on delete set null,   -- the area it sits in
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geo extensions.geography(point, 4326) generated always as (
    case when lat is not null and lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
  ) stored,
  phone text check (char_length(phone) <= 20),
  -- {"mon": {"open": "09:00", "close": "21:00"}, ...}; a missing day means closed that day
  hours jsonb not null default '{}'::jsonb check (jsonb_typeof(hours) = 'object'),
  holidays date[] not null default '{}' check (cardinality(holidays) <= 60),
  temp_closed boolean not null default false,
  temp_closed_note text check (char_length(temp_closed_note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index branches_shop_idx on public.branches (shop_id);
create index branches_location_idx on public.branches (location_id);
create index branches_geo_idx on public.branches using gist (geo);

create table public.malls (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique,
  description text check (char_length(description) <= 1000),
  address text check (char_length(address) <= 300),
  location_id bigint references public.locations (id) on delete set null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geo extensions.geography(point, 4326) generated always as (
    case when lat is not null and lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
  ) stored,
  cover_key text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index malls_location_idx on public.malls (location_id);

-- A branch sits in at most one mall.
create table public.mall_shops (
  mall_id bigint not null references public.malls (id) on delete cascade,
  branch_id bigint not null unique references public.branches (id) on delete cascade,
  floor text check (char_length(floor) <= 40),
  primary key (mall_id, branch_id)
);

create table public.offers (
  id bigint generated always as identity primary key,
  shop_id bigint not null references public.shops (id) on delete cascade,
  category_id bigint references public.categories (id) on delete set null,   -- product filter
  title text not null check (char_length(title) between 2 and 120),
  product_name text check (char_length(product_name) <= 120),
  description text check (char_length(description) <= 2000),
  original_price numeric(10, 2) check (original_price >= 0),
  offer_price numeric(10, 2) check (offer_price >= 0),
  discount_label text check (char_length(discount_label) <= 30),            -- "50% OFF", "Buy 2 Get 1"
  image_keys text[] not null default '{}' check (cardinality(image_keys) <= 5),
  starts_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on date,
  status public.offer_status not null default 'pending',
  is_paused boolean not null default false,
  is_featured boolean not null default false,
  reject_reason text check (char_length(reject_reason) <= 300),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (offer_price is null or original_price is null or offer_price <= original_price)
);
create index offers_shop_idx on public.offers (shop_id);
create index offers_category_idx on public.offers (category_id);
create index offers_status_idx on public.offers (status) where status = 'pending';
create index offers_reviewed_by_idx on public.offers (reviewed_by);

create table public.saved_offers (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  offer_id bigint not null references public.offers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, offer_id)
);
create index saved_offers_offer_idx on public.saved_offers (offer_id);

create table public.saved_shops (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  shop_id bigint not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);
create index saved_shops_shop_idx on public.saved_shops (shop_id);

create trigger vendors_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();
create trigger shops_updated_at before update on public.shops
  for each row execute function public.set_updated_at();
create trigger branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();
create trigger offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();

-- Helpers (security definer, so policies can look at vendors without recursing into its RLS) ------

create or replace function private.today_ist()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- The caller's vendor id, unless they are blocked.
create or replace function private.my_vendor_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked';
$$;

create or replace function private.vendor_is_live(v bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.vendors where id = v and status = 'approved') $$;

create or replace function private.owns_shop(s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops sh join public.vendors v on v.id = sh.vendor_id
    where sh.id = s and v.owner_id = (select auth.uid()) and v.status <> 'blocked'
  );
$$;

-- Read access for the owner, even while blocked, so they can still see their data.
create or replace function private.can_see_own_shop(s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops sh join public.vendors v on v.id = sh.vendor_id
    where sh.id = s and v.owner_id = (select auth.uid())
  );
$$;

create or replace function private.shop_is_live(s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops sh join public.vendors v on v.id = sh.vendor_id
    where sh.id = s and sh.is_active and v.status = 'approved'
  );
$$;

revoke execute on function private.today_ist(), private.my_vendor_id(), private.vendor_is_live(bigint),
  private.owns_shop(bigint), private.can_see_own_shop(bigint), private.shop_is_live(bigint) from public;
grant execute on function private.today_ist(), private.my_vendor_id(), private.vendor_is_live(bigint),
  private.owns_shop(bigint), private.can_see_own_shop(bigint), private.shop_is_live(bigint) to anon, authenticated;

-- Admin-only columns ------------------------------------------------------------------------------

-- Direct database sessions (migrations, service role) are trusted; app users go through the checks.
create or replace function private.is_app_admin_or_service()
returns boolean
language sql
stable
set search_path = ''
as $$ select current_user not in ('anon', 'authenticated') or (select private.is_admin()) $$;
grant execute on function private.is_app_admin_or_service() to anon, authenticated;

create or replace function public.guard_vendor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_app_admin_or_service() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
    end if;
    return new;
  end if;
  new.owner_id := old.owner_id;
  new.status := old.status;
  new.is_verified := old.is_verified;
  new.admin_note := old.admin_note;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  return new;
end;
$$;
create trigger vendors_guard before update on public.vendors
  for each row execute function public.guard_vendor();

create or replace function public.guard_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_app_admin_or_service() then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.reviewed_by := case when new.status = 'pending' then null else (select auth.uid()) end;
      new.reviewed_at := case when new.status = 'pending' then null else now() end;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.is_featured := false;
    new.reject_reason := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;
  new.shop_id := old.shop_id;
  new.status := old.status;
  new.is_featured := old.is_featured;
  new.reject_reason := old.reject_reason;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  -- Any change customers would see goes back to review; pausing or resuming does not.
  if (new.title, new.product_name, new.description, new.original_price, new.offer_price,
      new.discount_label, new.image_keys, new.starts_on, new.ends_on, new.category_id)
     is distinct from
     (old.title, old.product_name, old.description, old.original_price, old.offer_price,
      old.discount_label, old.image_keys, old.starts_on, old.ends_on, old.category_id) then
    new.status := 'pending';
    new.is_featured := false;
    new.reject_reason := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
create trigger offers_guard before insert or update on public.offers
  for each row execute function public.guard_offer();

revoke execute on function public.guard_vendor(), public.guard_offer() from public, anon, authenticated;

-- Row Level Security --------------------------------------------------------------------------------

alter table public.vendors enable row level security;
alter table public.shops enable row level security;
alter table public.branches enable row level security;
alter table public.malls enable row level security;
alter table public.mall_shops enable row level security;
alter table public.offers enable row level security;
alter table public.saved_offers enable row level security;
alter table public.saved_shops enable row level security;

-- vendors: owners see and edit their own business details; admins manage all. Rows are created by apply_as_vendor().
create policy "vendors: read own or admin" on public.vendors
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_admin()));
create policy "vendors: update own or admin" on public.vendors
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_admin()))
  with check (owner_id = (select auth.uid()) or (select private.is_admin()));
create policy "vendors: admin delete" on public.vendors
  for delete to authenticated using ((select private.is_admin()));

-- shops
create policy "shops: public read live" on public.shops
  for select to anon, authenticated
  using (
    (is_active and private.vendor_is_live(vendor_id))
    or vendor_id in (select v.id from public.vendors v where v.owner_id = (select auth.uid()))
    or (select private.is_admin())
  );
create policy "shops: vendor or admin insert" on public.shops
  for insert to authenticated
  with check (vendor_id = (select private.my_vendor_id()) or (select private.is_admin()));
create policy "shops: vendor or admin update" on public.shops
  for update to authenticated
  using (vendor_id = (select private.my_vendor_id()) or (select private.is_admin()))
  with check (vendor_id = (select private.my_vendor_id()) or (select private.is_admin()));
create policy "shops: vendor or admin delete" on public.shops
  for delete to authenticated
  using (vendor_id = (select private.my_vendor_id()) or (select private.is_admin()));

-- branches
create policy "branches: public read live" on public.branches
  for select to anon, authenticated
  using (private.shop_is_live(shop_id) or private.can_see_own_shop(shop_id) or (select private.is_admin()));
create policy "branches: vendor or admin insert" on public.branches
  for insert to authenticated
  with check (private.owns_shop(shop_id) or (select private.is_admin()));
create policy "branches: vendor or admin update" on public.branches
  for update to authenticated
  using (private.owns_shop(shop_id) or (select private.is_admin()))
  with check (private.owns_shop(shop_id) or (select private.is_admin()));
create policy "branches: vendor or admin delete" on public.branches
  for delete to authenticated
  using (private.owns_shop(shop_id) or (select private.is_admin()));

-- malls and mall_shops: everyone reads, admins manage
create policy "malls: public read" on public.malls
  for select to anon, authenticated
  using (is_active or (select private.is_admin()));
create policy "malls: admin insert" on public.malls
  for insert to authenticated with check ((select private.is_admin()));
create policy "malls: admin update" on public.malls
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "malls: admin delete" on public.malls
  for delete to authenticated using ((select private.is_admin()));

create policy "mall_shops: public read" on public.mall_shops
  for select to anon, authenticated using (true);
create policy "mall_shops: admin insert" on public.mall_shops
  for insert to authenticated with check ((select private.is_admin()));
create policy "mall_shops: admin update" on public.mall_shops
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "mall_shops: admin delete" on public.mall_shops
  for delete to authenticated using ((select private.is_admin()));

-- offers
create policy "offers: public read live" on public.offers
  for select to anon, authenticated
  using (
    (status = 'approved' and not is_paused
      and starts_on <= (select private.today_ist())
      and (ends_on is null or ends_on >= (select private.today_ist()))
      and private.shop_is_live(shop_id))
    or private.can_see_own_shop(shop_id)
    or (select private.is_admin())
  );
create policy "offers: vendor or admin insert" on public.offers
  for insert to authenticated
  with check (private.owns_shop(shop_id) or (select private.is_admin()));
create policy "offers: vendor or admin update" on public.offers
  for update to authenticated
  using (private.owns_shop(shop_id) or (select private.is_admin()))
  with check (private.owns_shop(shop_id) or (select private.is_admin()));
create policy "offers: vendor or admin delete" on public.offers
  for delete to authenticated
  using (private.owns_shop(shop_id) or (select private.is_admin()));

-- saves: each user manages their own
create policy "saved_offers: own read" on public.saved_offers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "saved_offers: own insert" on public.saved_offers
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "saved_offers: own delete" on public.saved_offers
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "saved_shops: own read" on public.saved_shops
  for select to authenticated using (user_id = (select auth.uid()));
create policy "saved_shops: own insert" on public.saved_shops
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "saved_shops: own delete" on public.saved_shops
  for delete to authenticated using (user_id = (select auth.uid()));

-- Live offers as customers see them (owners and admins included only via the same rules) ------------

create view public.live_offers with (security_invoker = true) as
select o.*
from public.offers o
where o.status = 'approved' and not o.is_paused
  and o.starts_on <= private.today_ist()
  and (o.ends_on is null or o.ends_on >= private.today_ist())
  and private.shop_is_live(o.shop_id);

-- RPCs -------------------------------------------------------------------------------------------

-- A signed-in user registers a business. Grants the vendor role so they can start setting up.
create or replace function public.apply_as_vendor(p_business_name text, p_phone text, p_whatsapp text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  vid bigint;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  insert into public.vendors (owner_id, business_name, contact_phone, whatsapp)
  values (uid, trim(p_business_name), nullif(trim(p_phone), ''), nullif(trim(p_whatsapp), ''))
  on conflict (owner_id) do nothing
  returning id into vid;
  if vid is null then
    select id into vid from public.vendors where owner_id = uid;
  end if;
  insert into public.user_roles (user_id, role) values (uid, 'vendor') on conflict do nothing;
  return vid;
end;
$$;
revoke execute on function public.apply_as_vendor(text, text, text) from public, anon;
grant execute on function public.apply_as_vendor(text, text, text) to authenticated;

-- Live shops for customers: nearest branch, its hours, mall and best offer.
-- Sorted by distance when a location is given, otherwise featured first then by name.
create or replace function public.search_shops(
  p_lat double precision default null,
  p_lng double precision default null,
  p_category text default null,
  p_q text default null,
  p_mall_id bigint default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  shop_id bigint,
  name text,
  logo_key text,
  category_slug text,
  category_name text,
  category_icon text,
  branch_id bigint,
  branch_name text,
  address text,
  lat double precision,
  lng double precision,
  distance_km double precision,
  hours jsonb,
  holidays date[],
  temp_closed boolean,
  mall_id bigint,
  mall_name text,
  offer_count int,
  top_offer text,
  featured boolean
)
language sql
stable
set search_path = ''
as $$
  with here as (
    select case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end as g
  ), pattern as (
    select case when nullif(trim(p_q), '') is not null
      then '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as q
  )
  select s.id, s.name, s.logo_key, c.slug, c.name, c.icon,
         b.id, b.name, b.address, b.lat, b.lng, b.distance_km, b.hours, b.holidays, b.temp_closed,
         m.id, m.name,
         coalesce(o.cnt, 0)::int, o.top, coalesce(o.featured, false)
  from public.shops s
  cross join here
  cross join pattern
  left join public.categories c on c.id = s.category_id
  left join lateral (
    select br.*, extensions.st_distance(br.geo, here.g) / 1000 as distance_km
    from public.branches br
    where br.shop_id = s.id
      -- on a mall page, use the branch inside that mall
      and (p_mall_id is null
           or exists (select 1 from public.mall_shops x where x.branch_id = br.id and x.mall_id = p_mall_id))
    order by extensions.st_distance(br.geo, here.g) nulls last, br.id
    limit 1
  ) b on true
  left join public.mall_shops ms on ms.branch_id = b.id
  left join public.malls m on m.id = ms.mall_id and m.is_active
  left join lateral (
    select count(*) as cnt,
           (array_agg(coalesce(lo.discount_label, lo.title) order by lo.is_featured desc, lo.created_at desc))[1] as top,
           bool_or(lo.is_featured) as featured
    from public.live_offers lo
    where lo.shop_id = s.id
  ) o on true
  where s.is_active and private.vendor_is_live(s.vendor_id)
    and (p_category is null or c.slug = p_category
         or exists (select 1 from public.live_offers lo join public.categories oc on oc.id = lo.category_id
                    where lo.shop_id = s.id and oc.slug = p_category))
    and (pattern.q is null or s.name ilike pattern.q or c.name ilike pattern.q
         or exists (select 1 from public.live_offers lo
                    where lo.shop_id = s.id
                      and (lo.title ilike pattern.q or lo.product_name ilike pattern.q
                           or lo.discount_label ilike pattern.q)))
    and (p_mall_id is null or m.id = p_mall_id)
  order by b.distance_km nulls last,
           case when here.g is null then coalesce(o.featured, false) end desc,
           s.name
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

-- Live offers for customers with their shop, nearest-first when a location is given.
create or replace function public.search_offers(
  p_lat double precision default null,
  p_lng double precision default null,
  p_category text default null,
  p_featured_only boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  offer_id bigint,
  title text,
  discount_label text,
  original_price numeric,
  offer_price numeric,
  image_key text,
  ends_on date,
  is_featured boolean,
  shop_id bigint,
  shop_name text,
  shop_logo_key text,
  category_slug text,
  category_name text,
  category_icon text,
  distance_km double precision
)
language sql
stable
set search_path = ''
as $$
  with here as (
    select case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end as g
  )
  select lo.id, lo.title, lo.discount_label, lo.original_price, lo.offer_price, lo.image_keys[1], lo.ends_on,
         lo.is_featured, s.id, s.name, s.logo_key,
         coalesce(oc.slug, sc.slug), coalesce(oc.name, sc.name), coalesce(oc.icon, sc.icon),
         d.km
  from public.live_offers lo
  cross join here
  join public.shops s on s.id = lo.shop_id
  left join public.categories oc on oc.id = lo.category_id
  left join public.categories sc on sc.id = s.category_id
  left join lateral (
    select min(extensions.st_distance(br.geo, here.g)) / 1000 as km
    from public.branches br where br.shop_id = s.id
  ) d on true
  where (p_category is null or oc.slug = p_category or (lo.category_id is null and sc.slug = p_category))
    and (not p_featured_only or lo.is_featured)
  order by d.km nulls last, lo.is_featured desc, lo.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

-- Active malls with their live shop and offer counts, nearest first when a location is given.
create or replace function public.list_malls(
  p_lat double precision default null,
  p_lng double precision default null
)
returns table (
  mall_id bigint,
  name text,
  slug text,
  description text,
  address text,
  cover_key text,
  lat double precision,
  lng double precision,
  distance_km double precision,
  shop_count int,
  offer_count int
)
language sql
stable
set search_path = ''
as $$
  with here as (
    select case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end as g
  )
  select m.id, m.name, m.slug, m.description, m.address, m.cover_key, m.lat, m.lng,
         extensions.st_distance(m.geo, here.g) / 1000,
         (select count(distinct b.shop_id)::int from public.mall_shops ms
            join public.branches b on b.id = ms.branch_id
          where ms.mall_id = m.id and private.shop_is_live(b.shop_id)),
         (select count(*)::int from public.live_offers lo
          where lo.shop_id in (select b.shop_id from public.mall_shops ms
                                 join public.branches b on b.id = ms.branch_id where ms.mall_id = m.id))
  from public.malls m
  cross join here
  where m.is_active
  order by extensions.st_distance(m.geo, here.g) nulls last, m.sort_order, m.name;
$$;

-- Admin dashboard counts. Runs with the caller's rights, so non-admins only get their own slice.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'vendors', (select count(*) from public.vendors),
    'vendors_pending', (select count(*) from public.vendors where status = 'pending'),
    'customers', (select count(*) from public.user_roles where role = 'customer'),
    'shops', (select count(*) from public.shops),
    'malls', (select count(*) from public.malls),
    'offers_live', (select count(*) from public.live_offers),
    'offers_pending', (select count(*) from public.offers where status = 'pending')
  );
$$;

revoke execute on function public.search_shops(double precision, double precision, text, text, bigint, int, int),
  public.search_offers(double precision, double precision, text, boolean, int, int),
  public.list_malls(double precision, double precision), public.admin_stats() from public;
grant execute on function public.search_shops(double precision, double precision, text, text, bigint, int, int),
  public.search_offers(double precision, double precision, text, boolean, int, int),
  public.list_malls(double precision, double precision) to anon, authenticated;
grant execute on function public.admin_stats() to authenticated;
