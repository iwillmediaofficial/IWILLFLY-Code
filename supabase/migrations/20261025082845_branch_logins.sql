-- Branch logins and offers per branch (big brands with many branches, each run by its own manager).
--   * A team member can be tied to ONE branch (vendor_staff.branch_id): a branch manager edits that branch and
--     its offers only; branch staff check prize codes. Members with no branch work for the whole brand as before.
--   * Branch logins can be a username + password made by the owner (accounts created by the Worker with an
--     internal @branch.iwillfly.in address), an email invite, or a WhatsApp invite link (vendor_invites).
--   * Offers are for all branches (offers.all_branches) or only some (offer_branches).
--   * Plan offer limit counts per branch: brand-wide offers share one pool, each branch has its own pool.
--   * Branches added after the business is approved wait for an admin (branches.review_status).
--   * Branch links: /shop/<shop slug>/<branch slug>.
--   * Plans can include some branches and charge for each extra one (plans.included_branches, extra_branch_price).

-- Team members tied to a branch ----------------------------------------------------------------------

alter table public.vendor_staff
  add column if not exists branch_id bigint references public.branches (id) on delete cascade,
  -- set for username logins (the part before @branch.iwillfly.in)
  add column if not exists login_name text constraint vendor_staff_login_name_check
    check (login_name ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  -- switched off by the owner (the account is also blocked from signing in)
  add column if not exists disabled_at timestamptz;
create index if not exists vendor_staff_branch_idx on public.vendor_staff (branch_id) where branch_id is not null;

-- A member's branch must belong to their business.
create or replace function public.check_staff_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.branch_id is not null and not exists (
    select 1 from public.branches b join public.shops s on s.id = b.shop_id
    where b.id = new.branch_id and s.vendor_id = new.vendor_id) then
    raise exception 'That branch is not part of this business' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists vendor_staff_branch on public.vendor_staff;
create trigger vendor_staff_branch before insert or update of branch_id, vendor_id on public.vendor_staff
  for each row execute function public.check_staff_branch();

-- Brand-level editors: the owner and managers with no branch.
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
                      and s.removed_at is null and s.disabled_at is null
                      and s.role = 'manager' and s.branch_id is null))
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;

-- Everyone in the business (read access), switched-off members excluded.
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
                    where s.vendor_id = v.id and s.user_id = (select auth.uid())
                      and s.removed_at is null and s.disabled_at is null))
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;

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
                      where st.vendor_id = v.id and st.user_id = (select auth.uid())
                        and st.removed_at is null and st.disabled_at is null))
  );
$$;

-- The branch the caller manages (branch managers only), or null.
create or replace function private.my_branch_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.branch_id from public.vendor_staff s join public.vendors v on v.id = s.vendor_id
  where s.user_id = (select auth.uid()) and s.removed_at is null and s.disabled_at is null
    and s.role = 'manager' and s.branch_id is not null and v.status <> 'blocked'
  limit 1;
$$;

-- The branch of any branch member (manager or staff), or null.
create or replace function private.my_member_branch_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.branch_id from public.vendor_staff s join public.vendors v on v.id = s.vendor_id
  where s.user_id = (select auth.uid()) and s.removed_at is null and s.disabled_at is null
    and s.branch_id is not null and v.status <> 'blocked'
  limit 1;
$$;

