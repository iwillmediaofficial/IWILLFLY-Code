-- IWILLFLY Phase 3 (part 2): guards, RLS policies, alerts and RPCs for festivals, ads, placement
-- requests, notifications, web push and analytics.
--
-- "Managers" are admins and campaign managers (private.can_manage_campaigns from Phase 2).

-- Helpers -------------------------------------------------------------------------------------------

create or replace function private.owns_offer(o bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.owns_shop((select shop_id from public.offers where id = o)) $$;

create or replace function private.can_see_own_offer(o bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.can_see_own_shop((select shop_id from public.offers where id = o)) $$;

-- Puts a message in a user's inbox (and queues it for push).
create or replace function private.notify(uid uuid, k text, t text, b text, l text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select uid, k, left(t, 120), left(b, 300), l where uid is not null;
$$;

create or replace function private.vendor_owner(v bigint)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select owner_id from public.vendors where id = v $$;

revoke execute on function private.owns_offer(bigint), private.can_see_own_offer(bigint),
  private.notify(uuid, text, text, text, text), private.vendor_owner(bigint) from public;
grant execute on function private.owns_offer(bigint), private.can_see_own_offer(bigint) to anon, authenticated;

-- Festivals ---------------------------------------------------------------------------------------

create policy "festivals: public read active" on public.festivals
  for select to anon, authenticated using (is_active or (select private.can_manage_campaigns()));
create policy "festivals: manager insert" on public.festivals
  for insert to authenticated with check ((select private.can_manage_campaigns()));
create policy "festivals: manager update" on public.festivals
  for update to authenticated
  using ((select private.can_manage_campaigns())) with check ((select private.can_manage_campaigns()));
create policy "festivals: manager delete" on public.festivals
  for delete to authenticated using ((select private.can_manage_campaigns()));

-- Vendors submit their own offers while the festival takes submissions; only managers review.
create or replace function public.guard_festival_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_campaign_manager_or_service() then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.reviewed_at := case when new.status = 'pending' then null else now() end;
      new.reviewed_by := case when new.status = 'pending' then null else (select auth.uid()) end;
    end if;
    return new;
  end if;
  new.status := 'pending';
  new.note := null;
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.submitted_at := now();
  return new;
end;
$$;
create trigger festival_offers_guard before insert or update on public.festival_offers
  for each row execute function public.guard_festival_offer();

create policy "festival_offers: approved, own or manager read" on public.festival_offers
  for select to anon, authenticated
  using (status = 'approved' or (select private.can_see_own_offer(offer_id)) or (select private.can_manage_campaigns()));
create policy "festival_offers: vendor submit or manager" on public.festival_offers
  for insert to authenticated
  with check (
    (select private.can_manage_campaigns())
    or ((select private.owns_offer(offer_id))
        and exists (select 1 from public.festivals f
                    where f.id = festival_id and f.is_active
                      and coalesce(f.submissions_close_on, f.ends_on) >= private.today_ist()))
  );
create policy "festival_offers: manager review" on public.festival_offers
  for update to authenticated
  using ((select private.can_manage_campaigns())) with check ((select private.can_manage_campaigns()));
create policy "festival_offers: vendor withdraw or manager" on public.festival_offers
  for delete to authenticated
  using ((select private.owns_offer(offer_id)) or (select private.can_manage_campaigns()));

-- Ads -----------------------------------------------------------------------------------------------

create policy "ads: public read running" on public.ads
  for select to anon, authenticated
  using (
    (is_active and starts_on <= private.today_ist() and (ends_on is null or ends_on >= private.today_ist()))
    or (select private.can_manage_campaigns())
  );
create policy "ads: manager insert" on public.ads
  for insert to authenticated with check ((select private.can_manage_campaigns()));
create policy "ads: manager update" on public.ads
  for update to authenticated
  using ((select private.can_manage_campaigns())) with check ((select private.can_manage_campaigns()));
create policy "ads: manager delete" on public.ads
  for delete to authenticated using ((select private.can_manage_campaigns()));

-- Placement requests ----------------------------------------------------------------------------

-- A vendor can file a request and cancel it while pending; a manager decides. Approving a featured
-- offer request features the offer right away.
create or replace function public.guard_placement_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_campaign_manager_or_service() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.decided_at := now();
      new.decided_by := (select auth.uid());
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.admin_note := null;
    new.decided_at := null;
    new.decided_by := null;
    return new;
  end if;
  if not (old.status = 'pending' and new.status = 'cancelled') then
    raise exception 'Only a pending request can be cancelled' using errcode = 'insufficient_privilege';
  end if;
  new := old;
  new.status := 'cancelled';
  new.decided_at := now();
  new.decided_by := (select auth.uid());
  return new;
end;
$$;
create trigger placement_requests_guard before insert or update on public.placement_requests
  for each row execute function public.guard_placement_request();

create policy "placement_requests: own or manager read" on public.placement_requests
  for select to authenticated
  using (vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()));
create policy "placement_requests: vendor insert" on public.placement_requests
  for insert to authenticated
  with check (
    vendor_id = (select private.my_vendor_id())
    and (select private.vendor_is_live(vendor_id))
    and (offer_id is null or (select private.owns_offer(offer_id)))
    and (shop_id is null or (select private.owns_shop(shop_id)))
  );
create policy "placement_requests: vendor cancel or manager decide" on public.placement_requests
  for update to authenticated
  using (vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()))
  with check (vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()));

