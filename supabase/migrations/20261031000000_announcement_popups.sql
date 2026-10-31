-- Announcement pop-ups: admins and campaign managers set a pop-up (a big offer or a new reward) that
-- customers see over the app, one at a time, between its start and end times.
--
-- Customers never read the table directly: public.my_popup() picks the one pop-up to show to the caller
-- (their area, how often, which page) and public.popup_event() records seen / tapped / closed.

create table public.popups (
  id bigint generated always as identity primary key,
  -- 'picture' = a 4:5 poster on top; 'card' = blue header with an icon and up to 3 short points.
  style text not null default 'picture' check (style in ('picture', 'card')),
  image_key text,
  icon text not null default 'star' check (icon in ('star', 'gift', 'ticket', 'megaphone', 'sparkles')),
  tag text check (char_length(tag) <= 24),                                   -- "NEW REWARD"
  title text not null check (char_length(title) between 2 and 60),
  message text check (char_length(message) <= 200),
  bullets text[] not null default '{}'
    check (cardinality(bullets) <= 3 and char_length(array_to_string(bullets, '')) <= 180),
  button_text text check (char_length(button_text) <= 24),
  -- where the button goes ('page' = an app page path such as /scratch)
  link_kind text not null default 'none'
    check (link_kind in ('none', 'url', 'shop', 'offer', 'festival', 'mall', 'page')),
  link_target text check (char_length(link_target) <= 300),
  -- who sees it: everyone, or customers whose area is in / under one of location_ids
  audience text not null default 'all' check (audience in ('all', 'districts', 'areas')),
  location_ids bigint[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  -- once per customer, once a day (India date), or every visit (at most once an hour)
  frequency text not null default 'once' check (frequency in ('once', 'daily', 'visit')),
  show_on text not null default 'home' check (show_on in ('home', 'any')),
  add_to_inbox boolean not null default true,
  sort_order int not null default 0,
  is_active boolean not null default true,
  -- distinct customers
  seen_count int not null default 0,
  tapped_count int not null default 0,
  closed_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (link_kind = 'none' or link_target is not null),
  check (style = 'card' or image_key is not null),
  check (audience = 'all' or cardinality(location_ids) > 0)
);
create index popups_live_idx on public.popups (starts_at) where is_active;
create trigger popups_updated_at before update on public.popups
  for each row execute function public.set_updated_at();
-- Seen / tapped / closed counter bumps from customers are not admin changes, so they skip the audit log.
create trigger popups_audit after insert or update or delete on public.popups
  for each row when (current_setting('iwillfly.popup_event', true) is distinct from 'on')
  execute function private.audit_change();

-- One row per customer per pop-up.
create table public.popup_views (
  popup_id bigint not null references public.popups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times_seen int not null default 1,
  tapped_at timestamptz,
  closed_at timestamptz,
  primary key (popup_id, user_id)
);
create index popup_views_user_idx on public.popup_views (user_id);

alter table public.popups enable row level security;
alter table public.popup_views enable row level security;

create policy "popups: manager read" on public.popups
  for select to authenticated using ((select private.can_manage_campaigns()));
create policy "popups: manager insert" on public.popups
  for insert to authenticated with check ((select private.can_manage_campaigns()));
create policy "popups: manager update" on public.popups
  for update to authenticated
  using ((select private.can_manage_campaigns())) with check ((select private.can_manage_campaigns()));
create policy "popups: manager delete" on public.popups
  for delete to authenticated using ((select private.can_manage_campaigns()));
-- popup_views: no policies, so only the functions below touch it.

-- Counters only change through popup_event().
create or replace function public.guard_popup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.seen_count := 0;
    new.tapped_count := 0;
    new.closed_count := 0;
    new.created_by := (select auth.uid());
  elsif current_setting('iwillfly.popup_event', true) is distinct from 'on' then
    new.seen_count := old.seen_count;
    new.tapped_count := old.tapped_count;
    new.closed_count := old.closed_count;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
create trigger popups_guard before insert or update on public.popups
  for each row execute function public.guard_popup();

-- The in-app path a pop-up's button opens, or null (web links open in the browser instead).
create or replace function private.popup_path(k text, t text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when k = 'page' and t ~ '^/[a-z0-9/_?=&-]*$' then t
    when k = 'shop' and t ~ '^\d+$' then '/shop/' || t
    when k = 'mall' and t ~ '^\d+$' then '/mall/' || t
    when k = 'festival' then '/festival/' || t
    when k = 'offer' and t ~ '^\d+$' then
      (select '/shop/' || o.shop_id || '?offer=' || o.id from public.offers o where o.id = t::bigint)
  end
$$;

-- Whether location a is b or sits under b (area -> city -> district -> state).
create or replace function private.location_within(a bigint, b bigint[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select id, parent_id, 1 as depth from public.locations where id = a
    union all
    select l.id, l.parent_id, up.depth + 1 from public.locations l join up on l.id = up.parent_id
    where up.depth < 6
  )
  select exists (select 1 from up where up.id = any (b))
$$;

-- The one pop-up the signed-in customer should see now on this page ('home' or any other page), or no
-- row. p_location_id is the area they picked; without it their saved area is used.
create or replace function public.my_popup(p_location_id bigint default null, p_page text default 'home')
returns table (id bigint, style text, image_key text, icon text, tag text, title text, message text,
               bullets text[], button_text text, link_kind text, link_target text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  loc bigint;
begin
  if uid is null then
    return;
  end if;
  loc := coalesce(p_location_id, (select location_id from public.profiles where profiles.id = uid));
  return query
    select p.id, p.style, p.image_key, p.icon, p.tag, p.title, p.message, p.bullets, p.button_text,
           p.link_kind, p.link_target
    from public.popups p
    left join public.popup_views v on v.popup_id = p.id and v.user_id = uid
    where p.is_active
      and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now())
      and (p.show_on = 'any' or p_page = 'home')
      and (p.audience = 'all' or (loc is not null and private.location_within(loc, p.location_ids)))
      and (v.user_id is null
           or (p.frequency = 'daily'
               and (v.last_seen_at at time zone 'Asia/Kolkata')::date < private.today_ist())
           or (p.frequency = 'visit' and v.last_seen_at < now() - interval '1 hour'))
    order by p.sort_order, p.id desc
    limit 1;
end;
$$;

-- Records what the customer did with a pop-up: 'seen', 'tap' or 'close'. The first time a customer
-- sees a pop-up with add_to_inbox, it is also put in their Notifications (no push).
create or replace function public.popup_event(p_popup_id bigint, p_event text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  p public.popups;
  v public.popup_views;
  first_seen boolean := false;
begin
  if uid is null or p_event not in ('seen', 'tap', 'close') then
    return;
  end if;
  select * into p from public.popups where popups.id = p_popup_id;
  if not found then
    return;
  end if;
  select * into v from public.popup_views where popup_id = p.id and user_id = uid;
  perform set_config('iwillfly.popup_event', 'on', true);

  if p_event = 'seen' then
    if v.popup_id is null then
      insert into public.popup_views (popup_id, user_id) values (p.id, uid);
      update public.popups set seen_count = seen_count + 1 where popups.id = p.id;
      first_seen := true;
    elsif v.last_seen_at < now() - interval '1 minute' then
      update public.popup_views set last_seen_at = now(), times_seen = times_seen + 1
      where popup_id = p.id and user_id = uid;
    end if;
    if first_seen and p.add_to_inbox then
      insert into public.notifications (user_id, kind, title, body, link, push_status)
      values (uid, 'broadcast', left(p.title, 120), left(p.message, 300),
              private.popup_path(p.link_kind, p.link_target), 'skipped');
    end if;
  elsif v.popup_id is not null then
    if p_event = 'tap' and v.tapped_at is null then
      update public.popup_views set tapped_at = now() where popup_id = p.id and user_id = uid;
      update public.popups set tapped_count = tapped_count + 1 where popups.id = p.id;
    elsif p_event = 'close' and v.closed_at is null then
      update public.popup_views set closed_at = now() where popup_id = p.id and user_id = uid;
      update public.popups set closed_count = closed_count + 1 where popups.id = p.id;
    end if;
  end if;

  perform set_config('iwillfly.popup_event', 'off', true);
end;
$$;

revoke execute on function private.popup_path(text, text), private.location_within(bigint, bigint[]),
  public.my_popup(bigint, text), public.popup_event(bigint, text) from public, anon;
grant execute on function public.my_popup(bigint, text), public.popup_event(bigint, text) to authenticated;
