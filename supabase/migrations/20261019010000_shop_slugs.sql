-- Shop links use the shop's name: /shop/nikhil-furniture-works instead of /shop/2.
-- Each shop gets a slug when it is created. It stays the same if the shop is renamed later; only an
-- admin can change it (Admin > Vendors > shop > Edit). Old number links and old slugs still work:
-- the app and the Worker redirect them to the current link.

-- Lowercase letters, digits and hyphens. Never only digits (those are shop ids) and never empty.
create or replace function private.shop_slug_base(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when b = '' then 'shop'
    when b ~ '^[0-9]+$' then 'shop-' || b
    else b
  end
  from (
    select trim(both '-' from left(
      trim(both '-' from regexp_replace(translate(replace(lower(coalesce(name, '')), '&', ' and '), '''’', ''), '[^a-z0-9]+', '-', 'g')),
      70)) as b
  ) x;
$$;

alter table public.shops add column slug text;

-- Links a shop had before an admin changed it, so shared links still lead to the shop.
create table public.shop_old_slugs (
  slug text primary key,
  shop_id bigint not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index shop_old_slugs_shop_idx on public.shop_old_slugs (shop_id);
alter table public.shop_old_slugs enable row level security;
-- Read only, to follow old links. Written only by the shops_slug trigger.
create policy "shop_old_slugs: signed-in read" on public.shop_old_slugs
  for select to authenticated using (true);
grant select on public.shop_old_slugs to authenticated;

-- In use by another shop, now or as one of its old links.
create or replace function private.shop_slug_taken(candidate text, self bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.shops s where s.slug = candidate and s.id is distinct from self)
      or exists (select 1 from public.shop_old_slugs o where o.slug = candidate and o.shop_id is distinct from self);
$$;

-- The base slug, or base-2, base-3, ... when another shop already has it.
create or replace function private.unique_shop_slug(name text, self bigint)
returns text
language plpgsql
set search_path = ''
as $$
declare
  base text := private.shop_slug_base(name);
  candidate text := base;
  n int := 1;
begin
  while private.shop_slug_taken(candidate, self) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

-- Existing shops, oldest first, so the first shop with a name keeps the plain link.
do $$
declare
  r record;
begin
  for r in select id, name from public.shops order by id loop
    update public.shops set slug = private.unique_shop_slug(r.name, r.id) where id = r.id;
  end loop;
end;
$$;

alter table public.shops
  alter column slug set not null,
  add constraint shops_slug_key unique (slug),
  add constraint shops_slug_format check (
    char_length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug !~ '^[0-9]+$');

-- Null when the link is well formed, else what is wrong with it.
create or replace function private.shop_link_problem(slug text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(slug, '') = '' then 'enter a link.'
    when char_length(slug) > 80 then 'use 80 characters or fewer.'
    when slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then 'use only small letters, numbers and single hyphens (no spaces).'
    when slug ~ '^[0-9]+$' then 'add at least one letter (numbers alone are kept for old links).'
  end;
$$;

-- Keeps the old link for redirects. A shop may go back to one of its own old links; the current link
-- is always looked up first, so the leftover old-link row does no harm.
create or replace function private.remember_old_shop_slug(shop bigint, old_slug text, new_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- App users reach this only through the shops_slug trigger, which already checked for an admin.
  if auth.uid() is not null and not (select private.is_admin()) then
    raise exception 'Only admins can change shop links' using errcode = '42501';
  end if;
  insert into public.shop_old_slugs (slug, shop_id) values (old_slug, shop) on conflict (slug) do nothing;
end;
$$;
revoke execute on function private.remember_old_shop_slug(bigint, text, text) from public, anon;
grant execute on function private.remember_old_shop_slug(bigint, text, text) to authenticated;

-- Set on insert (whatever the client sent). Afterwards only an admin can change it, to a link that is
-- well formed and not used by any other shop (now or before); the old link keeps redirecting.
-- Runs as the caller (like guard_shop), so is_app_admin_or_service() sees who is saving.
create or replace function public.set_shop_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.slug := private.unique_shop_slug(new.name, null);
    return new;
  end if;
  if new.slug is not distinct from old.slug then
    return new;
  end if;
  if not private.is_app_admin_or_service() then
    new.slug := old.slug;
    return new;
  end if;
  new.slug := lower(btrim(new.slug));
  if private.shop_link_problem(new.slug) is not null then
    raise exception 'Shop link: %', private.shop_link_problem(new.slug) using errcode = '22023';
  end if;
  if private.shop_slug_taken(new.slug, new.id) then
    raise exception 'Shop link "%" is already used by another shop. Pick another.', new.slug
      using errcode = '23505';
  end if;
  if new.slug = old.slug then
    return new;
  end if;
  perform private.remember_old_shop_slug(new.id, old.slug, new.slug);
  return new;
end;
$$;

create trigger shops_slug before insert or update of slug on public.shops
  for each row execute function public.set_shop_slug();

-- For the admin form: checks a link while it is typed, before saving.
-- 'available', 'invalid: <reason>', or 'taken: <shop name>' (now or as an old link of that shop).
create or replace function public.shop_link_status(p_slug text, p_shop_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s text := lower(btrim(coalesce(p_slug, '')));
  problem text := private.shop_link_problem(s);
  other text;
begin
  if not (select private.is_admin()) then
    raise exception 'Only admins can change shop links' using errcode = '42501';
  end if;
  if problem is not null then
    return 'invalid: ' || problem;
  end if;
  select sh.name into other from public.shops sh
  where sh.id is distinct from p_shop_id
    and (sh.slug = s or exists (select 1 from public.shop_old_slugs o where o.slug = s and o.shop_id = sh.id))
  limit 1;
  if other is not null then
    return 'taken: ' || other;
  end if;
  return 'available';
end;
$$;
revoke execute on function public.shop_link_status(text, bigint) from public, anon;
grant execute on function public.shop_link_status(text, bigint) to authenticated;