-- Notifications and push --------------------------------------------------------------------------

create policy "broadcasts: manager read" on public.broadcasts
  for select to authenticated using ((select private.can_manage_campaigns()));

create policy "notifications: own read" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: own mark read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: own delete" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- Users may only mark their messages read or unread.
create or replace function public.guard_notification()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  read_at timestamptz := new.read_at;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new := old;
  new.read_at := read_at;
  return new;
end;
$$;
create trigger notifications_guard before update on public.notifications
  for each row execute function public.guard_notification();

create policy "push_subscriptions: own read" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions: own delete" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Analytics -------------------------------------------------------------------------------------

create policy "offer_stats_daily: own shop or manager read" on public.offer_stats_daily
  for select to authenticated
  using ((select private.can_see_own_shop(shop_id)) or (select private.can_manage_campaigns()));

create policy "offer_history: own read" on public.offer_history
  for select to authenticated using (user_id = (select auth.uid()));
create policy "offer_history: own delete" on public.offer_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- Adds to today's counter row for a shop (offer_id null) or one of its offers.
create or replace function private.bump_stat(p_shop bigint, p_offer bigint, p_event text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.offer_stats_daily as s (day, shop_id, offer_id, views, clicks, saves, whatsapp, calls, directions)
  values (private.today_ist(), p_shop, p_offer,
          (p_event = 'view')::int, (p_event = 'click')::int, (p_event = 'save')::int,
          (p_event = 'whatsapp')::int, (p_event = 'call')::int, (p_event = 'directions')::int)
  on conflict (day, shop_id, offer_id) do update set
    views = s.views + excluded.views,
    clicks = s.clicks + excluded.clicks,
    saves = s.saves + excluded.saves,
    whatsapp = s.whatsapp + excluded.whatsapp,
    calls = s.calls + excluded.calls,
    directions = s.directions + excluded.directions;
end;
$$;
revoke execute on function private.bump_stat(bigint, bigint, text) from public, anon, authenticated;

-- Saves are counted by the database itself, so they always match the saved tables.
create or replace function public.count_offer_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bump_stat((select shop_id from public.offers where id = new.offer_id), new.offer_id, 'save');
  return null;
end;
$$;
create trigger saved_offers_count after insert on public.saved_offers
  for each row execute function public.count_offer_save();

create or replace function public.count_shop_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bump_stat(new.shop_id, null, 'save');
  return null;
end;
$$;
create trigger saved_shops_count after insert on public.saved_shops
  for each row execute function public.count_shop_save();

-- Alerts ------------------------------------------------------------------------------------------

create or replace function public.alert_offer_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform private.notify(
      private.vendor_owner((select vendor_id from public.shops where id = new.shop_id)),
      'offer_review',
      case when new.status = 'approved' then 'Offer approved: ' else 'Offer not approved: ' end || new.title,
      case when new.status = 'approved' then 'It is now visible to customers.'
           else coalesce(new.reject_reason, 'Open the offer to see what to change.') end,
      '/vendor/offers/' || new.id);
  end if;
  return null;
end;
$$;
create trigger offers_alert_review after update of status on public.offers
  for each row execute function public.alert_offer_review();

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
      case when new.status = 'approved' then 'Your business is approved' else 'Your business account is blocked' end,
      case when new.status = 'approved' then 'Your shops and approved offers are now live on IWILLFLY.'
           else coalesce(new.admin_note, 'Contact IWILLFLY support for details.') end,
      '/vendor');
  end if;
  return null;
