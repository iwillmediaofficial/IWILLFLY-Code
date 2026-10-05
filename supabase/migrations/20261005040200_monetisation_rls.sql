-- IWILLFLY Phase 4 (part 2): vendor staff access, plan limits, billing RPCs, support tickets, admin roles
-- and the audit log.

-- Vendor staff helpers ----------------------------------------------------------------------------

-- Managers now share the owner's edit rights, so the Phase 1 helpers learn about them.
create or replace function private.my_vendor_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.vendors v
  where v.status <> 'blocked'
    and (v.owner_id = (select auth.uid())
         or exists (select 1 from public.vendor_staff s
                    where s.vendor_id = v.id and s.user_id = (select auth.uid())
                      and s.removed_at is null and s.role = 'manager'))
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;

create or replace function private.owns_shop(s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.shops sh where sh.id = s and sh.vendor_id = private.my_vendor_id());
$$;

-- Read access for the owner (even while blocked) and every current team member.
create or replace function private.can_see_own_shop(s bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops sh join public.vendors v on v.id = sh.vendor_id
    where sh.id = s
      and (v.owner_id = (select auth.uid())
           or exists (select 1 from public.vendor_staff st
                      where st.vendor_id = v.id and st.user_id = (select auth.uid()) and st.removed_at is null))
  );
$$;

-- The business the caller works for in any role (owner, manager or staff), unless it is blocked.
create or replace function private.my_member_vendor_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.vendors v
  where v.status <> 'blocked'
    and (v.owner_id = (select auth.uid())
         or exists (select 1 from public.vendor_staff s
                    where s.vendor_id = v.id and s.user_id = (select auth.uid()) and s.removed_at is null))
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;

create or replace function private.is_vendor_owner(v bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.vendors where id = v and owner_id = (select auth.uid())) $$;

create or replace function private.is_support()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_admin() or private.has_role('support') $$;

-- Anyone working for IWILLFLY (their changes are written to the audit log).
create or replace function private.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles where user_id = (select auth.uid())
                 and role in ('admin', 'super_admin', 'support', 'campaign_manager'));
$$;

revoke execute on function private.my_member_vendor_id(), private.is_vendor_owner(bigint), private.is_support(),
  private.is_platform_staff() from public;
grant execute on function private.my_member_vendor_id(), private.is_vendor_owner(bigint), private.is_support(),
  private.is_platform_staff() to anon, authenticated;

-- Team members can read their business and its shops (the Phase 1 policies only knew the owner).
create policy "vendors: team read" on public.vendors
  for select to authenticated using (id = (select private.my_member_vendor_id()));
create policy "shops: team read" on public.shops
  for select to authenticated using ((select private.can_see_own_shop(id)));

create policy "vendor_staff: team or admin read" on public.vendor_staff
  for select to authenticated
  using (vendor_id = (select private.my_member_vendor_id()) or user_id = (select auth.uid())
         or (select private.is_support()));

-- The caller's business with their role in it: 'owner', 'manager' or 'staff'.
create or replace function public.my_vendor()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(v) || jsonb_build_object('my_role',
    case when v.owner_id = (select auth.uid()) then 'owner'
         else (select s.role::text from public.vendor_staff s
               where s.vendor_id = v.id and s.user_id = (select auth.uid()) and s.removed_at is null) end)
  from public.vendors v
  where v.owner_id = (select auth.uid())
     or exists (select 1 from public.vendor_staff s
                where s.vendor_id = v.id and s.user_id = (select auth.uid()) and s.removed_at is null)
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;

