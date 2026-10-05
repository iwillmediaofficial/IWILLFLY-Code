-- Admin vendor management: owner details for admins, create a vendor from an existing account,
-- edit the owner's profile, and a safe delete. Create and delete are for super admins only.

-- Read: every vendor with its owner's contact details and counts (admins only).
-- auth.users is not readable through the API, so owner emails come from here.
create or replace function public.admin_vendor_directory()
returns table (
  vendor_id bigint,
  owner_id uuid,
  owner_email text,
  owner_name text,
  owner_phone text,
  owner_since timestamptz,
  shop_count int,
  offer_count int,
  staff_count int,
  invoice_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select v.id, v.owner_id, u.email::text, p.full_name, p.phone, u.created_at,
    (select count(*)::int from public.shops s where s.vendor_id = v.id),
    (select count(*)::int from public.offers o join public.shops s on s.id = o.shop_id where s.vendor_id = v.id),
    (select count(*)::int from public.vendor_staff st where st.vendor_id = v.id and st.removed_at is null),
    (select count(*)::int from public.invoices i where i.vendor_id = v.id)
  from public.vendors v
  join auth.users u on u.id = v.owner_id
  left join public.profiles p on p.id = v.owner_id;
end;
$$;

-- Read: a vendor's managers and staff with their emails (admins only).
create or replace function public.admin_vendor_team(p_vendor_id bigint)
returns table (user_id uuid, email text, full_name text, role text, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.user_id, u.email::text, p.full_name, s.role::text, s.added_at
  from public.vendor_staff s
  join auth.users u on u.id = s.user_id
  left join public.profiles p on p.id = s.user_id
  where s.vendor_id = p_vendor_id and s.removed_at is null
  order by s.added_at;
end;
$$;

-- Update: the owner's name and mobile. Profiles are otherwise editable only by their owner.
create or replace function public.admin_update_vendor_owner(p_vendor_id bigint, p_full_name text, p_phone text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  select owner_id into v_owner from public.vendors where id = p_vendor_id;
  if v_owner is null then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) > 120 or char_length(trim(coalesce(p_phone, ''))) > 20 then
    raise exception 'Name or phone is too long' using errcode = '22023';
  end if;
  update public.profiles
    set full_name = nullif(trim(p_full_name), ''), phone = nullif(trim(p_phone), '')
    where id = v_owner;
end;
$$;

-- Create: make an existing account (found by email) the owner of a new, approved vendor. Super admins only.
create or replace function public.admin_create_vendor(
  p_email text,
  p_business_name text,
  p_phone text,
  p_whatsapp text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target uuid;
  existing text;
  vid bigint;
begin
  if not private.has_role('super_admin') then
    raise exception 'Only a super admin can create vendors' using errcode = 'insufficient_privilege';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'No IWILLFLY account uses that email. Ask them to sign up first, then try again.'
      using errcode = 'P0002';
  end if;
  select business_name into existing from public.vendors where owner_id = target;
  if existing is not null then
    raise exception 'That account already owns "%"', existing using errcode = '22023';
  end if;
  if exists (select 1 from public.vendor_staff where user_id = target and removed_at is null) then
    raise exception 'That account works for another business. Remove them from that team first.'
      using errcode = '22023';
  end if;
  insert into public.vendors (owner_id, business_name, contact_phone, whatsapp, status, reviewed_by, reviewed_at)
  values (target, trim(p_business_name), nullif(trim(p_phone), ''), nullif(trim(p_whatsapp), ''),
          'approved', (select auth.uid()), now())
  returning id into vid;
  insert into public.user_roles (user_id, role, granted_by)
  values (target, 'vendor', (select auth.uid()))
  on conflict do nothing;
  perform private.notify(target, 'vendor_review', 'Your business is ready on IWILLFLY',
    trim(p_business_name) || ' was set up for you. Open the vendor area to add your shops and offers.', '/vendor');
  return vid;
end;
$$;

-- Delete: removes the vendor with its shops, offers, campaigns and team, and takes away the vendor role
-- from people who no longer belong to any business. Their customer accounts stay. Super admins only.
-- Vendors with invoices cannot be deleted, so billing records are kept; block them instead.
create or replace function public.admin_delete_vendor(p_vendor_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  members uuid[];
begin
  if not private.has_role('super_admin') then
    raise exception 'Only a super admin can delete vendors' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.invoices where vendor_id = p_vendor_id) then
    raise exception 'This vendor has invoices, which must be kept. Block the vendor instead.'
      using errcode = '23503';
  end if;
  select array_agg(distinct m) into members from (
    select owner_id as m from public.vendors where id = p_vendor_id
    union all
    select user_id from public.vendor_staff where vendor_id = p_vendor_id and removed_at is null
  ) x;
  delete from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  delete from public.user_roles r
  where r.role = 'vendor' and r.user_id = any (members)
    and not exists (select 1 from public.vendors v where v.owner_id = r.user_id)
    and not exists (select 1 from public.vendor_staff s where s.user_id = r.user_id and s.removed_at is null);
end;
$$;

revoke execute on function
  public.admin_vendor_directory(),
  public.admin_vendor_team(bigint),
  public.admin_update_vendor_owner(bigint, text, text),
  public.admin_create_vendor(text, text, text, text),
  public.admin_delete_vendor(bigint)
from public, anon;
grant execute on function
  public.admin_vendor_directory(),
  public.admin_vendor_team(bigint),
  public.admin_update_vendor_owner(bigint, text, text),
  public.admin_create_vendor(text, text, text, text),
  public.admin_delete_vendor(bigint)
to authenticated;

-- Deleting vendors is now super admin only, also through the table API.
drop policy "vendors: admin delete" on public.vendors;
create policy "vendors: super admin delete" on public.vendors
  for delete to authenticated using ((select private.has_role('super_admin')));