end;
$$;
create trigger vendors_alert_review after update of status on public.vendors
  for each row execute function public.alert_vendor_review();

create or replace function public.alert_new_winner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.won and new.vendor_id is not null then
    perform private.notify(
      private.vendor_owner(new.vendor_id), 'new_winner',
      'New Scratch & Win winner',
      'Someone won ' || coalesce((select name from public.scratch_prizes where id = new.prize_id), 'a prize')
        || '. They will show a claim code at your shop.',
      '/vendor/scratch');
  end if;
  return null;
end;
$$;
create trigger scratch_plays_alert_winner after insert on public.scratch_plays
  for each row execute function public.alert_new_winner();

create or replace function public.alert_festival_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform private.notify(
      private.vendor_owner((select s.vendor_id from public.offers o join public.shops s on s.id = o.shop_id
                            where o.id = new.offer_id)),
      'festival_review',
      (select case when new.status = 'approved' then 'Added to ' else 'Not added to ' end || f.name
       from public.festivals f where f.id = new.festival_id),
      coalesce(new.note, (select title from public.offers where id = new.offer_id)),
      '/vendor/festivals');
  end if;
  return null;
end;
$$;
create trigger festival_offers_alert_review after update of status on public.festival_offers
  for each row execute function public.alert_festival_review();

create or replace function public.apply_placement_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if new.status = 'approved' and new.kind = 'featured_offer' then
      update public.offers set is_featured = true where id = new.offer_id;
    end if;
    perform private.notify(
      private.vendor_owner(new.vendor_id), 'placement_review',
      case when new.status = 'approved' then 'Placement request approved' else 'Placement request declined' end,
      coalesce(new.admin_note, replace(new.kind::text, '_', ' ')),
      '/vendor/promote');
  end if;
  return null;
end;
$$;
create trigger placement_requests_apply after update of status on public.placement_requests
  for each row execute function public.apply_placement_decision();

revoke execute on function public.guard_festival_offer(), public.guard_placement_request(),
  public.guard_notification(), public.count_offer_save(), public.count_shop_save(),
  public.alert_offer_review(), public.alert_vendor_review(), public.alert_new_winner(),
  public.alert_festival_review(), public.apply_placement_decision() from public, anon, authenticated;

-- RPCs ----------------------------------------------------------------------------------------------