-- The whole team with names and emails, for every member.
create or replace function public.vendor_team()
returns table (user_id uuid, email text, full_name text, role text, added_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.owner_id, u.email::text, p.full_name, 'owner', v.created_at
  from public.vendors v join auth.users u on u.id = v.owner_id left join public.profiles p on p.id = v.owner_id
  where v.id = private.my_member_vendor_id()
  union all
  select s.user_id, u.email::text, p.full_name, s.role::text, s.added_at
  from public.vendor_staff s join auth.users u on u.id = s.user_id left join public.profiles p on p.id = s.user_id
  where s.vendor_id = private.my_member_vendor_id() and s.removed_at is null
  order by 5;
$$;

-- Owner only: add someone (who has signed in to IWILLFLY at least once) as manager or staff.
create or replace function public.add_vendor_staff(p_email text, p_role public.staff_role)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.vendors;
  target uuid;
begin
  select * into v from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked';
  if not found then
    raise exception 'Only the business owner can add team members' using errcode = 'insufficient_privilege';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'No IWILLFLY account uses that email. Ask them to sign in once, then try again.'
      using errcode = 'P0002';
  end if;
  if target = v.owner_id then
    raise exception 'You already own this business' using errcode = '22023';
  end if;
  if exists (select 1 from public.vendors where owner_id = target) then
    raise exception 'That person runs their own business on IWILLFLY' using errcode = '22023';
  end if;
  if exists (select 1 from public.vendor_staff where user_id = target and removed_at is null and vendor_id <> v.id) then
    raise exception 'That person already works for another business' using errcode = '22023';
  end if;
  insert into public.vendor_staff (vendor_id, user_id, role, added_by)
  values (v.id, target, p_role, (select auth.uid()))
  on conflict (vendor_id, user_id) do update
    set role = excluded.role, removed_at = null, added_by = excluded.added_by, added_at = now();
  insert into public.user_roles (user_id, role) values (target, 'vendor') on conflict do nothing;
  perform private.notify(target, 'staff', 'You joined ' || v.business_name,
    'You were added as ' || p_role::text || '. Open the vendor area to get started.', '/vendor');
  return jsonb_build_object('user_id', target, 'role', p_role);
end;
$$;

-- Owner only: change a member's role, or remove them (p_role null).
create or replace function public.set_vendor_staff(p_user_id uuid, p_role public.staff_role)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v bigint := (select id from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked');
begin
  if v is null then
    raise exception 'Only the business owner can change the team' using errcode = 'insufficient_privilege';
  end if;
  update public.vendor_staff
    set role = coalesce(p_role, role), removed_at = case when p_role is null then now() end
    where vendor_id = v and user_id = p_user_id and removed_at is null;
  if not found then
    raise exception 'Not a member of your team' using errcode = 'P0002';
  end if;
end;
$$;

-- A member leaves the business they work for.
create or replace function public.leave_vendor()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.vendor_staff set removed_at = now() where user_id = (select auth.uid()) and removed_at is null;
$$;

-- Staff can check claim codes and see insights too: these switch from the owner/manager id to any member.

create or replace function public.claim_prize(p_code text, p_confirm boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  p public.scratch_plays;
  manager boolean := private.can_manage_campaigns();
  me bigint := private.my_member_vendor_id();
  status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into p from public.scratch_plays where claim_code = code for update;
  -- Someone else's code looks the same as a wrong one, so codes cannot be probed.
  if not found or not coalesce(manager or (p.vendor_id = me and private.vendor_is_live(me)), false) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p.claim_status = 'unclaimed' and p.expires_at < now() then
    update public.scratch_plays set claim_status = 'expired' where id = p.id returning * into p;
  end if;
  status := p.claim_status::text;

  if p_confirm and p.claim_status = 'unclaimed' then
    if p.fraud_flag then
      status := 'flagged';
    else
      update public.scratch_plays
        set claim_status = 'claimed', claimed_at = now(), claimed_by = (select auth.uid())
        where id = p.id returning * into p;
      status := 'claimed_now';
    end if;
  end if;

  return private.play_json(p) - 'sponsor'
    || jsonb_build_object('status', status, 'customer_name', private.masked_name(p.customer_id),
                          'fraud_flag', p.fraud_flag);
end;
$$;

create or replace function public.vendor_winners(p_campaign_id bigint default null)
returns table (
  play_id bigint, campaign_id bigint, campaign_name text, prize_id bigint, prize_name text,
  customer_name text, played_at timestamptz, claim_status text, expires_at timestamptz, claimed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.campaign_id, c.name, p.prize_id, pr.name, private.masked_name(p.customer_id), p.played_at,
    case when p.claim_status = 'unclaimed' and p.expires_at < now() then 'expired' else p.claim_status::text end,
    p.expires_at, p.claimed_at
  from public.scratch_plays p
  join public.scratch_campaigns c on c.id = p.campaign_id
  join public.scratch_prizes pr on pr.id = p.prize_id
  where p.won and p.vendor_id = (select private.my_member_vendor_id())
    and (p_campaign_id is null or p.campaign_id = p_campaign_id)
  order by p.played_at desc
  limit 500;
$$;

create or replace function public.vendor_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint := private.my_member_vendor_id();
  d_from date := greatest(p_from, p_to - 91);
begin
  if v is null then
    raise exception 'No business on this account' using errcode = 'insufficient_privilege';
  end if;
  return (
    with s as (
      select st.* from public.offer_stats_daily st join public.shops sh on sh.id = st.shop_id
      where sh.vendor_id = v and st.day between d_from and p_to
    )
    select jsonb_build_object(
      'from', d_from, 'to', p_to,
      'totals', (select jsonb_build_object('views', coalesce(sum(views), 0), 'clicks', coalesce(sum(clicks), 0),
                   'saves', coalesce(sum(saves), 0), 'whatsapp', coalesce(sum(whatsapp), 0),
                   'calls', coalesce(sum(calls), 0), 'directions', coalesce(sum(directions), 0)) from s),
      'daily', coalesce((select jsonb_agg(x order by x.day) from (
                 select day, sum(views)::int as views, sum(clicks)::int as clicks, sum(saves)::int as saves,
                   sum(whatsapp)::int as whatsapp, sum(calls)::int as calls, sum(directions)::int as directions
                 from s group by day) x), '[]'::jsonb),
      'offers', coalesce((select jsonb_agg(x order by x.views desc, x.clicks desc) from (
                 select s.offer_id, o.title, sum(s.views)::int as views, sum(s.clicks)::int as clicks,
                   sum(s.saves)::int as saves, sum(s.whatsapp)::int as whatsapp
                 from s join public.offers o on o.id = s.offer_id group by s.offer_id, o.title) x), '[]'::jsonb),
      'scratch', (select jsonb_build_object(
                   'won', count(*),
                   'claimed', count(*) filter (where claim_status = 'claimed'))
                 from public.scratch_plays
                 where vendor_id = v and won and (played_at at time zone 'Asia/Kolkata')::date between d_from and p_to)
    )
  );
end;
$$;

-- Shops with a paid "featured shop" add-on rank with the featured ones.
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
         coalesce(o.cnt, 0)::int, o.top, (coalesce(o.featured, false) or s.is_featured)
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
           case when here.g is null then (coalesce(o.featured, false) or s.is_featured) end desc,
           s.name
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

-- Featured shops ----------------------------------------------------------------------------------

-- Only admins and the billing job switch a shop's featured flag.
create or replace function public.guard_shop()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_app_admin_or_service() then
    return new;
  end if;
  new.is_featured := case when tg_op = 'INSERT' then false else old.is_featured end;
  return new;
end;
$$;
create trigger shops_guard before insert or update on public.shops
  for each row execute function public.guard_shop();

-- Plans and limits --------------------------------------------------------------------------------

-- The plan a vendor is on today: the newest running subscription, else the default plan (may be none).
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
    (select id from public.plans where is_default));
$$;

create or replace function private.live_offer_count(v bigint)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.offers o join public.shops s on s.id = o.shop_id
  where s.vendor_id = v and o.status <> 'rejected'
    and (o.ends_on is null or o.ends_on >= private.today_ist());
$$;

create or replace function private.shop_count(v bigint)
returns int
language sql
stable
security definer
set search_path = ''
as $$ select count(*)::int from public.shops where vendor_id = v $$;

-- Only used by the limit trigger below (private is not exposed through the API).
revoke execute on function private.vendor_plan(bigint), private.live_offer_count(bigint), private.shop_count(bigint)
  from public, anon;
grant execute on function private.vendor_plan(bigint), private.live_offer_count(bigint), private.shop_count(bigint)
  to authenticated;

-- Vendors adding a shop or an offer stay within their plan; admins are not limited.
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
  if tg_table_name = 'offers' and p.max_live_offers is not null
     and private.live_offer_count(v) >= p.max_live_offers then
    raise exception 'Your % plan allows % live offer(s). Upgrade your plan or end an offer first.',
      p.name, p.max_live_offers using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end;
$$;
create trigger shops_plan_limit before insert on public.shops
  for each row execute function public.enforce_plan_limits();
create trigger offers_plan_limit before insert on public.offers
  for each row execute function public.enforce_plan_limits();

-- Catalogue and settings: vendors read, admins manage.
create policy "billing_settings: signed-in read" on public.billing_settings
  for select to authenticated using (true);
create policy "billing_settings: admin update" on public.billing_settings
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "plans: read active or admin" on public.plans
  for select to authenticated using (is_active or is_default or (select private.is_admin()));
create policy "plans: admin insert" on public.plans
  for insert to authenticated with check ((select private.is_admin()));
create policy "plans: admin update" on public.plans
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "plans: admin delete" on public.plans
  for delete to authenticated using ((select private.is_admin()));

create policy "addons: read active or admin" on public.addons
  for select to authenticated using (is_active or (select private.is_admin()));
create policy "addons: admin insert" on public.addons
  for insert to authenticated with check ((select private.is_admin()));
create policy "addons: admin update" on public.addons
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "addons: admin delete" on public.addons
  for delete to authenticated using ((select private.is_admin()));

-- Invoices and purchases: the owner reads their own, support reads all; changes go through RPCs.
create policy "invoices: owner or support read" on public.invoices
  for select to authenticated
  using ((select private.is_vendor_owner(vendor_id)) or (select private.is_support()));
create policy "invoice_items: owner or support read" on public.invoice_items
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                 and ((select private.is_vendor_owner(i.vendor_id)) or (select private.is_support()))));
create policy "subscriptions: team or support read" on public.subscriptions
  for select to authenticated
  using (vendor_id = (select private.my_member_vendor_id()) or (select private.is_support()));
create policy "subscriptions: admin update" on public.subscriptions
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "addon_purchases: team or support read" on public.addon_purchases
  for select to authenticated
  using (vendor_id = (select private.my_member_vendor_id()) or (select private.is_support()));
create policy "addon_purchases: admin update" on public.addon_purchases
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- Billing -----------------------------------------------------------------------------------------

-- Switches on everything a paid invoice bought. A plan bought again extends the running one; a different
-- plan starts today. Add-ons for the same shop or offer extend each other.
create or replace function private.activate_invoice(p_invoice_id bigint, p_method text, p_ref text,
                                                    p_paid_on date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  it public.invoice_items;
  k public.addon_kind;
  st date;
  today date := private.today_ist();
begin
  update public.invoices
    set status = 'paid', payment_method = p_method, payment_ref = coalesce(nullif(trim(p_ref), ''), payer_ref),
        paid_on = coalesce(p_paid_on, today), recorded_by = (select auth.uid())
    where id = p_invoice_id
    returning * into i;
  for it in select * from public.invoice_items where invoice_id = i.id order by id loop
    if it.plan_id is not null then
      st := greatest(today, coalesce(
        (select max(ends_on) + 1 from public.subscriptions
         where vendor_id = i.vendor_id and plan_id = it.plan_id and cancelled_at is null and ends_on >= today),
        today));
      insert into public.subscriptions (vendor_id, plan_id, invoice_item_id, starts_on, ends_on)
      values (i.vendor_id, it.plan_id, it.id, st, st + it.days - 1);
    else
      k := (select kind from public.addons where id = it.addon_id);
      st := greatest(today, coalesce(
        (select max(ends_on) + 1 from public.addon_purchases
         where vendor_id = i.vendor_id and kind = k and cancelled_at is null and ends_on >= today
           and shop_id is not distinct from it.shop_id and offer_id is not distinct from it.offer_id),
        today));
      insert into public.addon_purchases (vendor_id, addon_id, kind, shop_id, offer_id, invoice_item_id,
                                          starts_on, ends_on)
      values (i.vendor_id, it.addon_id, k, it.shop_id, it.offer_id, it.id, st, st + it.days - 1);
    end if;
  end loop;
  perform private.apply_addon_flags();
  perform private.notify(private.vendor_owner(i.vendor_id), 'billing', 'Payment received: ' || i.number,
    'Thank you. What you bought is now active.', '/vendor/billing');
end;
$$;

-- Featured shops and promoted offers follow their paid dates. A flag is only switched off when every
-- purchase behind it has run out, so features an admin set by hand without a purchase are left alone.
create or replace function private.apply_addon_flags()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
begin
  update public.shops set is_featured = true
  where not is_featured and id in (
    select shop_id from public.addon_purchases
    where kind = 'featured_shop' and cancelled_at is null and today between starts_on and ends_on);
  update public.shops s set is_featured = false
  where s.is_featured
    and exists (select 1 from public.addon_purchases a where a.shop_id = s.id and a.kind = 'featured_shop')
    and not exists (select 1 from public.addon_purchases a where a.shop_id = s.id and a.kind = 'featured_shop'
                    and a.cancelled_at is null and today between a.starts_on and a.ends_on);
  update public.offers set is_featured = true
  where not is_featured and status = 'approved' and id in (
    select offer_id from public.addon_purchases
    where kind = 'promoted_offer' and cancelled_at is null and today between starts_on and ends_on);
  update public.offers o set is_featured = false
  where o.is_featured
    and exists (select 1 from public.addon_purchases a where a.offer_id = o.id and a.kind = 'promoted_offer')
    and not exists (select 1 from public.addon_purchases a where a.offer_id = o.id and a.kind = 'promoted_offer'
                    and a.cancelled_at is null and today between a.starts_on and a.ends_on);
end;
$$;
revoke execute on function private.activate_invoice(bigint, text, text, date), private.apply_addon_flags()
  from public, anon, authenticated;

-- An admin cancelling or extending an add-on takes effect right away, not at midnight.
create or replace function public.refresh_addon_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_addon_flags();
  return null;
end;
$$;
revoke execute on function public.refresh_addon_flags() from public, anon, authenticated;
create trigger addon_purchases_refresh_flags after update on public.addon_purchases
  for each statement execute function public.refresh_addon_flags();

-- The owner (or an admin, for any vendor) creates an invoice for plans and add-ons from the catalogue.
-- p_items: [{"plan_id": 1}, {"addon_id": 2, "offer_id": 9}, {"addon_id": 3, "shop_id": 4}]
create or replace function public.create_invoice(p_items jsonb, p_vendor_id bigint default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  admin boolean := private.is_admin();
  v public.vendors;
  s public.billing_settings;
  inv bigint;
  item jsonb;
  pl public.plans;
  ad public.addons;
  shop bigint;
  offer bigint;
  label text;
  sub numeric(10,2);
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_vendor_id is not null and admin then
    select * into v from public.vendors where id = p_vendor_id;
  else
    select * into v from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked';
  end if;
  if v.id is null then
    raise exception 'Only the business owner can buy plans' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 10 then
    raise exception 'Choose between 1 and 10 items' using errcode = '22023';
  end if;
  if not admin and (select count(*) from public.invoices
                    where vendor_id = v.id and status in ('unpaid', 'submitted')) >= 5 then
    raise exception 'You have 5 unpaid invoices. Pay or ask us to cancel one first.' using errcode = 'P0001';
  end if;

  select * into s from public.billing_settings where id = 1;
  insert into public.invoices (number, vendor_id, gst_percent, bill_to, bill_from, created_by)
  values (s.invoice_prefix || '-' || to_char(private.today_ist(), 'YYYY') || '-'
            || lpad(nextval('public.invoice_number_seq')::text, 5, '0'),
          v.id, s.gst_percent,
          jsonb_build_object('business_name', v.business_name, 'phone', v.contact_phone, 'vendor_id', v.id),
          jsonb_build_object('name', s.business_name, 'address', s.business_address, 'gstin', s.gstin,
                             'upi_id', s.upi_id, 'payee_name', s.payee_name, 'note', s.payment_note),
          (select auth.uid()))
  returning id into inv;

  for item in select * from jsonb_array_elements(p_items) loop
    shop := nullif(item->>'shop_id', '')::bigint;
    offer := nullif(item->>'offer_id', '')::bigint;
    if item ? 'plan_id' then
      select * into pl from public.plans where id = (item->>'plan_id')::bigint and (is_active or admin);
      if pl.id is null then
        raise exception 'That plan is not available' using errcode = 'P0002';
      end if;
      insert into public.invoice_items (invoice_id, plan_id, description, days, amount)
      values (inv, pl.id, pl.name || ' plan (' || pl.period_days || ' days)', pl.period_days, pl.price);
    elsif item ? 'addon_id' then
      select * into ad from public.addons where id = (item->>'addon_id')::bigint and (is_active or admin);
      if ad.id is null then
        raise exception 'That add-on is not available' using errcode = 'P0002';
      end if;
      if ad.kind = 'promoted_offer' then
        select o.title, o.shop_id into label, shop from public.offers o join public.shops sh on sh.id = o.shop_id
        where o.id = offer and sh.vendor_id = v.id and o.status = 'approved';
        if label is null then
          raise exception 'Choose one of your approved offers to promote' using errcode = '22023';
        end if;
      else
        offer := null;
        label := (select name from public.shops where id = shop and vendor_id = v.id);
        if label is null and (ad.kind = 'featured_shop' or shop is not null) then
          raise exception 'Choose one of your shops' using errcode = '22023';
        end if;
      end if;
      insert into public.invoice_items (invoice_id, addon_id, shop_id, offer_id, description, days, amount)
      values (inv, ad.id, shop, offer,
              ad.name || coalesce(': ' || label, '') || ' (' || ad.duration_days || ' days)',
              ad.duration_days, ad.price);
    else
      raise exception 'Unknown item' using errcode = '22023';
    end if;
  end loop;

  sub := (select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = inv);
  update public.invoices
    set subtotal = sub, tax = round(sub * gst_percent / 100, 2), total = sub + round(sub * gst_percent / 100, 2)
    where id = inv;
  if sub = 0 then
    perform private.activate_invoice(inv, 'free', null, null);
  end if;
  return inv;
end;
$$;

-- The owner tells us they paid by UPI, with the transaction id from their UPI app.
create or replace function public.submit_payment(p_invoice_id bigint, p_ref text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_ref), '') is null then
    raise exception 'Enter the UPI transaction ID' using errcode = '22023';
  end if;
  update public.invoices
    set status = 'submitted', payer_ref = left(trim(p_ref), 60), payer_note = left(p_note, 300), submitted_at = now()
    where id = p_invoice_id and status in ('unpaid', 'submitted') and private.is_vendor_owner(vendor_id);
  if not found then
    raise exception 'Invoice not found or already settled' using errcode = 'P0002';
  end if;
end;
$$;

-- Admin: payment checked in the bank or UPI app, so switch on what was bought.
create or replace function public.mark_invoice_paid(p_invoice_id bigint, p_method text default 'upi',
                                                    p_ref text default null, p_paid_on date default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_method not in ('upi', 'cash', 'bank', 'razorpay') then
    raise exception 'Unknown payment method' using errcode = '22023';
  end if;
  perform 1 from public.invoices where id = p_invoice_id and status in ('unpaid', 'submitted') for update;
  if not found then
    raise exception 'Invoice not found or already settled' using errcode = 'P0002';
  end if;
  perform private.activate_invoice(p_invoice_id, p_method, p_ref, p_paid_on);
end;
$$;

-- Admin: cancel an unpaid invoice (wrong amount, vendor changed their mind).
create or replace function public.void_invoice(p_invoice_id bigint, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.invoices;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.invoices set status = 'void', void_reason = left(p_reason, 300), recorded_by = (select auth.uid())
    where id = p_invoice_id and status in ('unpaid', 'submitted')
    returning * into i;
  if i.id is null then
    raise exception 'Only unpaid invoices can be cancelled' using errcode = 'P0002';
  end if;
  perform private.notify(private.vendor_owner(i.vendor_id), 'billing', 'Invoice cancelled: ' || i.number,
    coalesce(p_reason, 'Contact IWILLFLY support if this is unexpected.'), '/vendor/billing');
end;
$$;

-- The vendor's plan, limits, usage and what is running, for the billing screen.
create or replace function public.my_billing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint := private.my_member_vendor_id();
  p public.plans;
  today date := private.today_ist();
begin
  if v is null then
    raise exception 'No business on this account' using errcode = 'insufficient_privilege';
  end if;
  p := private.vendor_plan(v);
  return jsonb_build_object(
    'plan', case when p.id is null then null else to_jsonb(p) end,
    'subscription', (select to_jsonb(s) from public.subscriptions s
                     where s.vendor_id = v and s.plan_id = p.id and s.cancelled_at is null
                       and today between s.starts_on and s.ends_on
                     order by s.created_at desc limit 1),
    -- paid time already queued after the current period, per plan
    'paid_until', (select max(ends_on) from public.subscriptions
                   where vendor_id = v and plan_id = p.id and cancelled_at is null and ends_on >= today),
    'usage', jsonb_build_object('shops', (select count(*) from public.shops where vendor_id = v),
                                'live_offers', private.live_offer_count(v)),
    'addons', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'name', ad.name, 'shop_id', a.shop_id, 'offer_id', a.offer_id,
                 'target', coalesce(o.title, sh.name), 'starts_on', a.starts_on, 'ends_on', a.ends_on)
                 order by a.ends_on)
               from public.addon_purchases a
               join public.addons ad on ad.id = a.addon_id
               left join public.shops sh on sh.id = a.shop_id
               left join public.offers o on o.id = a.offer_id
               where a.vendor_id = v and a.cancelled_at is null and a.ends_on >= today), '[]'::jsonb)
  );
