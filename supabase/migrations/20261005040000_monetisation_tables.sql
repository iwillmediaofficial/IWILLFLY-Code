-- IWILLFLY Phase 4: vendor plans and add-ons, invoices paid by UPI (recorded by an admin), vendor staff,
-- support tickets and the admin audit log.
--
-- Money is in rupees (numeric(10,2)). Nothing is charged automatically: a vendor (or an admin for them)
-- creates an invoice, pays IWILLFLY's UPI ID, and an admin marks the invoice paid, which switches on what
-- was bought. Razorpay can later call the same "mark paid" step.

-- Billing settings (one row) ----------------------------------------------------------------------

create table public.billing_settings (
  id int primary key default 1 check (id = 1),
  upi_id text check (upi_id ~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z]{2,64}$'),  -- where vendors pay
  payee_name text check (char_length(payee_name) <= 100),
  business_name text check (char_length(business_name) <= 120),       -- printed on invoices
  business_address text check (char_length(business_address) <= 400),
  gstin text check (gstin ~ '^[0-9A-Z]{15}$'),
  gst_percent numeric(5,2) not null default 0 check (gst_percent between 0 and 28),
  invoice_prefix text not null default 'IWF' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  payment_note text check (char_length(payment_note) <= 400),          -- shown on every invoice
  updated_at timestamptz not null default now()
);
insert into public.billing_settings (id) values (1);

-- Catalogue ---------------------------------------------------------------------------------------

create table public.plans (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 60),
  description text check (char_length(description) <= 500),
  features text[] not null default '{}',                               -- bullet points shown to vendors
  price numeric(10,2) not null default 0 check (price >= 0),
  period_days int not null default 30 check (period_days between 1 and 1100),
  max_shops int check (max_shops >= 0),                                -- null = no limit
  max_live_offers int check (max_live_offers >= 0),                    -- null = no limit
  is_default boolean not null default false,                           -- what vendors without a plan get
  is_active boolean not null default true,                             -- can be bought
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plans_one_default_idx on public.plans (is_default) where is_default;

create type public.addon_kind as enum ('featured_shop', 'promoted_offer', 'banner_ad');

