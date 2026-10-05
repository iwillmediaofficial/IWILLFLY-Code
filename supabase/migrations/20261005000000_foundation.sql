-- IWILLFLY Phase 0: extensions, identity, roles, locations and categories, all with RLS.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron;

-- Roles ----------------------------------------------------------------------

create type public.app_role as enum ('customer', 'vendor', 'admin', 'super_admin', 'support', 'campaign_manager');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  avatar_key text,                      -- R2 object key, not a URL
  location_id bigint,                   -- preferred area, FK added below
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- security definer so policies can call these without recursing into user_roles RLS
create or replace function public.has_role(r public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role = r);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'super_admin')
  );
$$;

revoke execute on function public.has_role(public.app_role), public.is_admin() from public;
-- anon needs these too: public-read policies call is_admin(), which is simply false without a login
grant execute on function public.has_role(public.app_role), public.is_admin() to anon, authenticated;

-- Locations and categories -------------------------------------------------------

create type public.location_kind as enum ('state', 'district', 'city', 'area');

create table public.locations (
  id bigint generated always as identity primary key,
  parent_id bigint references public.locations (id) on delete restrict,
  kind public.location_kind not null,
  name text not null,
  slug text not null,
  center extensions.geography(point, 4326),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (parent_id, slug)
);
create index locations_parent_idx on public.locations (parent_id);

alter table public.profiles
  add constraint profiles_location_fk foreign key (location_id) references public.locations (id) on delete set null;
create index profiles_location_idx on public.profiles (location_id);

create table public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  slug text not null unique,
  icon text,                            -- emoji, or R2 key for a custom icon
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index user_roles_granted_by_idx on public.user_roles (granted_by);

-- Housekeeping triggers ----------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new sign-up gets a profile and the customer role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'));
  insert into public.user_roles (user_id, role) values (new.id, 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security -------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.locations enable row level security;
alter table public.categories enable row level security;

-- profiles: you see and edit your own; admins see all
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- user_roles: you see your own; admins see all.
-- Admins grant operational roles; only super_admin grants admin or super_admin.
create policy "user_roles: read own or admin" on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "user_roles: admin grants" on public.user_roles
  for insert to authenticated
  with check (
    (select public.has_role('super_admin'))
    or ((select public.is_admin()) and role not in ('admin', 'super_admin'))
  );
create policy "user_roles: admin revokes" on public.user_roles
  for delete to authenticated
  using (
    (select public.has_role('super_admin'))
    or ((select public.is_admin()) and role not in ('admin', 'super_admin'))
  );

-- locations / categories: everyone reads active rows; admins manage
create policy "locations: public read" on public.locations
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "locations: admin insert" on public.locations
  for insert to authenticated with check ((select public.is_admin()));
create policy "locations: admin update" on public.locations
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "locations: admin delete" on public.locations
  for delete to authenticated using ((select public.is_admin()));

create policy "categories: public read" on public.categories
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "categories: admin insert" on public.categories
  for insert to authenticated with check ((select public.is_admin()));
create policy "categories: admin update" on public.categories
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "categories: admin delete" on public.categories
  for delete to authenticated using ((select public.is_admin()));

-- Seed data (from the UI prototype) ------------------------------------------------

insert into public.categories (name, slug, icon, sort_order) values
  ('Fashion & Textiles', 'textile', '👗', 1),
  ('Home Appliances', 'appliance', '🛋️', 2),
  ('Electronics', 'electronics', '🎧', 3),
  ('Supermarket & Grocery', 'supermarket', '🛒', 4),
  ('Beauty', 'beauty', '💄', 5),
  ('Food & Restaurants', 'food', '🍽️', 6);

with s as (
  insert into public.locations (kind, name, slug) values ('state', 'Kerala', 'kerala') returning id
), d as (
  insert into public.locations (parent_id, kind, name, slug)
  select id, 'district', 'Ernakulam', 'ernakulam' from s returning id
), c as (
  insert into public.locations (parent_id, kind, name, slug)
  select id, 'city', 'Kochi', 'kochi' from d returning id
)
insert into public.locations (parent_id, kind, name, slug)
select c.id, 'area', v.name, v.slug
from c, (values ('Aluva', 'aluva'), ('Edappally', 'edappally'), ('Kakkanad', 'kakkanad'), ('Vyttila', 'vyttila')) as v(name, slug);