end;
$$;

-- Daily (00:00 India time): flags follow paid dates, and owners hear 7 days and 1 day before things end.
create or replace function public.billing_daily()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := private.today_ist();
  r record;
begin
  perform private.apply_addon_flags();

  for r in
    select s.id, s.vendor_id, s.ends_on, p.name, (s.ends_on - today) as left_days
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.cancelled_at is null
      and ((s.ends_on - today = 7 and not s.reminded_7) or (s.ends_on - today = 1 and not s.reminded_1))
      -- not when the same plan is already paid for after this period
      and not exists (select 1 from public.subscriptions n where n.vendor_id = s.vendor_id
                      and n.plan_id = s.plan_id and n.cancelled_at is null and n.starts_on > s.ends_on)
  loop
    perform private.notify(private.vendor_owner(r.vendor_id), 'billing',
      'Your ' || r.name || ' plan ends ' || case when r.left_days = 1 then 'tomorrow' else 'in 7 days' end,
      'Renew from Plan & billing to keep your benefits.', '/vendor/billing');
  end loop;
  update public.subscriptions s set reminded_7 = true where cancelled_at is null and ends_on - today = 7;
  update public.subscriptions s set reminded_1 = true where cancelled_at is null and ends_on - today = 1;

  for r in
    select a.id, a.vendor_id, (a.ends_on - today) as left_days, ad.name,
      coalesce(o.title, sh.name) as target
    from public.addon_purchases a
    join public.addons ad on ad.id = a.addon_id
    left join public.shops sh on sh.id = a.shop_id
    left join public.offers o on o.id = a.offer_id
    where a.cancelled_at is null
      and ((a.ends_on - today = 7 and not a.reminded_7) or (a.ends_on - today = 1 and not a.reminded_1))
      and not exists (select 1 from public.addon_purchases n where n.vendor_id = a.vendor_id and n.kind = a.kind
                      and n.shop_id is not distinct from a.shop_id and n.offer_id is not distinct from a.offer_id
                      and n.cancelled_at is null and n.starts_on > a.ends_on)
  loop
    perform private.notify(private.vendor_owner(r.vendor_id), 'billing',
      r.name || ' ends ' || case when r.left_days = 1 then 'tomorrow' else 'in 7 days' end,
      coalesce(r.target || '. ', '') || 'Buy it again from Plan & billing to keep it running.', '/vendor/billing');
  end loop;
  update public.addon_purchases set reminded_7 = true where cancelled_at is null and ends_on - today = 7;
  update public.addon_purchases set reminded_1 = true where cancelled_at is null and ends_on - today = 1;
