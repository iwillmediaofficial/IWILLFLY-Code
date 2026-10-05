-- IWILLFLY Phase 2: Scratch & Win tables.
--
-- A campaign has prizes (each with stock and a win probability, optionally sponsored by a vendor whose
-- shops hand it out). Customers play through play_scratch() only, at most once per campaign per India day.
-- Each play is one row in scratch_plays and carries its own claim code and claim status, following the
-- transaction structure in the feature spec: customer -> campaign -> vendor -> played_at -> result ->
-- prize -> claim_code -> claim_status -> claimed_at.

create type public.claim_status as enum ('unclaimed', 'claimed', 'expired');

create table public.scratch_campaigns (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 1000),
  banner_key text,
  starts_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on date,
  -- daily window in India time
  active_from time not null default '09:00',
  active_to time not null default '22:00',
  -- eligibility: only customers whose chosen area is inside this location (null = everyone)
  location_id bigint references public.locations (id) on delete set null,
  -- fraud control: most prizes one customer can win in this campaign (null = no limit)
  max_wins_per_customer int check (max_wins_per_customer > 0),
  claim_valid_days int not null default 7 check (claim_valid_days between 1 and 90),
  is_active boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (active_to > active_from)
);
create index scratch_campaigns_location_idx on public.scratch_campaigns (location_id);
create index scratch_campaigns_created_by_idx on public.scratch_campaigns (created_by);

-- Vendors taking part in a campaign (they can then sponsor prizes and see their winners).
create table public.campaign_vendors (
  campaign_id bigint not null references public.scratch_campaigns (id) on delete cascade,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (campaign_id, vendor_id)
);
create index campaign_vendors_vendor_idx on public.campaign_vendors (vendor_id);

create table public.scratch_prizes (
  id bigint generated always as identity primary key,
  campaign_id bigint not null references public.scratch_campaigns (id) on delete cascade,
  -- the shop owner that hands the prize over and verifies the claim (null = IWILLFLY itself)
  sponsor_vendor_id bigint references public.vendors (id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 500),
  image_key text,
  quantity int not null check (quantity between 0 and 100000),
  remaining int not null default 0 check (remaining >= 0),   -- set from quantity by a trigger
  -- chance of winning this prize on one play, 0 to 1; the chances of a campaign's prizes add up to at most 1
  probability numeric(6, 5) not null default 0 check (probability between 0 and 1),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining <= quantity)
);
create index scratch_prizes_campaign_idx on public.scratch_prizes (campaign_id);
create index scratch_prizes_sponsor_idx on public.scratch_prizes (sponsor_vendor_id);

create table public.scratch_plays (
  id bigint generated always as identity primary key,
  -- winner history is kept: a campaign or prize with plays cannot be deleted, only switched off
  campaign_id bigint not null references public.scratch_campaigns (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete cascade,
  play_date date not null,                          -- India date; one play per campaign per day
  played_at timestamptz not null default now(),
  prize_id bigint references public.scratch_prizes (id) on delete restrict,
  vendor_id bigint references public.vendors (id) on delete set null,   -- prize sponsor at play time
  won boolean not null,
  claim_code text unique check (claim_code ~ '^[A-Z2-9]{8}$'),
  claim_status public.claim_status,
  expires_at timestamptz,
  claimed_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null,
  fraud_flag boolean not null default false,
  fraud_note text check (char_length(fraud_note) <= 500),
  unique (customer_id, campaign_id, play_date),
  check ((won and prize_id is not null and claim_code is not null and claim_status is not null)
         or (not won and claim_code is null and claim_status is null))
);
create index scratch_plays_campaign_idx on public.scratch_plays (campaign_id, played_at desc);
create index scratch_plays_prize_idx on public.scratch_plays (prize_id);
create index scratch_plays_vendor_idx on public.scratch_plays (vendor_id) where won;
create index scratch_plays_claimed_by_idx on public.scratch_plays (claimed_by);
create index scratch_plays_unclaimed_idx on public.scratch_plays (expires_at) where claim_status = 'unclaimed';

create trigger scratch_campaigns_updated_at before update on public.scratch_campaigns
  for each row execute function public.set_updated_at();
create trigger scratch_prizes_updated_at before update on public.scratch_prizes
  for each row execute function public.set_updated_at();

-- Policies come in the next migration; until then API roles see nothing.
alter table public.scratch_campaigns enable row level security;
alter table public.campaign_vendors enable row level security;
alter table public.scratch_prizes enable row level security;
alter table public.scratch_plays enable row level security;