-- Counts a customer action on a live shop or offer. Views of an offer also go into the signed-in
-- customer's "Recently viewed". The app sends each view at most once per visit.
create or replace function public.track_event(p_event text, p_shop_id bigint, p_offer_id bigint default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_event not in ('view', 'click', 'whatsapp', 'call', 'directions') then
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  if not private.shop_is_live(p_shop_id) then
    return;
  end if;
  if p_offer_id is not null
     and not exists (select 1 from public.live_offers where id = p_offer_id and shop_id = p_shop_id) then
    return;
  end if;
  perform private.bump_stat(p_shop_id, p_offer_id, p_event);
  if p_event = 'view' and p_offer_id is not null and (select auth.uid()) is not null then
    insert into public.offer_history (user_id, offer_id) values ((select auth.uid()), p_offer_id)
    on conflict (user_id, offer_id) do update set viewed_at = now();
  end if;
end;
$$;

-- The signed-in customer's recently viewed offers that are still live, newest first.
create or replace function public.my_offer_history(p_limit int default 30)
returns table (
  offer_id bigint, title text, discount_label text, original_price numeric, offer_price numeric,
  image_key text, ends_on date, shop_id bigint, shop_name text, shop_logo_key text, viewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.title, o.discount_label, o.original_price, o.offer_price, o.image_keys[1], o.ends_on,
    s.id, s.name, s.logo_key, h.viewed_at
  from public.offer_history h
  join public.live_offers o on o.id = h.offer_id
  join public.shops s on s.id = o.shop_id
  where h.user_id = (select auth.uid())
  order by h.viewed_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Approved, live offers of a festival.
create or replace function public.festival_offers_live(p_festival_id bigint)
returns table (
  offer_id bigint, title text, discount_label text, original_price numeric, offer_price numeric,
  image_key text, ends_on date, is_featured boolean, shop_id bigint, shop_name text, shop_logo_key text,
  category_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.title, o.discount_label, o.original_price, o.offer_price, o.image_keys[1], o.ends_on,
    o.is_featured, s.id, s.name, s.logo_key, c.name
  from public.festival_offers fo
  join public.festivals f on f.id = fo.festival_id and f.is_active
  join public.live_offers o on o.id = fo.offer_id
  join public.shops s on s.id = o.shop_id
  left join public.categories c on c.id = coalesce(o.category_id, s.category_id)
  where fo.festival_id = p_festival_id and fo.status = 'approved'
  order by o.is_featured desc, fo.reviewed_at desc nulls last
  limit 200;
$$;

-- Who a broadcast reaches.
create or replace function private.broadcast_targets(p_audience text, p_location_id bigint, p_category_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- customers: everyone who is not a vendor owner, matched by their chosen area and what they saved
  select p.id from public.profiles p
  where p_audience in ('everyone', 'customers')
    and not exists (select 1 from public.vendors v where v.owner_id = p.id)
    and (p_location_id is null or coalesce(private.location_within(p.location_id, p_location_id), false))
    and (p_category_id is null
         or exists (select 1 from public.saved_offers so join public.offers o on o.id = so.offer_id
                    left join public.shops s on s.id = o.shop_id
                    where so.user_id = p.id and p_category_id in (o.category_id, s.category_id))
         or exists (select 1 from public.saved_shops ss join public.shops s on s.id = ss.shop_id
                    where ss.user_id = p.id and s.category_id = p_category_id))
  union
  -- vendors: approved businesses with a branch in the area or a shop in the category
  select v.owner_id from public.vendors v
  where p_audience in ('everyone', 'vendors') and v.status = 'approved'
    and (p_location_id is null
         or exists (select 1 from public.shops s join public.branches b on b.shop_id = s.id
                    where s.vendor_id = v.id and coalesce(private.location_within(b.location_id, p_location_id), false)))
    and (p_category_id is null
         or exists (select 1 from public.shops s where s.vendor_id = v.id and s.category_id = p_category_id));
$$;
revoke execute on function private.broadcast_targets(text, bigint, bigint) from public, anon, authenticated;

create or replace function public.broadcast_audience_size(p_audience text, p_location_id bigint default null,
                                                          p_category_id bigint default null)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_campaigns() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (select count(*) from private.broadcast_targets(p_audience, p_location_id, p_category_id));
end;
$$;

create or replace function public.send_broadcast(p_title text, p_body text, p_link text, p_audience text,
                                                 p_location_id bigint default null, p_category_id bigint default null,
                                                 p_push boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.broadcasts;
  n int;
begin
  if not private.can_manage_campaigns() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_link is not null and p_link !~ '^/' then
    raise exception 'Links must be app paths starting with /' using errcode = '22023';
  end if;
  insert into public.broadcasts (title, body, link, audience, location_id, category_id, with_push, created_by)
  values (p_title, p_body, p_link, p_audience, p_location_id, p_category_id, p_push, (select auth.uid()))
  returning * into b;
  insert into public.notifications (user_id, kind, title, body, link, broadcast_id, push_status)
  select t, 'broadcast', b.title, b.body, b.link, b.id,
    case when p_push then 'pending' else 'skipped' end::public.push_status
  from private.broadcast_targets(p_audience, p_location_id, p_category_id) t;
  get diagnostics n = row_count;
  update public.broadcasts set recipients = n where id = b.id;
  return jsonb_build_object('broadcast_id', b.id, 'recipients', n);
end;
$$;

-- Registers (or moves to the signed-in user) this browser's push subscription.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text,
                                                         p_user_agent text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

-- For the Worker (service role): hands out pending pushes, at most p_max browser deliveries, and marks
-- them sent. Messages for people with no subscribed browser, or older than a day, are skipped.
create or replace function public.push_queue(p_max int default 40)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  out jsonb := '[]'::jsonb;
  used int := 0;
  n record;
  subs jsonb;
  k int;
begin
  update public.notifications set push_status = 'skipped'
  where push_status = 'pending'
    and (created_at < now() - interval '1 day'
         or not exists (select 1 from public.push_subscriptions ps where ps.user_id = notifications.user_id));

  for n in
    select id, user_id, title, body, link from public.notifications
    where push_status = 'pending' order by id limit greatest(p_max, 1)
    for update skip locked
  loop
    select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), count(*)
      into subs, k
    from public.push_subscriptions ps where ps.user_id = n.user_id;
    exit when used > 0 and used + k > p_max;
    update public.notifications set push_status = 'sent' where id = n.id;
    out := out || jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link,
                                     'subscriptions', subs);
    used := used + k;
  end loop;
  return out;
end;
$$;

-- Vendor dashboard: the caller's shops between two dates (at most 92 days).
create or replace function public.vendor_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint := (select id from public.vendors where owner_id = (select auth.uid()));
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

-- Admin dashboard: everything between two dates (at most 92 days).
create or replace function public.admin_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d_from date := greatest(p_from, p_to - 91);
begin
  if not private.can_manage_campaigns() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return (
    with s as (select * from public.offer_stats_daily where day between d_from and p_to),
    plays as (
      select (played_at at time zone 'Asia/Kolkata')::date as day, won, claim_status
      from public.scratch_plays
      where (played_at at time zone 'Asia/Kolkata')::date between d_from and p_to
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
      'top_offers', coalesce((select jsonb_agg(x) from (
                 select s.offer_id, o.title, sh.name as shop_name, sum(s.views)::int as views,
                   sum(s.clicks)::int as clicks, sum(s.whatsapp)::int as whatsapp
                 from s join public.offers o on o.id = s.offer_id join public.shops sh on sh.id = s.shop_id
                 group by s.offer_id, o.title, sh.name
                 order by sum(s.views) + sum(s.clicks) desc limit 10) x), '[]'::jsonb),
      'top_shops', coalesce((select jsonb_agg(x) from (
                 select s.shop_id, sh.name, sum(s.views)::int as views, sum(s.whatsapp)::int as whatsapp,
                   sum(s.calls)::int as calls, sum(s.saves)::int as saves
                 from s join public.shops sh on sh.id = s.shop_id
                 group by s.shop_id, sh.name
                 order by sum(s.views) + sum(s.whatsapp) + sum(s.calls) desc limit 10) x), '[]'::jsonb),
      'scratch_daily', coalesce((select jsonb_agg(x order by x.day) from (
                 select day, count(*)::int as plays, count(*) filter (where won)::int as wins,
                   count(*) filter (where claim_status = 'claimed')::int as claims
                 from plays group by day) x), '[]'::jsonb),
      'new_users', coalesce((select jsonb_agg(x order by x.day) from (
                 select (created_at at time zone 'Asia/Kolkata')::date as day, count(*)::int as users
                 from public.profiles
                 where (created_at at time zone 'Asia/Kolkata')::date between d_from and p_to
                 group by 1) x), '[]'::jsonb)
    )
  );
end;
$$;

-- Housekeeping, run daily by pg_cron: old inbox messages and history go after 90 days.
create or replace function public.cleanup_engagement()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.notifications where created_at < now() - interval '90 days';
  delete from public.offer_history where viewed_at < now() - interval '90 days';
$$;

revoke execute on function public.track_event(text, bigint, bigint), public.my_offer_history(int),
  public.festival_offers_live(bigint), public.broadcast_audience_size(text, bigint, bigint),
  public.send_broadcast(text, text, text, text, bigint, bigint, boolean),
  public.save_push_subscription(text, text, text, text), public.push_queue(int),
  public.vendor_analytics(date, date), public.admin_analytics(date, date), public.cleanup_engagement()
  from public, anon, authenticated;
grant execute on function public.track_event(text, bigint, bigint), public.festival_offers_live(bigint)
  to anon, authenticated;
grant execute on function public.my_offer_history(int), public.broadcast_audience_size(text, bigint, bigint),
  public.send_broadcast(text, text, text, text, bigint, bigint, boolean),
  public.save_push_subscription(text, text, text, text), public.vendor_analytics(date, date),
  public.admin_analytics(date, date) to authenticated;
grant execute on function public.push_queue(int) to service_role;