end;
$$;

-- Support tickets ---------------------------------------------------------------------------------

create or replace function private.can_see_ticket(t bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.support_tickets s where s.id = t
                 and (s.opened_by = (select auth.uid())
                      or (s.vendor_id is not null and s.vendor_id = private.my_vendor_id())
                      or private.is_support()));
$$;
revoke execute on function private.can_see_ticket(bigint) from public;
grant execute on function private.can_see_ticket(bigint) to authenticated;

create policy "support_tickets: own, business or support read" on public.support_tickets
  for select to authenticated using ((select private.can_see_ticket(id)));
create policy "support_tickets: support update" on public.support_tickets
  for update to authenticated using ((select private.is_support())) with check ((select private.is_support()));
create policy "ticket_messages: read with ticket" on public.ticket_messages
  for select to authenticated using ((select private.can_see_ticket(ticket_id)));

create or replace function public.open_ticket(p_subject text, p_category text, p_body text,
                                              p_image_key text default null, p_for_business boolean default false)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.support_tickets
      where opened_by = (select auth.uid()) and status in ('open', 'waiting')) >= 5 then
    raise exception 'You have 5 open tickets. Please wait for a reply first.' using errcode = 'P0001';
  end if;
  insert into public.support_tickets (opened_by, vendor_id, subject, category)
  values ((select auth.uid()), case when p_for_business then private.my_member_vendor_id() end,
          trim(p_subject), coalesce(p_category, 'other'))
  returning id into t;
  insert into public.ticket_messages (ticket_id, author_id, body, image_key)
  values (t, (select auth.uid()), trim(p_body), p_image_key);
  return t;
