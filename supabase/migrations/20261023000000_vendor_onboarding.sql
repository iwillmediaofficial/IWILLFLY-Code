-- Vendor onboarding: an applicant picks a plan, then sends their shop and its branches in one go.
--   * vendors.plan_id is the plan picked when applying. Its limits apply until a paid plan is running.
--   * plans.max_branches limits branches across all of a vendor's shops (null = no limit).
--   * Paid plan first: an admin can approve an applicant on a paid plan only once its invoice is paid.
--   * submit_vendor_application() saves business, shop, branches and the plan invoice together, or nothing.

alter table public.vendors
  add column if not exists plan_id bigint references public.plans (id) on delete set null;
create index if not exists vendors_plan_idx on public.vendors (plan_id);

alter table public.plans
  add column if not exists max_branches int constraint plans_max_branches_check check (max_branches >= 0);

-- Vendors never change their own plan_id; it is set by submit_vendor_application() or an admin.
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
  new.plan_id := old.plan_id;
  return new;
end;
$$;

-- The plan a vendor is on today: the newest running subscription, else the plan picked when applying,
-- else the default plan (may be none).
create or replace function private.vendor_plan(v bigint)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.plans p
  where p.id = coalesce(
    (select s.plan_id from public.subscriptions s
     where s.vendor_id = v and s.cancelled_at is null
       and private.today_ist() between s.starts_on and s.ends_on
     order by s.created_at desc limit 1),
    (select plan_id from public.vendors where id = v),
    (select id from public.plans where is_default));
$$;

create or replace function private.branch_count(v bigint)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.branches b join public.shops s on s.id = b.shop_id where s.vendor_id = v
$$;
revoke execute on function private.branch_count(bigint) from public, anon;
grant execute on function private.branch_count(bigint) to authenticated;

-- Vendors adding a shop, branch or offer stay within their plan; admins are not limited.
create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
  p public.plans;
begin
  if private.is_app_admin_or_service() then
    return new;
  end if;
  if tg_table_name = 'shops' then
    v := new.vendor_id;
  else
    v := (select sh.vendor_id from public.shops sh where sh.id = new.shop_id);
  end if;
  p := private.vendor_plan(v);
  if p.id is null then
    return new;
  end if;
  if tg_table_name = 'shops' and p.max_shops is not null and private.shop_count(v) >= p.max_shops then
    raise exception 'Your % plan allows % shop(s). Upgrade your plan to add more.', p.name, p.max_shops
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if tg_table_name = 'branches' and p.max_branches is not null
     and private.branch_count(v) >= p.max_branches then
    raise exception 'Your % plan allows % branch(es). Upgrade your plan to add more.', p.name, p.max_branches
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if tg_table_name = 'offers' and p.max_live_offers is not null
     and private.live_offer_count(v) >= p.max_live_offers then
    raise exception 'Your % plan allows % live offer(s). Upgrade your plan or end an offer first.',
      p.name, p.max_live_offers using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end;
$$;
drop trigger if exists branches_plan_limit on public.branches;
create trigger branches_plan_limit before insert on public.branches
  for each row execute function public.enforce_plan_limits();

-- True when nothing is owed for the plan picked when applying: no plan, a free plan, or a paid plan invoice.
create or replace function private.application_paid(v bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.price = 0 from public.vendors ve join public.plans p on p.id = ve.plan_id
                   where ve.id = v), true)
      or exists (select 1 from public.invoices i join public.invoice_items it on it.invoice_id = i.id
                 where i.vendor_id = v and i.status = 'paid' and it.plan_id is not null);
$$;
revoke execute on function private.application_paid(bigint) from public, anon;
grant execute on function private.application_paid(bigint) to authenticated;

-- Admins approve an applicant on a paid plan only after its invoice is marked paid. Direct database
-- sessions (service role, SQL editor) can still approve anyone.
create or replace function public.vendor_payment_first()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'approved'
     and current_user in ('anon', 'authenticated')
     and not private.application_paid(new.id) then
    raise exception 'Waiting for payment: mark this vendor''s plan invoice as paid before approving.'
      using errcode = 'P0001', hint = 'payment_first';
  end if;
  return new;
end;
$$;
revoke execute on function public.vendor_payment_first() from public, anon, authenticated;
drop trigger if exists vendors_payment_first on public.vendors;
-- Runs after vendors_guard (triggers fire in name order), so it sees the status an admin really set.
create trigger vendors_payment_first before update of status on public.vendors
  for each row execute function public.vendor_payment_first();

