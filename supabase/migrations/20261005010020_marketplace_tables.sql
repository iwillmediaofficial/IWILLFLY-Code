-- IWILLFLY Phase 1: marketplace. Vendors, shops, branches, malls, offers and saves, all with RLS.
--
-- Visibility rules
--   * A vendor applies (apply_as_vendor) and gets the vendor role at once, so they can set up shops
--     while an admin reviews them. Nothing they create is public until the vendor is approved.
--   * Customers see a shop only when it is active and its vendor is approved, and an offer only when
--     it is also approved, not paused and inside its dates (India time).
--   * Vendors never set status, featured or verified themselves; triggers keep those columns admin-only,
--     and editing an offer's content sends it back for review.

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

-- Policies come in the next migration; until then API roles see nothing.
alter table public.vendors enable row level security;
alter table public.shops enable row level security;
alter table public.branches enable row level security;
alter table public.malls enable row level security;
alter table public.mall_shops enable row level security;
alter table public.offers enable row level security;
alter table public.saved_offers enable row level security;
alter table public.saved_shops enable row level security;
