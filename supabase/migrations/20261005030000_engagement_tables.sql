-- IWILLFLY Phase 3: festivals, home ads, featured-placement requests, notifications, web push and
-- analytics counters.
--
-- Analytics are daily counters (one row per shop/offer per day), never one row per view, so the free
-- 500 MB database lasts. Notifications are one row per recipient; old ones are cleaned up by pg_cron.

-- Festivals ---------------------------------------------------------------------------------------

create type public.review_status as enum ('pending', 'approved', 'rejected');

create table public.festivals (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 80),          -- "Onam 2026"
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (char_length(description) <= 1000),
  banner_key text,
  theme_color text check (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  starts_on date not null,
  ends_on date not null,
  -- vendors can submit offers until this date (defaults to the festival's last day)
  submissions_close_on date,
  is_active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- A vendor's offer submitted to a festival; shown on the festival page once approved.
create table public.festival_offers (
  festival_id bigint not null references public.festivals (id) on delete cascade,
  offer_id bigint not null references public.offers (id) on delete cascade,
  status public.review_status not null default 'pending',
  note text check (char_length(note) <= 300),                              -- admin's reason
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  primary key (festival_id, offer_id)
);
create index festival_offers_offer_idx on public.festival_offers (offer_id);
create index festival_offers_reviewed_by_idx on public.festival_offers (reviewed_by);

-- Home ad slider ----------------------------------------------------------------------------------

create table public.ads (
  id bigint generated always as identity primary key,
  pill text check (char_length(pill) <= 40),                               -- "MAIN FESTIVAL OFFER"
  title text not null check (char_length(title) between 2 and 80),
  subtitle text check (char_length(subtitle) <= 160),
  image_key text,                                                          -- optional photo background
  style text not null default 'ad1' check (style in ('ad1', 'ad2', 'ad3')), -- prototype colour themes
  -- where a tap goes
  link_kind text not null default 'none' check (link_kind in ('none', 'url', 'shop', 'offer', 'festival', 'mall')),
  link_target text check (char_length(link_target) <= 300),
  vendor_id bigint references public.vendors (id) on delete set null,       -- advertiser, if a vendor
  starts_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on date,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (link_kind = 'none' or link_target is not null)
);
create index ads_vendor_idx on public.ads (vendor_id);

-- Vendor requests for featured placement --------------------------------------------------------

create type public.placement_kind as enum ('featured_offer', 'home_banner', 'festival_spotlight');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.placement_requests (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  kind public.placement_kind not null,
  offer_id bigint references public.offers (id) on delete cascade,
  shop_id bigint references public.shops (id) on delete cascade,
  festival_id bigint references public.festivals (id) on delete cascade,
  message text check (char_length(message) <= 500),
  wanted_from date,
  wanted_to date,
  status public.request_status not null default 'pending',
  admin_note text check (char_length(admin_note) <= 500),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'featured_offer' or offer_id is not null),
  check (wanted_to is null or wanted_from is null or wanted_to >= wanted_from)
);
create index placement_requests_vendor_idx on public.placement_requests (vendor_id, created_at desc);
create index placement_requests_status_idx on public.placement_requests (status) where status = 'pending';
create index placement_requests_offer_idx on public.placement_requests (offer_id);
create index placement_requests_shop_idx on public.placement_requests (shop_id);
create index placement_requests_festival_idx on public.placement_requests (festival_id);
create index placement_requests_decided_by_idx on public.placement_requests (decided_by);

-- Notifications and web push --------------------------------------------------------------------

create type public.push_status as enum ('pending', 'sent', 'skipped');

-- One message sent by an admin to a targeted group.
create table public.broadcasts (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 2 and 80),
  body text check (char_length(body) <= 300),
  link text check (char_length(link) <= 300),                              -- in-app path like /festival/onam-2026
  audience text not null check (audience in ('everyone', 'customers', 'vendors')),
  location_id bigint references public.locations (id) on delete set null,  -- only people in this area
  category_id bigint references public.categories (id) on delete set null, -- only people who saved this category
  with_push boolean not null default true,
  recipients int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index broadcasts_location_idx on public.broadcasts (location_id);
create index broadcasts_category_idx on public.broadcasts (category_id);
create index broadcasts_created_by_idx on public.broadcasts (created_by);

-- Each user's inbox.
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('broadcast', 'offer_review', 'vendor_review', 'new_winner',
                                     'festival_review', 'placement_review')),
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 300),
  link text check (char_length(link) <= 300),
  broadcast_id bigint references public.broadcasts (id) on delete cascade,
  push_status public.push_status not null default 'pending',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_push_idx on public.notifications (id) where push_status = 'pending';
create index notifications_broadcast_idx on public.notifications (broadcast_id);
create index notifications_created_idx on public.notifications (created_at);

-- A browser that agreed to receive push notifications.
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Analytics -------------------------------------------------------------------------------------

-- Daily counters per shop, and per offer within the shop (offer_id null = the shop itself).
create table public.offer_stats_daily (
  day date not null,
  shop_id bigint not null references public.shops (id) on delete cascade,
  offer_id bigint references public.offers (id) on delete cascade,
  views int not null default 0,        -- shop page or offer opened
  clicks int not null default 0,       -- offer tapped in a list
  saves int not null default 0,        -- saved by a customer
  whatsapp int not null default 0,     -- WhatsApp button (a lead)
  calls int not null default 0,        -- call button
  directions int not null default 0,   -- directions / map button
  unique nulls not distinct (day, shop_id, offer_id)
);
create index offer_stats_daily_shop_idx on public.offer_stats_daily (shop_id, day);
create index offer_stats_daily_offer_idx on public.offer_stats_daily (offer_id, day);
create index offer_stats_daily_day_idx on public.offer_stats_daily (day);

-- Offers a signed-in customer opened recently ("Recently viewed").
create table public.offer_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  offer_id bigint not null references public.offers (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, offer_id)
);
create index offer_history_offer_idx on public.offer_history (offer_id);
create index offer_history_recent_idx on public.offer_history (user_id, viewed_at desc);

create trigger festivals_updated_at before update on public.festivals
  for each row execute function public.set_updated_at();
create trigger ads_updated_at before update on public.ads
  for each row execute function public.set_updated_at();

alter table public.festivals enable row level security;
alter table public.festival_offers enable row level security;
alter table public.ads enable row level security;
alter table public.placement_requests enable row level security;
alter table public.broadcasts enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.offer_stats_daily enable row level security;
alter table public.offer_history enable row level security;