-- The approval message now points at the next step, adding a first offer.
create or replace function public.alert_vendor_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'blocked') then
    perform private.notify(
      new.owner_id, 'vendor_review',
      case when new.status = 'approved' then 'You''re approved!' else 'Your business account is blocked' end,
      case when new.status = 'approved' then 'Your shop is now live on IWILLFLY. Add your first offer.'
           else coalesce(new.admin_note, 'Contact IWILLFLY support for details.') end,
      case when new.status = 'approved' then '/vendor/offers/new' else '/vendor' end);
  end if;
  return null;
end;
$$;

-- Checks one "HH:MM" time.
create or replace function private.is_hhmm(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select coalesce(t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false) $$;

-- The whole application: the plan, the business, its first shop and that shop's branches (1 or 2).
-- p = {"plan_id": 1, "business_name": "optional, defaults to the shop name",
--      "shop": {"name", "category_id", "description", "phone", "whatsapp"},
--      "branches": [{"name", "address", "location_id", "lat", "lng", "parking", "parking_note", "phone",
--                    "hours": {"mon": {"open": "09:00", "close": "21:00"}, ...}}]}
-- Returns {"vendor_id", "shop_id", "branch_ids", "invoice_id"}. Runs as one transaction: any problem saves nothing.
create or replace function public.submit_vendor_application(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  pl public.plans;
  existing public.vendors;
  vid bigint;
  sid bigint;
  bid bigint;
  bids bigint[] := '{}';
  inv bigint;
  shop jsonb := p->'shop';
  branches jsonb := p->'branches';
  b jsonb;
  d record;
  n int;
  i int := 0;
  shop_name text := trim(coalesce(shop->>'name', ''));
  biz text;
  phone text := nullif(trim(coalesce(shop->>'phone', '')), '');
  wa text := nullif(trim(coalesce(shop->>'whatsapp', '')), '');
  descr text := nullif(trim(coalesce(shop->>'description', '')), '');
  cat bigint;
  label text;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '28000'; end if;

  select * into existing from public.vendors where owner_id = uid;
  if existing.id is not null then
    -- An earlier three-field application with nothing set up yet can be completed here.
    if existing.status <> 'pending' or exists (select 1 from public.shops where vendor_id = existing.id) then
      raise exception 'This account already has a business. Open your vendor dashboard instead.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Step 1: plan
  select * into pl from public.plans where id = nullif(p->>'plan_id', '')::bigint and is_active;
  if pl.id is null then
    raise exception 'Step 1: please choose one of the plans on offer.' using errcode = '22023';
  end if;
  if pl.max_shops = 0 then
    raise exception 'Step 1: the % plan does not include a shop. Please choose another plan.', pl.name
      using errcode = '22023';
  end if;

  -- Step 2: business and shop
  if char_length(shop_name) not between 2 and 120 then
    raise exception 'Step 2: shop name should be 2 to 120 characters.' using errcode = '22023';
  end if;
  biz := coalesce(nullif(trim(coalesce(p->>'business_name', '')), ''), shop_name);
  if char_length(biz) not between 2 and 120 then
    raise exception 'Step 2: business name should be 2 to 120 characters.' using errcode = '22023';
  end if;
  cat := nullif(shop->>'category_id', '')::bigint;
  if cat is null or not exists (select 1 from public.categories where id = cat) then
    raise exception 'Step 2: please choose a category.' using errcode = '22023';
  end if;
  if descr is null or char_length(descr) > 1000 then
    raise exception 'Step 2: please describe your shop (up to 1000 characters).' using errcode = '22023';
  end if;
  if phone is null or char_length(phone) > 20 or phone !~ '^\+?[0-9 -]{6,}$' then
    raise exception 'Step 2: please enter a valid shop phone number.' using errcode = '22023';
  end if;
  if wa is null or char_length(wa) > 20 or wa !~ '^\+?[0-9 -]{6,}$' then
    raise exception 'Step 2: please enter a valid WhatsApp number.' using errcode = '22023';
  end if;

  -- Steps 3 to 5: branches
  if jsonb_typeof(branches) is distinct from 'array' then
    raise exception 'Step 3: please add where your shop is.' using errcode = '22023';
  end if;
  n := jsonb_array_length(branches);
  if n not between 1 and 2 then
    raise exception 'Step 5: you can add up to 2 branches here. Add more from your dashboard later.'
      using errcode = '22023';
  end if;
  if pl.max_branches is not null and n > pl.max_branches then
    raise exception 'Step 5: the % plan allows % branch(es).', pl.name, pl.max_branches using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(branches) loop
    i := i + 1;
    label := case when n = 1 then 'Step 3' else 'Branch ' || i end;
    if n > 1 and char_length(trim(coalesce(b->>'name', ''))) not between 1 and 80 then
      raise exception '%: please give the branch a name (up to 80 characters).', label using errcode = '22023';
    end if;
    if char_length(trim(coalesce(b->>'address', ''))) not between 5 and 300 then
      raise exception '%: please enter the full address (5 to 300 characters).', label using errcode = '22023';
    end if;
    if not exists (select 1 from public.locations where id = nullif(b->>'location_id', '')::bigint) then
      raise exception '%: please choose the Area.', label using errcode = '22023';
    end if;
    if jsonb_typeof(b->'lat') is distinct from 'number' or jsonb_typeof(b->'lng') is distinct from 'number'
       or (b->>'lat')::float8 not between -90 and 90 or (b->>'lng')::float8 not between -180 and 180 then
      raise exception '%: please put the pin on the map.', label using errcode = '22023';
    end if;
    if coalesce(b->>'parking', '') not in ('free', 'free_bike', 'paid', 'street', 'none') then
      raise exception '%: please choose the parking option.', label using errcode = '22023';
    end if;
    if char_length(coalesce(b->>'parking_note', '')) > 100 then
      raise exception '%: parking note is too long (100 characters max).', label using errcode = '22023';
    end if;
    if char_length(coalesce(b->>'phone', '')) > 20 then
      raise exception '%: branch phone is too long.', label using errcode = '22023';
    end if;
    if jsonb_typeof(b->'hours') is distinct from 'object' or b->'hours' = '{}'::jsonb then
      raise exception '%: please set the opening hours (at least one open day).', label using errcode = '22023';
    end if;
    for d in select * from jsonb_each(b->'hours') loop
      if d.key not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
         or not private.is_hhmm(d.value->>'open') or not private.is_hhmm(d.value->>'close')
         or d.value->>'open' = d.value->>'close' then
        raise exception '%: please check the opening hours.', label using errcode = '22023';
      end if;
    end loop;
  end loop;

  -- Save: business, role, shop, branches.
  if existing.id is not null then
    update public.vendors set business_name = biz, contact_phone = phone, whatsapp = wa, plan_id = pl.id
      where id = existing.id;
    vid := existing.id;
  else
    insert into public.vendors (owner_id, business_name, contact_phone, whatsapp, plan_id)
    values (uid, biz, phone, wa, pl.id)
    returning id into vid;
  end if;
  insert into public.user_roles (user_id, role) values (uid, 'vendor') on conflict do nothing;

  insert into public.shops (vendor_id, category_id, name, description, phone, whatsapp)
  values (vid, cat, shop_name, descr, phone, wa)
  returning id into sid;

  i := 0;
  for b in select * from jsonb_array_elements(branches) loop
    i := i + 1;
    insert into public.branches (shop_id, name, address, location_id, lat, lng, phone, hours, parking,
                                 parking_note)
    values (sid,
            case when n = 1 then 'Main branch' else trim(b->>'name') end,
            trim(b->>'address'),
            (b->>'location_id')::bigint,
            (b->>'lat')::float8,
            (b->>'lng')::float8,
            coalesce(nullif(trim(coalesce(b->>'phone', '')), ''), phone),
            b->'hours',
            b->>'parking',
            nullif(trim(coalesce(b->>'parking_note', '')), ''))
    returning id into bid;
    bids := bids || bid;
  end loop;

  -- The plan's invoice; a free plan switches on straight away (create_invoice does that).
  inv := public.create_invoice(jsonb_build_array(jsonb_build_object('plan_id', pl.id)));

  return jsonb_build_object('vendor_id', vid, 'shop_id', sid, 'branch_ids', to_jsonb(bids), 'invoice_id', inv);
end;
$$;
revoke execute on function public.submit_vendor_application(jsonb) from public, anon;
grant execute on function public.submit_vendor_application(jsonb) to authenticated;
revoke execute on function private.is_hhmm(text) from public, anon;
grant execute on function private.is_hhmm(text) to authenticated;