end;
$$;

create or replace function public.post_ticket_message(p_ticket_id bigint, p_body text, p_image_key text default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
  staff boolean;
  m bigint;
begin
  select * into t from public.support_tickets where id = p_ticket_id;
  if t.id is null or not private.can_see_ticket(t.id) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  staff := private.is_support() and t.opened_by <> (select auth.uid());
  insert into public.ticket_messages (ticket_id, author_id, is_staff, body, image_key)
  values (t.id, (select auth.uid()), staff, trim(p_body), p_image_key)
  returning id into m;
  update public.support_tickets
    set last_message_at = now(), last_from_staff = staff,
        status = case when staff then 'waiting' else 'open' end::public.ticket_status
    where id = t.id;
  if staff then
    perform private.notify(t.opened_by, 'support_reply', 'Reply from IWILLFLY support: ' || t.subject,
      left(trim(p_body), 300),
      case when t.vendor_id is not null then '/vendor/help/' else '/help/' end || t.id);
  end if;
  return m;
end;
$$;

-- The person who opened a ticket can close it; support can set any status.
create or replace function public.set_ticket_status(p_ticket_id bigint, p_status public.ticket_status)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.is_support() then
    update public.support_tickets set status = p_status where id = p_ticket_id;
  elsif p_status = 'closed' then
    update public.support_tickets set status = p_status
      where id = p_ticket_id and private.can_see_ticket(id);
  else
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Support queue with who opened each ticket.
create or replace function public.support_queue(p_status public.ticket_status default null)
returns table (
  id bigint, subject text, category text, status text, priority text, opened_by uuid, opener_email text,
  opener_name text, vendor_id bigint, business_name text, assigned_to uuid, assignee_email text,
  last_message_at timestamptz, last_from_staff boolean, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_support() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select t.id, t.subject, t.category, t.status::text, t.priority, t.opened_by, u.email::text, p.full_name,
      t.vendor_id, v.business_name, t.assigned_to, a.email::text, t.last_message_at, t.last_from_staff, t.created_at
    from public.support_tickets t
    left join auth.users u on u.id = t.opened_by
    left join public.profiles p on p.id = t.opened_by
    left join public.vendors v on v.id = t.vendor_id
    left join auth.users a on a.id = t.assigned_to
    where p_status is null or t.status = p_status
    order by (t.status in ('open', 'waiting')) desc, (t.priority = 'high') desc, t.last_message_at desc
    limit 300;
end;
$$;

-- Admin team --------------------------------------------------------------------------------------

-- Everyone holding an IWILLFLY staff role. (Removing a role is a plain delete on user_roles, which the
-- Phase 0 policies already allow for admins.)
create or replace function public.admin_team()
returns table (user_id uuid, email text, full_name text, roles text[], last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.email::text, p.full_name, array_agg(r.role::text order by r.role), u.last_sign_in_at
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = u.id
    where r.role in ('admin', 'super_admin', 'support', 'campaign_manager')
    group by u.id, u.email, p.full_name, u.last_sign_in_at
    order by u.email;
end;
$$;

-- Grant a staff role by email (the person creates their own account first, or a super admin creates it
-- in Supabase > Authentication). Only a super admin grants admin or super_admin.
create or replace function public.grant_staff_role(p_email text, p_role public.app_role)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if p_role not in ('admin', 'super_admin', 'support', 'campaign_manager') then
    raise exception 'Not a staff role' using errcode = '22023';
  end if;
  if not (private.has_role('super_admin') or (private.is_admin() and p_role not in ('admin', 'super_admin'))) then
    raise exception 'Only a super admin can grant that role' using errcode = 'insufficient_privilege';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'No account uses that email yet' using errcode = 'P0002';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (target, p_role, (select auth.uid()))
  on conflict do nothing;
  return target;
end;
$$;

-- Audit log ---------------------------------------------------------------------------------------

-- Records what IWILLFLY staff change, including changes made inside RPCs. Vendors, customers and
-- scheduled jobs are not logged.
create or replace function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  diff jsonb;
begin
  if (select auth.uid()) is null or not private.is_platform_staff() then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(e.key, jsonb_build_array(o->e.key, e.value)), '{}'::jsonb) into diff
    from jsonb_each(n) e
    where e.key not in ('updated_at') and e.value is distinct from o->e.key;
    if diff = '{}'::jsonb then
      return null;
    end if;
  else
    diff := r;
  end if;
  insert into public.admin_audit_log (actor_id, action, table_name, row_id, changes)
  values ((select auth.uid()), lower(tg_op), tg_table_name,
          coalesce(r->>'id', concat_ws(':', r->>'user_id', r->>'festival_id', r->>'offer_id', r->>'role')),
          diff);
  return null;
end;
$$;
revoke execute on function private.audit_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['user_roles', 'vendors', 'shops', 'offers', 'categories', 'locations', 'malls',
    'mall_shops', 'scratch_campaigns', 'scratch_prizes', 'scratch_plays', 'festivals', 'festival_offers',
    'ads', 'placement_requests', 'broadcasts', 'billing_settings', 'plans', 'addons', 'invoices',
    'subscriptions', 'addon_purchases', 'support_tickets', 'vendor_staff'] loop
    execute format('create trigger %I after insert or update or delete on public.%I '
                   'for each row execute function private.audit_change()', t || '_audit', t);
  end loop;
end $$;

create policy "admin_audit_log: admin read" on public.admin_audit_log
  for select to authenticated using ((select private.is_admin()));

-- Audit log with names, newest first.
create or replace function public.audit_log(p_table text default null, p_actor uuid default null,
                                            p_before bigint default null, p_limit int default 100)
returns table (id bigint, actor_id uuid, actor_email text, action text, table_name text, row_id text,
               changes jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select l.id, l.actor_id, u.email::text, l.action, l.table_name, l.row_id, l.changes, l.created_at
    from public.admin_audit_log l left join auth.users u on u.id = l.actor_id
    where (p_table is null or l.table_name = p_table)
      and (p_actor is null or l.actor_id = p_actor)
      and (p_before is null or l.id < p_before)
    order by l.id desc
    limit least(greatest(p_limit, 1), 200);
end;
$$;

-- Grants ------------------------------------------------------------------------------------------

revoke execute on function public.guard_shop(), public.enforce_plan_limits() from public, anon, authenticated;
revoke execute on function public.my_vendor(), public.vendor_team(), public.add_vendor_staff(text, public.staff_role),
  public.set_vendor_staff(uuid, public.staff_role), public.leave_vendor(), public.create_invoice(jsonb, bigint),
  public.submit_payment(bigint, text, text), public.mark_invoice_paid(bigint, text, text, date),
  public.void_invoice(bigint, text), public.my_billing(), public.billing_daily(),
  public.open_ticket(text, text, text, text, boolean), public.post_ticket_message(bigint, text, text),
  public.set_ticket_status(bigint, public.ticket_status), public.support_queue(public.ticket_status),
  public.admin_team(), public.grant_staff_role(text, public.app_role),
  public.audit_log(text, uuid, bigint, int)
  from public, anon, authenticated;
grant execute on function public.my_vendor(), public.vendor_team(), public.add_vendor_staff(text, public.staff_role),
  public.set_vendor_staff(uuid, public.staff_role), public.leave_vendor(), public.create_invoice(jsonb, bigint),
  public.submit_payment(bigint, text, text), public.mark_invoice_paid(bigint, text, text, date),
  public.void_invoice(bigint, text), public.my_billing(),
  public.open_ticket(text, text, text, text, boolean), public.post_ticket_message(bigint, text, text),
  public.set_ticket_status(bigint, public.ticket_status), public.support_queue(public.ticket_status),
  public.admin_team(), public.grant_staff_role(text, public.app_role),
  public.audit_log(text, uuid, bigint, int)
  to authenticated;