create table public.addons (
  id bigint generated always as identity primary key,
  kind public.addon_kind not null,
  name text not null check (char_length(name) between 2 and 60),
  description text check (char_length(description) <= 500),
  price numeric(10,2) not null check (price >= 0),
  duration_days int not null default 7 check (duration_days between 1 and 366),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Invoices ----------------------------------------------------------------------------------------

create type public.invoice_status as enum ('unpaid', 'submitted', 'paid', 'void');

create sequence public.invoice_number_seq;

create table public.invoices (
  id bigint generated always as identity primary key,
  number text not null unique,                                         -- IWF-2026-00001
  vendor_id bigint not null references public.vendors (id) on delete restrict,
  status public.invoice_status not null default 'unpaid',
  subtotal numeric(10,2) not null default 0,
  gst_percent numeric(5,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  issued_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_on date not null default (now() at time zone 'Asia/Kolkata')::date + 7,
  -- snapshot of who the invoice is for and from, so later edits don't change old invoices
  bill_to jsonb not null default '{}',
  bill_from jsonb not null default '{}',
  payer_ref text check (char_length(payer_ref) <= 60),                 -- UPI transaction id the vendor typed
  payer_note text check (char_length(payer_note) <= 300),
  submitted_at timestamptz,
  payment_method text check (payment_method in ('upi', 'cash', 'bank', 'razorpay', 'free')),
  payment_ref text check (char_length(payment_ref) <= 60),             -- what the admin confirmed
  paid_on date,
  recorded_by uuid references auth.users (id) on delete set null,
  void_reason text check (char_length(void_reason) <= 300),
  admin_note text check (char_length(admin_note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_vendor_idx on public.invoices (vendor_id, created_at desc);
create index invoices_open_idx on public.invoices (status) where status in ('unpaid', 'submitted');
create index invoices_recorded_by_idx on public.invoices (recorded_by);
create index invoices_created_by_idx on public.invoices (created_by);

create table public.invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices (id) on delete cascade,
  plan_id bigint references public.plans (id) on delete restrict,
  addon_id bigint references public.addons (id) on delete restrict,
  shop_id bigint references public.shops (id) on delete set null,      -- featured shop / banner target
  offer_id bigint references public.offers (id) on delete set null,    -- promoted offer target
  description text not null check (char_length(description) <= 200),
  days int not null check (days between 1 and 1100),
  amount numeric(10,2) not null check (amount >= 0),
  check ((plan_id is null) <> (addon_id is null))
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_plan_idx on public.invoice_items (plan_id);
create index invoice_items_addon_idx on public.invoice_items (addon_id);
create index invoice_items_shop_idx on public.invoice_items (shop_id);
create index invoice_items_offer_idx on public.invoice_items (offer_id);

-- What a paid invoice switched on -----------------------------------------------------------------

create table public.subscriptions (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  plan_id bigint not null references public.plans (id) on delete restrict,
  invoice_item_id bigint unique references public.invoice_items (id) on delete set null,
  starts_on date not null,
  ends_on date not null,
  cancelled_at timestamptz,
  reminded_7 boolean not null default false,
  reminded_1 boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index subscriptions_vendor_idx on public.subscriptions (vendor_id, ends_on desc);
create index subscriptions_plan_idx on public.subscriptions (plan_id);

create table public.addon_purchases (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  addon_id bigint not null references public.addons (id) on delete restrict,
  kind public.addon_kind not null,
  shop_id bigint references public.shops (id) on delete cascade,
  offer_id bigint references public.offers (id) on delete cascade,
  invoice_item_id bigint unique references public.invoice_items (id) on delete set null,
  starts_on date not null,
  ends_on date not null,
  cancelled_at timestamptz,
  reminded_7 boolean not null default false,
  reminded_1 boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index addon_purchases_vendor_idx on public.addon_purchases (vendor_id, ends_on desc);
create index addon_purchases_addon_idx on public.addon_purchases (addon_id);
create index addon_purchases_shop_idx on public.addon_purchases (shop_id);
create index addon_purchases_offer_idx on public.addon_purchases (offer_id);

-- A paid "featured shop" add-on lights this up; only admins and the billing job change it.
alter table public.shops add column is_featured boolean not null default false;

-- Vendor staff ------------------------------------------------------------------------------------

-- The owner is vendors.owner_id. Managers can do everything except billing and staff; staff can check
-- prize claim codes and see the dashboard. Removed members keep their row (removed_at) for the record.
create type public.staff_role as enum ('manager', 'staff');

create table public.vendor_staff (
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.staff_role not null default 'staff',
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (vendor_id, user_id)
);
-- one business per person at a time
create unique index vendor_staff_one_vendor_idx on public.vendor_staff (user_id) where removed_at is null;
create index vendor_staff_added_by_idx on public.vendor_staff (added_by);

-- Support -----------------------------------------------------------------------------------------

create type public.ticket_status as enum ('open', 'waiting', 'resolved', 'closed');

create table public.support_tickets (
  id bigint generated always as identity primary key,
  opened_by uuid not null references auth.users (id) on delete cascade,
  vendor_id bigint references public.vendors (id) on delete set null,  -- set when opened from the vendor app
  subject text not null check (char_length(subject) between 3 and 120),
  category text not null default 'other'
    check (category in ('billing', 'account', 'offers', 'scratch', 'technical', 'other')),
  status public.ticket_status not null default 'open',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assigned_to uuid references auth.users (id) on delete set null,
  last_message_at timestamptz not null default now(),
  last_from_staff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_opened_by_idx on public.support_tickets (opened_by, last_message_at desc);
create index support_tickets_vendor_idx on public.support_tickets (vendor_id);
create index support_tickets_queue_idx on public.support_tickets (status, last_message_at desc);
create index support_tickets_assigned_idx on public.support_tickets (assigned_to);

create table public.ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  is_staff boolean not null default false,
  body text not null check (char_length(body) between 1 and 4000),
  image_key text,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, id);
create index ticket_messages_author_idx on public.ticket_messages (author_id);

-- Admin audit log ---------------------------------------------------------------------------------

-- One row per change an admin, support agent or campaign manager makes in the app. Only the fields
-- that changed are kept, so the log stays small.
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  row_id text,
  changes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_log_row_idx on public.admin_audit_log (table_name, row_id);

create trigger billing_settings_updated_at before update on public.billing_settings
  for each row execute function public.set_updated_at();
create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();
create trigger addons_updated_at before update on public.addons
  for each row execute function public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger support_tickets_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.billing_settings enable row level security;
alter table public.plans enable row level security;
alter table public.addons enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.subscriptions enable row level security;
alter table public.addon_purchases enable row level security;
alter table public.vendor_staff enable row level security;
alter table public.support_tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.admin_audit_log enable row level security;