-- Brand editors manage every branch of their shops; a branch manager manages their own branch.
create or replace function private.can_manage_branch(b bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select b is not null and (b = private.my_branch_id()
    or exists (select 1 from public.branches br where br.id = b and private.owns_shop(br.shop_id)));
$$;

revoke execute on function private.my_branch_id(), private.my_member_branch_id(), private.can_manage_branch(bigint)
  from public;
grant execute on function private.my_branch_id(), private.my_member_branch_id(), private.can_manage_branch(bigint)
  to authenticated;

-- Branch links and admin review --------------------------------------------------------------------

alter table public.branches
  add column if not exists slug text,
  add column if not exists review_status text not null default 'approved'
    constraint branches_review_status_check check (review_status in ('approved', 'pending', 'rejected')),
  add column if not exists review_note text constraint branches_review_note_check check (char_length(review_note) <= 300),
  add column if not exists reviewed_at timestamptz;

-- "Kakkanad", "Main branch" -> "kakkanad", "main-branch"; the main branch uses its area name when it has one.
create or replace function private.branch_slug_base(b_name text, area text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when x = 'shop' then 'branch' when x like 'shop-%' then 'branch-' || substr(x, 6) else x end
  from (select private.shop_slug_base(
    case when lower(btrim(coalesce(b_name, ''))) in ('main branch', 'main', '') and area is not null
         then area else b_name end) as x) s;
$$;

create or replace function private.unique_branch_slug(p_shop bigint, base text, self bigint)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text := base;
  n int := 1;
begin
  while exists (select 1 from public.branches where shop_id = p_shop and slug = candidate
                and id is distinct from self) loop
    n := n + 1;
    candidate := left(base, 70) || '-' || n;
  end loop;
  return candidate;
end;
$$;

update public.branches b
  set slug = private.unique_branch_slug(b.shop_id,
    private.branch_slug_base(b.name, (select l.name from public.locations l where l.id = b.location_id)), b.id)
  where b.slug is null;
alter table public.branches alter column slug set not null;
alter table public.branches drop constraint if exists branches_slug_check;
alter table public.branches add constraint branches_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80);
create unique index if not exists branches_shop_slug_idx on public.branches (shop_id, slug);

-- Who may change what on a branch, its link, and review state.
create or replace function public.guard_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  admin boolean := private.is_app_admin_or_service();
  area text := (select l.name from public.locations l where l.id = new.location_id);
begin
  if tg_op = 'INSERT' then
    if new.slug is null or not admin then
      new.slug := private.unique_branch_slug(new.shop_id, private.branch_slug_base(new.name, area), null);
    end if;
    if not admin then
      -- Branches sent with an application are reviewed with the business; later ones wait for an admin.
      new.review_status := case when exists (
        select 1 from public.shops s join public.vendors v on v.id = s.vendor_id
        where s.id = new.shop_id and v.status = 'approved') then 'pending' else 'approved' end;
      new.review_note := null;
      new.reviewed_at := null;
    end if;
    return new;
  end if;
  if admin then
    if new.slug is distinct from old.slug then
      new.slug := private.unique_branch_slug(new.shop_id, coalesce(nullif(new.slug, ''), old.slug), new.id);
    end if;
    if new.review_status is distinct from old.review_status then
      new.reviewed_at := case when new.review_status = 'pending' then null else now() end;
    end if;
    return new;
  end if;
  new.shop_id := old.shop_id;
  new.slug := old.slug;
  new.review_status := old.review_status;
  new.review_note := old.review_note;
  new.reviewed_at := old.reviewed_at;
  -- A refused branch that is corrected goes back to the admin.
  if old.review_status = 'rejected' then
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists branches_guard on public.branches;
create trigger branches_guard before insert or update on public.branches
  for each row execute function public.guard_branch();

-- Tell admins about a branch that waits, and the owner about the answer.
create or replace function public.alert_branch_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shop_name text := (select name from public.shops where id = new.shop_id);
  owner uuid := (select v.owner_id from public.shops s join public.vendors v on v.id = s.vendor_id
                 where s.id = new.shop_id);
  a uuid;
begin
  if new.review_status = 'pending' and (tg_op = 'INSERT' or old.review_status is distinct from 'pending') then
    for a in select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin') loop
      perform private.notify(a, 'vendor_review', 'New branch to check: ' || shop_name,
        new.name || coalesce(' · ' || new.address, ''), '/admin/branches');
    end loop;
  elsif tg_op = 'UPDATE' and new.review_status is distinct from old.review_status
        and new.review_status in ('approved', 'rejected') then
    perform private.notify(owner, 'vendor_review',
      case when new.review_status = 'approved' then 'Branch approved: ' || new.name
           else 'Branch not approved: ' || new.name end,
      case when new.review_status = 'approved' then shop_name || ' · ' || new.name || ' is now live on IWILLFLY.'
           else coalesce(new.review_note, 'Check the branch details and save it again.') end,
      '/vendor/branches/' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists branches_review_alert on public.branches;
create trigger branches_review_alert after insert or update of review_status on public.branches
  for each row execute function public.alert_branch_review();

-- Customers see approved branches of live shops; the team sees all of theirs.
drop policy if exists "branches: public read live" on public.branches;
create policy "branches: public read live" on public.branches
  for select to authenticated
  using ((review_status = 'approved' and private.shop_is_live(shop_id))
         or private.can_see_own_shop(shop_id) or (select private.is_admin()));

drop policy if exists "branches: vendor or admin update" on public.branches;
create policy "branches: vendor or admin update" on public.branches
  for update to authenticated
  using (private.owns_shop(shop_id) or id = (select private.my_branch_id()) or (select private.is_admin()))
  with check (private.owns_shop(shop_id) or id = (select private.my_branch_id()) or (select private.is_admin()));

-- Refused branches do not count towards the plan.
create or replace function private.branch_count(v bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.branches b join public.shops s on s.id = b.shop_id
  where s.vendor_id = v and b.review_status <> 'rejected'
$$;

-- Offers per branch ---------------------------------------------------------------------------------

alter table public.offers
  add column if not exists all_branches boolean not null default true,
  add column if not exists created_by uuid default auth.uid() references auth.users (id) on delete set null;
create index if not exists offers_created_by_idx on public.offers (created_by);

create table if not exists public.offer_branches (
  offer_id bigint not null references public.offers (id) on delete cascade,
  branch_id bigint not null references public.branches (id) on delete cascade,
  primary key (offer_id, branch_id)
);
create index if not exists offer_branches_branch_idx on public.offer_branches (branch_id);
alter table public.offer_branches enable row level security;
-- Which branch has which offer is not secret. Written only by set_offer_branches().
drop policy if exists "offer_branches: signed-in read" on public.offer_branches;
create policy "offer_branches: signed-in read" on public.offer_branches for select to authenticated using (true);
grant select on public.offer_branches to authenticated;
revoke insert, update, delete on public.offer_branches from anon, authenticated;

-- A branch manager may change an offer only when it is for their branch alone.
create or replace function private.branch_owns_offer(o bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.my_branch_id() is not null
    and exists (select 1 from public.offers x where x.id = o and not x.all_branches)
    and exists (select 1 from public.offer_branches ob where ob.offer_id = o and ob.branch_id = private.my_branch_id())
    and not exists (select 1 from public.offer_branches ob
                    where ob.offer_id = o and ob.branch_id <> private.my_branch_id());
$$;

-- The shop of the branch the caller manages.
create or replace function private.my_branch_shop_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select b.shop_id from public.branches b where b.id = private.my_branch_id();
$$;

revoke execute on function private.branch_owns_offer(bigint), private.my_branch_shop_id() from public;
grant execute on function private.branch_owns_offer(bigint), private.my_branch_shop_id() to authenticated;

drop policy if exists "offers: vendor or admin insert" on public.offers;
create policy "offers: vendor or admin insert" on public.offers
  for insert to authenticated
  with check (((private.owns_shop(shop_id) or shop_id = (select private.my_branch_shop_id()))
               and private.vendor_is_live((select s.vendor_id from public.shops s where s.id = offers.shop_id)))
              or (select private.is_admin()));
drop policy if exists "offers: vendor or admin update" on public.offers;
create policy "offers: vendor or admin update" on public.offers
  for update to authenticated
  using (private.owns_shop(shop_id) or private.branch_owns_offer(id) or (select private.is_admin()))
  with check (private.owns_shop(shop_id) or private.branch_owns_offer(id) or (select private.is_admin()));
drop policy if exists "offers: vendor or admin delete" on public.offers;
create policy "offers: vendor or admin delete" on public.offers
  for delete to authenticated
  using (private.owns_shop(shop_id) or private.branch_owns_offer(id) or (select private.is_admin()));

create or replace function public.guard_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_app_admin_or_service() then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.reviewed_by := case when new.status = 'pending' then null else (select auth.uid()) end;
      new.reviewed_at := case when new.status = 'pending' then null else now() end;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.is_featured := false;
    new.reject_reason := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.created_by := (select auth.uid());
    -- A branch manager's offer is for their branch only (set_offer_branches links it).
    if not private.owns_shop(new.shop_id) then
      new.all_branches := false;
    end if;
    return new;
  end if;
  new.shop_id := old.shop_id;
  new.status := old.status;
  new.is_featured := old.is_featured;
  new.reject_reason := old.reject_reason;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.created_by := old.created_by;
  -- Which branches: only through set_offer_branches().
  if current_setting('iwillfly.offer_branches', true) is distinct from 'on' then
    new.all_branches := old.all_branches;
  end if;
  -- Any change customers would see goes back to review; pausing or resuming does not.
  if (new.title, new.product_name, new.description, new.original_price, new.offer_price,
      new.discount_label, new.image_keys, new.starts_on, new.ends_on, new.category_id)
     is distinct from
     (old.title, old.product_name, old.description, old.original_price, old.offer_price,
      old.discount_label, old.image_keys, old.starts_on, old.ends_on, old.category_id) then
    new.status := 'pending';
    new.is_featured := false;
    new.reject_reason := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

-- Live offers: also the offer's branches (an offer only for branches still waiting is not shown).
create or replace view public.live_offers
with (security_invoker = true) as
  select o.id, o.shop_id, o.category_id, o.title, o.product_name, o.description, o.original_price,
         o.offer_price, o.discount_label, o.image_keys, o.starts_on, o.ends_on, o.status, o.is_paused,
         o.is_featured, o.reject_reason, o.reviewed_by, o.reviewed_at, o.created_at, o.updated_at,
         o.all_branches
  from public.offers o
  where o.status = 'approved' and not o.is_paused and o.starts_on <= private.today_ist()
    and (o.ends_on is null or o.ends_on >= private.today_ist())
    and private.shop_is_live(o.shop_id)
    and (o.all_branches
         or exists (select 1 from public.offer_branches ob join public.branches b on b.id = ob.branch_id
                    where ob.offer_id = o.id and b.review_status = 'approved'));

-- True when the offer is shown at the branch.
create or replace function private.offer_at_branch(p_all boolean, o bigint, b bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_all or exists (select 1 from public.offer_branches ob where ob.offer_id = o and ob.branch_id = b);
$$;

-- Plan limits per branch ----------------------------------------------------------------------------

-- Offers that still count: not refused and not ended.
create or replace function private.brand_offer_count(v bigint, except_offer bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.offers o join public.shops s on s.id = o.shop_id
  where s.vendor_id = v and o.all_branches and o.status <> 'rejected'
    and (o.ends_on is null or o.ends_on >= private.today_ist())
    and o.id is distinct from except_offer;
$$;

create or replace function private.branch_offer_count(b bigint, except_offer bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.offers o join public.offer_branches ob on ob.offer_id = o.id
  where ob.branch_id = b and not o.all_branches and o.status <> 'rejected'
    and (o.ends_on is null or o.ends_on >= private.today_ist())
    and o.id is distinct from except_offer;
$$;

-- Kept for older callers: now the brand-wide offers.
create or replace function private.live_offer_count(v bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.brand_offer_count(v, null);
$$;

create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
  p public.plans;
  b bigint;
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
  if tg_table_name = 'offers' and p.max_live_offers is not null then
    if new.all_branches then
      if private.brand_offer_count(v, null) >= p.max_live_offers then
        raise exception 'Your % plan allows % live offer(s) for all branches. Upgrade your plan or end an offer first.',
          p.name, p.max_live_offers using errcode = 'P0001', hint = 'plan_limit';
      end if;
    else
      -- A branch manager's offer: their branch's own pool.
      b := private.my_branch_id();
      if b is not null and private.branch_offer_count(b, null) >= p.max_live_offers then
        raise exception 'Your % plan allows % live offer(s) per branch. End an offer first.',
          p.name, p.max_live_offers using errcode = 'P0001', hint = 'plan_limit';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Sets where an offer runs: every branch, or the listed branches of its shop. Branch managers can only
-- choose their own branch. Checks the plan's per-branch offer limit.
create or replace function public.set_offer_branches(p_offer_id bigint, p_all boolean, p_branch_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  p public.plans;
  mine bigint := private.my_branch_id();
  admin boolean := private.is_admin();
  ids bigint[] := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_branch_ids, '{}')) x
                   where x is not null);
  b record;
  counts boolean;
begin
  select * into o from public.offers where id = p_offer_id;
  if o.id is null then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  if not (admin or private.owns_shop(o.shop_id)) then
    -- Branch manager: own branch only, on an offer of their shop that is theirs (or brand new and unlinked).
    if mine is null or o.shop_id is distinct from private.my_branch_shop_id() or o.all_branches
       or exists (select 1 from public.offer_branches where offer_id = o.id and branch_id <> mine) then
      raise exception 'You can only change offers of your own branch' using errcode = 'insufficient_privilege';
    end if;
    p_all := false;
    ids := array[mine];
  end if;
  if not coalesce(p_all, false) and cardinality(ids) = 0 then
    raise exception 'Choose at least one branch' using errcode = '22023';
  end if;
  if not coalesce(p_all, false) and exists (
    select 1 from unnest(ids) x
    where not exists (select 1 from public.branches br where br.id = x and br.shop_id = o.shop_id)) then
    raise exception 'Choose branches of this shop' using errcode = '22023';
  end if;
  if exists (select 1 from public.branches br where br.id = any(ids) and br.review_status = 'rejected') then
    raise exception 'A chosen branch was not approved. Fix the branch first.' using errcode = '22023';
  end if;

  counts := o.status <> 'rejected' and (o.ends_on is null or o.ends_on >= private.today_ist());
  p := private.vendor_plan((select vendor_id from public.shops where id = o.shop_id));
  if counts and not admin and p.max_live_offers is not null then
    if coalesce(p_all, false) and not o.all_branches
       and private.brand_offer_count((select vendor_id from public.shops where id = o.shop_id), o.id)
           >= p.max_live_offers then
      raise exception 'Your % plan allows % live offer(s) for all branches. End one first or choose branches.',
        p.name, p.max_live_offers using errcode = 'P0001', hint = 'plan_limit';
    end if;
    if not coalesce(p_all, false) then
      for b in select br.id, br.name from public.branches br where br.id = any(ids) order by br.id loop
        if not exists (select 1 from public.offer_branches where offer_id = o.id and branch_id = b.id)
           and private.branch_offer_count(b.id, o.id) >= p.max_live_offers then
          raise exception '% already has % live offer(s), the most your % plan allows per branch.',
            b.name, p.max_live_offers, p.name using errcode = 'P0001', hint = 'plan_limit';
        end if;
      end loop;
    end if;
  end if;

  perform set_config('iwillfly.offer_branches', 'on', true);
  update public.offers set all_branches = coalesce(p_all, false) where id = o.id;
  perform set_config('iwillfly.offer_branches', 'off', true);
  delete from public.offer_branches where offer_id = o.id
    and (coalesce(p_all, false) or not (branch_id = any(ids)));
  if not coalesce(p_all, false) then
    insert into public.offer_branches (offer_id, branch_id)
    select o.id, x from unnest(ids) x on conflict do nothing;
  end if;
end;
$$;

-- Team: email, invite link and username logins ---------------------------------------------------

-- Who may add a member with this role and branch: the owner anyone; a branch manager staff for their branch.
create or replace function private.team_vendor_for(p_role public.staff_role, p_branch_id bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint := (select id from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked');
begin
  if v is not null then
    if p_branch_id is not null and not exists (
      select 1 from public.branches b join public.shops s on s.id = b.shop_id
      where b.id = p_branch_id and s.vendor_id = v) then
      raise exception 'Choose one of your branches' using errcode = '22023';
    end if;
    return v;
  end if;
  if p_role = 'staff' and p_branch_id is not null and p_branch_id = private.my_branch_id() then
    return (select s.vendor_id from public.vendor_staff s
            where s.user_id = (select auth.uid()) and s.removed_at is null and s.disabled_at is null);
  end if;
  raise exception 'Only the business owner can add team members' using errcode = 'insufficient_privilege';
end;
$$;

-- Checks a person can join business v (not an owner, not in another business).
create or replace function private.check_can_join(v bigint, target uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target = (select owner_id from public.vendors where id = v) then
    raise exception 'You already own this business' using errcode = '22023';
  end if;
  if exists (select 1 from public.vendors where owner_id = target) then
    raise exception 'That person runs their own business on IWILLFLY' using errcode = '22023';
  end if;
  if exists (select 1 from public.vendor_staff where user_id = target and removed_at is null and vendor_id <> v) then
    raise exception 'That person already works for another business' using errcode = '22023';
  end if;
end;
$$;

-- Adds the member (or brings them back) and tells them.
create or replace function private.join_team(v bigint, target uuid, p_role public.staff_role, p_branch_id bigint,
                                             p_login text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz text := (select business_name from public.vendors where id = v);
  branch_name text := (select name from public.branches where id = p_branch_id);
begin
  insert into public.vendor_staff (vendor_id, user_id, role, branch_id, login_name, added_by)
  values (v, target, p_role, p_branch_id, p_login, p_by)
  on conflict (vendor_id, user_id) do update
    set role = excluded.role, branch_id = excluded.branch_id, login_name = excluded.login_name,
        removed_at = null, disabled_at = null, added_by = excluded.added_by, added_at = now();
  insert into public.user_roles (user_id, role) values (target, 'vendor') on conflict do nothing;
  perform private.notify(target, 'staff', 'You joined ' || biz,
    'You were added as ' || case when p_branch_id is null then p_role::text
                                 else 'branch ' || p_role::text || ' of ' || branch_name end
      || '. Open the vendor area to get started.', '/vendor');
end;
$$;

revoke execute on function private.team_vendor_for(public.staff_role, bigint), private.check_can_join(bigint, uuid),
  private.join_team(bigint, uuid, public.staff_role, bigint, text, uuid) from public;
grant execute on function private.team_vendor_for(public.staff_role, bigint), private.check_can_join(bigint, uuid),
  private.join_team(bigint, uuid, public.staff_role, bigint, text, uuid) to authenticated;

drop function if exists public.add_vendor_staff(text, public.staff_role);
create or replace function public.add_vendor_staff(p_email text, p_role public.staff_role, p_branch_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v bigint := private.team_vendor_for(p_role, p_branch_id);
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'No IWILLFLY account uses that email. Ask them to sign in once, or send an invite link.'
      using errcode = 'P0002';
  end if;
  perform private.check_can_join(v, target);
  perform private.join_team(v, target, p_role, p_branch_id, null, (select auth.uid()));
  return jsonb_build_object('user_id', target, 'role', p_role, 'branch_id', p_branch_id);
end;
$$;

-- Owner: change a member's role and branch, or remove them (p_role null). A branch manager can remove
-- their branch's staff.
drop function if exists public.set_vendor_staff(uuid, public.staff_role);
create or replace function public.set_vendor_staff(p_user_id uuid, p_role public.staff_role,
                                                   p_branch_id bigint default null, p_keep_branch boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint := (select id from public.vendors where owner_id = (select auth.uid()) and status <> 'blocked');
  mine bigint := private.my_branch_id();
begin
  if v is null then
    if p_role is null and mine is not null and exists (
      select 1 from public.vendor_staff where user_id = p_user_id and branch_id = mine and role = 'staff'
        and removed_at is null) then
      update public.vendor_staff set removed_at = now() where user_id = p_user_id and removed_at is null;
      return;
    end if;
    raise exception 'Only the business owner can change the team' using errcode = 'insufficient_privilege';
  end if;
  update public.vendor_staff
    set role = coalesce(p_role, role),
        branch_id = case when p_role is null or p_keep_branch then branch_id else p_branch_id end,
        removed_at = case when p_role is null then now() end
    where vendor_id = v and user_id = p_user_id and removed_at is null;
  if not found then
    raise exception 'Not a member of your team' using errcode = 'P0002';
  end if;
end;
$$;

-- Owner (or branch manager for their branch staff) switches a username login off or on. The Worker also
-- blocks or unblocks the account's sign-in.
create or replace function public.set_branch_login_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_login(p_user_id) then
    raise exception 'You can only change your own team''s branch logins' using errcode = 'insufficient_privilege';
  end if;
  update public.vendor_staff set disabled_at = case when p_active then null else now() end
    where user_id = p_user_id and removed_at is null;
end;
$$;

-- True when the caller may change this username login's password or switch it off: the business owner,
-- or the branch manager of that branch when it is a staff login.
create or replace function private.can_manage_login(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vendor_staff s join public.vendors v on v.id = s.vendor_id
    where s.user_id = p_user_id and s.removed_at is null and s.login_name is not null
      and (v.owner_id = (select auth.uid())
           or (s.role = 'staff' and s.branch_id = private.my_branch_id())));
$$;

create or replace function public.can_manage_branch_login(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.can_manage_login(p_user_id) $$;

-- Before the Worker makes a username login: may the caller, and is the name free? Returns the business id.
create or replace function public.check_branch_login(p_branch_id bigint, p_username text, p_role public.staff_role)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint;
  u text := lower(btrim(coalesce(p_username, '')));
begin
  if p_branch_id is null then
    raise exception 'Choose a branch' using errcode = '22023';
  end if;
  v := private.team_vendor_for(p_role, p_branch_id);
  if u !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'Username: 3 to 30 letters, numbers, dots, dashes or underscores, starting with a letter or number'
      using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = u || '@branch.iwillfly.in') then
    raise exception 'That username is taken. Try another, for example with the area name.' using errcode = '23505';
  end if;
  return v;
end;
$$;

-- After the Worker made the account (its app_metadata, which only the server can set, names the business
-- and branch it was made for): add it to the team.
create or replace function public.attach_branch_login(p_user_id uuid, p_branch_id bigint, p_role public.staff_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint := private.team_vendor_for(p_role, p_branch_id);
  u auth.users;
begin
  select * into u from auth.users where id = p_user_id;
  if u.id is null or u.email not like '%@branch.iwillfly.in'
     or (u.raw_app_meta_data -> 'branch_login' ->> 'vendor_id') is distinct from v::text
     or (u.raw_app_meta_data -> 'branch_login' ->> 'branch_id') is distinct from p_branch_id::text then
    raise exception 'That login was not made for this branch' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_can_join(v, p_user_id);
  perform private.join_team(v, p_user_id, p_role, p_branch_id, split_part(u.email, '@', 1), (select auth.uid()));
end;
$$;

-- Invite links (sent on WhatsApp): open, sign in, join.
create table if not exists public.vendor_invites (
  id bigint generated always as identity primary key,
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  branch_id bigint references public.branches (id) on delete cascade,
  role public.staff_role not null default 'manager',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists vendor_invites_vendor_idx on public.vendor_invites (vendor_id, created_at desc);
create index if not exists vendor_invites_branch_idx on public.vendor_invites (branch_id);
create index if not exists vendor_invites_created_by_idx on public.vendor_invites (created_by);
create index if not exists vendor_invites_used_by_idx on public.vendor_invites (used_by);
alter table public.vendor_invites enable row level security;
drop policy if exists "vendor_invites: owner or branch manager read" on public.vendor_invites;
create policy "vendor_invites: owner or branch manager read" on public.vendor_invites
  for select to authenticated
  using ((select private.is_vendor_owner(vendor_id))
         or (branch_id is not null and branch_id = (select private.my_branch_id()))
         or (select private.is_support()));
grant select on public.vendor_invites to authenticated;
revoke insert, update, delete on public.vendor_invites from anon, authenticated;

create or replace function public.create_vendor_invite(p_role public.staff_role, p_branch_id bigint default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint := private.team_vendor_for(p_role, p_branch_id);
  t text;
begin
  if (select count(*) from public.vendor_invites where vendor_id = v and created_at > now() - interval '1 day') >= 50 then
    raise exception 'Too many invites today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.vendor_invites (vendor_id, branch_id, role, created_by)
  values (v, p_branch_id, p_role, (select auth.uid()))
  returning token into t;
  return t;
end;
$$;

create or replace function public.revoke_vendor_invite(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.vendor_invites i set revoked_at = now()
    where i.id = p_id and i.used_at is null and i.revoked_at is null
      and (private.is_vendor_owner(i.vendor_id) or (i.branch_id is not null and i.branch_id = private.my_branch_id()));
  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
end;
$$;

-- What an invite is for, for the join page. Works for any signed-in person who has the link.
create or replace function public.vendor_invite_info(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business_name', v.business_name, 'shop_name', s.name, 'branch_name', b.name, 'role', i.role,
    'state', case when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked'
                  when i.expires_at < now() then 'expired' when v.status = 'blocked' then 'revoked' else 'ok' end)
  from public.vendor_invites i
  join public.vendors v on v.id = i.vendor_id
  left join public.branches b on b.id = i.branch_id
  left join public.shops s on s.id = b.shop_id
  where i.token = p_token;
$$;

create or replace function public.accept_vendor_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.vendor_invites;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into i from public.vendor_invites where token = p_token for update;
  if i.id is null or i.revoked_at is not null or i.expires_at < now()
     or (select status from public.vendors where id = i.vendor_id) = 'blocked' then
    raise exception 'This invite link is no longer valid. Ask for a new one.' using errcode = 'P0002';
  end if;
  if i.used_at is not null then
    if i.used_by = uid then
      return jsonb_build_object('vendor_id', i.vendor_id);
    end if;
    raise exception 'This invite link was already used. Ask for a new one.' using errcode = 'P0002';
  end if;
  perform private.check_can_join(i.vendor_id, uid);
  perform private.join_team(i.vendor_id, uid, i.role, i.branch_id, null, i.created_by);
  update public.vendor_invites set used_by = uid, used_at = now() where id = i.id;
  return jsonb_build_object('vendor_id', i.vendor_id);
end;
$$;

-- The team with each member's branch and username login. Branch managers see their branch's team.
drop function if exists public.vendor_team();
create or replace function public.vendor_team()
returns table (user_id uuid, email text, full_name text, role text, added_at timestamptz, branch_id bigint,
               branch_name text, login_name text, disabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select v.owner_id, u.email::text, p.full_name, 'owner', v.created_at, null::bigint, null::text, null::text, false
  from public.vendors v join auth.users u on u.id = v.owner_id left join public.profiles p on p.id = v.owner_id
  where v.id = private.my_member_vendor_id()
  union all
  select s.user_id, case when s.login_name is null then u.email::text end, p.full_name, s.role::text, s.added_at,
         s.branch_id, b.name, s.login_name, s.disabled_at is not null
  from public.vendor_staff s join auth.users u on u.id = s.user_id left join public.profiles p on p.id = s.user_id
  left join public.branches b on b.id = s.branch_id
  where s.vendor_id = private.my_member_vendor_id() and s.removed_at is null
    and (private.my_member_branch_id() is null or s.branch_id = private.my_member_branch_id())
  order by 5;
$$;

drop function if exists public.admin_vendor_team(bigint);
create or replace function public.admin_vendor_team(p_vendor_id bigint)
returns table (user_id uuid, email text, full_name text, role text, added_at timestamptz, branch_id bigint,
               branch_name text, login_name text, disabled boolean)
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
  select s.user_id, u.email::text, p.full_name, s.role::text, s.added_at, s.branch_id, b.name, s.login_name,
         s.disabled_at is not null
  from public.vendor_staff s
  join auth.users u on u.id = s.user_id
  left join public.profiles p on p.id = s.user_id
  left join public.branches b on b.id = s.branch_id
  where s.vendor_id = p_vendor_id and s.removed_at is null
  order by s.added_at;
end;
$$;

-- The caller's business, role, and branch (for branch members).
create or replace function public.my_vendor()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(v) || jsonb_build_object(
    'my_role', case when v.owner_id = (select auth.uid()) then 'owner' else st.role::text end,
    'my_branch_id', st.branch_id,
    'my_branch_name', b.name,
    'my_branch_shop_id', b.shop_id,
    'my_login_name', st.login_name)
  from public.vendors v
  left join public.vendor_staff st on st.vendor_id = v.id and st.user_id = (select auth.uid())
    and st.removed_at is null and st.disabled_at is null
  left join public.branches b on b.id = st.branch_id
  where v.owner_id = (select auth.uid()) or st.user_id is not null
  order by (v.owner_id = (select auth.uid())) desc
  limit 1;
$$;

-- Admin: branches waiting for review ------------------------------------------------------------------

create or replace function public.admin_pending_branches()
returns table (branch_id bigint, branch_name text, address text, area text, lat double precision, lng double precision,
               phone text, created_at timestamptz, review_status text, review_note text, shop_id bigint,
               shop_name text, shop_slug text, vendor_id bigint, business_name text, branch_count int)
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
  select b.id, b.name, b.address, l.name, b.lat, b.lng, b.phone, b.created_at, b.review_status, b.review_note,
         s.id, s.name, s.slug, v.id, v.business_name,
         (select count(*)::int from public.branches x where x.shop_id = s.id and x.review_status = 'approved')
  from public.branches b
  join public.shops s on s.id = b.shop_id
  join public.vendors v on v.id = s.vendor_id
  left join public.locations l on l.id = b.location_id
  where b.review_status = 'pending'
  order by b.created_at;
end;
$$;

create or replace function public.review_branch(p_branch_id bigint, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
  update public.branches
    set review_status = case when p_approve then 'approved' else 'rejected' end,
        review_note = case when p_approve then null else left(nullif(btrim(p_note), ''), 300) end
    where id = p_branch_id;
  if not found then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Plans: included branches and a price per extra branch ----------------------------------------------

alter table public.plans
  add column if not exists included_branches int constraint plans_included_branches_check check (included_branches >= 1),
  add column if not exists extra_branch_price numeric(10,2) not null default 0
    constraint plans_extra_branch_price_check check (extra_branch_price >= 0);

-- Extra branches over what a plan includes (0 when the plan does not charge for them).
create or replace function private.extra_branches(v bigint, p public.plans)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.included_branches is null or p.extra_branch_price = 0 then 0
              else greatest(private.branch_count(v) - p.included_branches, 0) end;
$$;

create or replace function public.create_invoice(p_items jsonb, p_vendor_id bigint default null)
returns bigint
language plpgsql
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
  extra int;
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
      -- Branches over what the plan includes are charged on the same line.
      extra := private.extra_branches(v.id, pl);
      insert into public.invoice_items (invoice_id, plan_id, description, days, amount)
      values (inv, pl.id,
              pl.name || ' plan (' || pl.period_days || ' days)'
                || case when extra > 0 then ' + ' || extra || ' extra branch' || case when extra > 1 then 'es' else '' end
                        || ' × ₹' || trim(to_char(pl.extra_branch_price, 'FM999999990.00')) else '' end,
              pl.period_days, pl.price + extra * pl.extra_branch_price);
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

-- Billing page usage: brand-wide offers, branches and extra branches.
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
    'usage', jsonb_build_object(
      'shops', (select count(*) from public.shops where vendor_id = v),
      'live_offers', private.brand_offer_count(v, null),
      'branches', private.branch_count(v),
      'extra_branches', case when p.id is null then 0 else private.extra_branches(v, p) end,
      'busiest_branch_offers', coalesce((select max(private.branch_offer_count(b.id, null))
                                         from public.branches b join public.shops s on s.id = b.shop_id
                                         where s.vendor_id = v), 0)),
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

-- Customer search: branch links, and offers counted per branch -------------------------------------

drop function if exists public.search_shops(double precision, double precision, text, text, bigint, integer, integer);
create or replace function public.search_shops(
  p_lat double precision default null,
  p_lng double precision default null,
  p_category text default null,
  p_q text default null,
  p_mall_id bigint default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (shop_id bigint, name text, logo_key text, category_slug text, category_name text, category_icon text,
               branch_id bigint, branch_name text, address text, lat double precision, lng double precision,
               distance_km double precision, hours jsonb, holidays date[], temp_closed boolean, mall_id bigint,
               mall_name text, offer_count integer, top_offer text, featured boolean, shop_slug text,
               branch_slug text, branch_count integer)
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
         coalesce(o.cnt, 0)::int, o.top, (coalesce(o.featured, false) or s.is_featured),
         s.slug, b.slug,
         (select count(*)::int from public.branches x where x.shop_id = s.id)
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
    where lo.shop_id = s.id and private.offer_at_branch(lo.all_branches, lo.id, b.id)
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

drop function if exists public.search_offers(double precision, double precision, text, boolean, integer, integer);
create or replace function public.search_offers(
  p_lat double precision default null,
  p_lng double precision default null,
  p_category text default null,
  p_featured_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (offer_id bigint, title text, discount_label text, original_price numeric, offer_price numeric,
               image_key text, ends_on date, is_featured boolean, shop_id bigint, shop_name text,
               shop_logo_key text, category_slug text, category_name text, category_icon text,
               distance_km double precision, shop_slug text, branch_slug text, branch_name text)
language sql
stable
set search_path = ''
as $$
  with here as (
    select case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end as g
  )
  select lo.id, lo.title, lo.discount_label, lo.original_price, lo.offer_price, lo.image_keys[1], lo.ends_on,
         lo.is_featured, s.id, s.name, s.logo_key,
         coalesce(oc.slug, sc.slug), coalesce(oc.name, sc.name), coalesce(oc.icon, sc.icon),
         d.km, s.slug, d.slug, d.name
  from public.live_offers lo
  cross join here
  join public.shops s on s.id = lo.shop_id
  left join public.categories oc on oc.id = lo.category_id
  left join public.categories sc on sc.id = s.category_id
  -- the nearest branch that has the offer
  left join lateral (
    select extensions.st_distance(br.geo, here.g) / 1000 as km, br.slug, br.name
    from public.branches br
    where br.shop_id = s.id and private.offer_at_branch(lo.all_branches, lo.id, br.id)
    order by extensions.st_distance(br.geo, here.g) nulls last, br.id
    limit 1
  ) d on true
  where (p_category is null or oc.slug = p_category or (lo.category_id is null and sc.slug = p_category))
    and (not p_featured_only or lo.is_featured)
  order by d.km nulls last, lo.is_featured desc, lo.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

-- Grants (the functions above are called by signed-in users; the Worker uses the caller's token) ------

revoke execute on function
  public.set_offer_branches(bigint, boolean, bigint[]),
  public.add_vendor_staff(text, public.staff_role, bigint),
  public.set_vendor_staff(uuid, public.staff_role, bigint, boolean),
  public.set_branch_login_active(uuid, boolean),
  public.can_manage_branch_login(uuid),
  public.check_branch_login(bigint, text, public.staff_role),
  public.attach_branch_login(uuid, bigint, public.staff_role),
  public.create_vendor_invite(public.staff_role, bigint),
  public.revoke_vendor_invite(bigint),
  public.vendor_invite_info(text),
  public.accept_vendor_invite(text),
  public.vendor_team(),
  public.admin_vendor_team(bigint),
  public.my_vendor(),
  public.admin_pending_branches(),
  public.review_branch(bigint, boolean, text),
  public.create_invoice(jsonb, bigint),
  public.my_billing(),
  private.can_manage_login(uuid),
  private.branch_slug_base(text, text),
  private.unique_branch_slug(bigint, text, bigint),
  private.offer_at_branch(boolean, bigint, bigint),
  private.brand_offer_count(bigint, bigint),
  private.branch_offer_count(bigint, bigint),
  private.extra_branches(bigint, public.plans)
from public, anon;
grant execute on function
  public.set_offer_branches(bigint, boolean, bigint[]),
  public.add_vendor_staff(text, public.staff_role, bigint),
  public.set_vendor_staff(uuid, public.staff_role, bigint, boolean),
  public.set_branch_login_active(uuid, boolean),
  public.can_manage_branch_login(uuid),
  public.check_branch_login(bigint, text, public.staff_role),
  public.attach_branch_login(uuid, bigint, public.staff_role),
  public.create_vendor_invite(public.staff_role, bigint),
  public.revoke_vendor_invite(bigint),
  public.vendor_invite_info(text),
  public.accept_vendor_invite(text),
  public.vendor_team(),
  public.admin_vendor_team(bigint),
  public.my_vendor(),
  public.admin_pending_branches(),
  public.review_branch(bigint, boolean, text),
  public.create_invoice(jsonb, bigint),
  public.my_billing(),
  private.can_manage_login(uuid),
  private.branch_slug_base(text, text),
  private.unique_branch_slug(bigint, text, bigint),
  private.offer_at_branch(boolean, bigint, bigint),
  private.brand_offer_count(bigint, bigint),
  private.branch_offer_count(bigint, bigint),
  private.extra_branches(bigint, public.plans)
to authenticated;
grant execute on function public.search_shops(double precision, double precision, text, text, bigint, integer, integer),
  public.search_offers(double precision, double precision, text, boolean, integer, integer) to authenticated;
revoke execute on function public.search_shops(double precision, double precision, text, text, bigint, integer, integer),
  public.search_offers(double precision, double precision, text, boolean, integer, integer) from public, anon;
