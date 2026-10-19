-- Shop links use the shop's name: /shop/nikhil-furniture-works instead of /shop/2.
-- Each shop gets a slug when it is created. It stays the same if the shop is renamed later, so links
-- people have shared keep working. Old number links still work; the app and the Worker redirect them.

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
  while exists (select 1 from public.shops s where s.slug = candidate and s.id is distinct from self) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

alter table public.shops add column slug text;

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
  add constraint shops_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug !~ '^[0-9]+$');

-- Set on insert (whatever the client sent), fixed afterwards.
create or replace function public.set_shop_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.slug := private.unique_shop_slug(new.name, null);
  else
    new.slug := old.slug;
  end if;
  return new;
end;
$$;
revoke execute on function public.set_shop_slug() from public, anon, authenticated;

create trigger shops_slug before insert or update of slug on public.shops
  for each row execute function public.set_shop_slug();
