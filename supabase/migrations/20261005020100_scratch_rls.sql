-- IWILLFLY Phase 2 (part 2): helpers, guards, RLS policies and RPCs for Scratch & Win.
--
-- Customers never write scratch tables directly: play_scratch() picks the result and takes the prize out
-- of stock in the same transaction, so stock given out always equals prizes won. Vendors verify a winner's
-- claim code with claim_prize(). Admins and campaign managers run campaigns.

-- Helpers -------------------------------------------------------------------------------------------

create or replace function private.can_manage_campaigns()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_admin() or private.has_role('campaign_manager') $$;

-- Direct database sessions (migrations, cron, service role) count as managers.
create or replace function private.is_campaign_manager_or_service()
returns boolean
language sql
stable
set search_path = ''
as $$ select current_user not in ('anon', 'authenticated') or (select private.can_manage_campaigns()) $$;

-- True when location `child` is `ancestor` or sits anywhere below it.
create or replace function private.location_within(child bigint, ancestor bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select id, parent_id from public.locations where id = child
    union all
    select l.id, l.parent_id from public.locations l join up on l.id = up.parent_id
  )
  select exists (select 1 from up where id = ancestor);
$$;

create or replace function private.joined_campaign(c bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_vendors cv
    where cv.campaign_id = c and cv.vendor_id = (select private.my_vendor_id())
  );
$$;

-- "Anjali Menon" -> "Anjali M." so vendors can greet a winner without seeing their full details.
create or replace function private.masked_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select split_part(btrim(full_name), ' ', 1)
            || case when btrim(full_name) like '% %'
                    then ' ' || upper(left(split_part(btrim(full_name), ' ', -1), 1)) || '.' else '' end
     from public.profiles where id = uid and coalesce(btrim(full_name), '') <> ''),
    'Customer');
$$;

revoke execute on function private.can_manage_campaigns(), private.location_within(bigint, bigint),
  private.joined_campaign(bigint), private.masked_name(uuid) from public;
grant execute on function private.can_manage_campaigns(), private.is_campaign_manager_or_service(),
  private.location_within(bigint, bigint), private.joined_campaign(bigint) to anon, authenticated;

-- Guards ----------------------------------------------------------------------------------------------

create or replace function public.guard_scratch_campaign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
create trigger scratch_campaigns_guard before insert or update on public.scratch_campaigns
  for each row execute function public.guard_scratch_campaign();

-- Stock follows quantity: raising quantity by 10 adds 10 to remaining. Vendors can manage the stock and
-- details of the prizes they sponsor, but only a manager switches a prize on or sets its chance of winning.
create or replace function public.guard_scratch_prize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  manager boolean := private.is_campaign_manager_or_service();
begin
  if tg_op = 'INSERT' then
    new.remaining := new.quantity;
    if not manager then
      new.is_active := false;
      new.probability := 0;
    end if;
    return new;
  end if;
  new.campaign_id := old.campaign_id;
  if new.remaining is not distinct from old.remaining or not manager then
    new.remaining := old.remaining + (new.quantity - old.quantity);
  end if;
  if new.remaining < 0 then
    raise exception 'Quantity cannot go below the % prizes already won', old.quantity - old.remaining
      using errcode = 'check_violation';
  end if;
  if not manager then
    new.sponsor_vendor_id := old.sponsor_vendor_id;
    new.is_active := old.is_active;
    new.probability := old.probability;
  end if;
  return new;
end;
$$;
create trigger scratch_prizes_guard before insert or update on public.scratch_prizes
  for each row execute function public.guard_scratch_prize();

-- Managers may only flag plays for fraud; results and claims change through the RPCs below.
create or replace function public.guard_scratch_play()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if (new.campaign_id, new.customer_id, new.play_date, new.played_at, new.prize_id, new.vendor_id, new.won,
      new.claim_code, new.claim_status, new.expires_at, new.claimed_at, new.claimed_by)
     is distinct from
     (old.campaign_id, old.customer_id, old.play_date, old.played_at, old.prize_id, old.vendor_id, old.won,
      old.claim_code, old.claim_status, old.expires_at, old.claimed_at, old.claimed_by) then
    raise exception 'Only the fraud flag and note can be changed here' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger scratch_plays_guard before update on public.scratch_plays
  for each row execute function public.guard_scratch_play();

revoke execute on function public.guard_scratch_campaign(), public.guard_scratch_prize(),
  public.guard_scratch_play() from public, anon, authenticated;

-- Policies ----------------------------------------------------------------------------------------------

create policy "scratch_campaigns: public read active" on public.scratch_campaigns
  for select to anon, authenticated
  using (is_active or (select private.can_manage_campaigns()) or (select private.joined_campaign(id)));
create policy "scratch_campaigns: manager insert" on public.scratch_campaigns
  for insert to authenticated with check ((select private.can_manage_campaigns()));
create policy "scratch_campaigns: manager update" on public.scratch_campaigns
  for update to authenticated
  using ((select private.can_manage_campaigns())) with check ((select private.can_manage_campaigns()));
create policy "scratch_campaigns: manager delete" on public.scratch_campaigns
  for delete to authenticated using ((select private.can_manage_campaigns()));

create policy "campaign_vendors: own or manager read" on public.campaign_vendors
  for select to authenticated
  using (vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()));
-- An approved vendor joins an active campaign; managers can add any vendor.
create policy "campaign_vendors: vendor join or manager" on public.campaign_vendors
  for insert to authenticated
  with check (
    (select private.can_manage_campaigns())
    or (vendor_id = (select private.my_vendor_id())
        and (select private.vendor_is_live(vendor_id))
        and exists (select 1 from public.scratch_campaigns c where c.id = campaign_id and c.is_active))
  );
create policy "campaign_vendors: vendor leave or manager" on public.campaign_vendors
  for delete to authenticated
  using (vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()));

create policy "scratch_prizes: public read active" on public.scratch_prizes
  for select to anon, authenticated
  using (
    (is_active and exists (select 1 from public.scratch_campaigns c where c.id = campaign_id and c.is_active))
    or sponsor_vendor_id = (select private.my_vendor_id())
    or (select private.can_manage_campaigns())
  );
create policy "scratch_prizes: sponsor or manager insert" on public.scratch_prizes
  for insert to authenticated
  with check (
    (select private.can_manage_campaigns())
    or (sponsor_vendor_id = (select private.my_vendor_id()) and (select private.joined_campaign(campaign_id)))
  );
create policy "scratch_prizes: sponsor or manager update" on public.scratch_prizes
  for update to authenticated
  using (sponsor_vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()))
  with check (sponsor_vendor_id = (select private.my_vendor_id()) or (select private.can_manage_campaigns()));
-- Only prizes nobody has won can be deleted (the foreign key on scratch_plays enforces that).
create policy "scratch_prizes: manager delete" on public.scratch_prizes
  for delete to authenticated using ((select private.can_manage_campaigns()));

create policy "scratch_plays: own or manager read" on public.scratch_plays
  for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.can_manage_campaigns()));
create policy "scratch_plays: manager flag" on public.scratch_plays
  for update to authenticated
  using ((select private.can_manage_campaigns())) with check ((select private.can_manage_campaigns()));

-- RPCs --------------------------------------------------------------------------------------------------

-- Is the campaign running right now (India date and time)?
create or replace function private.campaign_open_now(c public.scratch_campaigns)
returns boolean
language sql
stable
set search_path = ''
as $$
  select c.is_active
    and c.starts_on <= private.today_ist()
    and (c.ends_on is null or c.ends_on >= private.today_ist())
    and (now() at time zone 'Asia/Kolkata')::time between c.active_from and c.active_to;
$$;

create or replace function private.customer_eligible(c public.scratch_campaigns, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.location_id is null
    or coalesce(private.location_within((select location_id from public.profiles where id = uid), c.location_id),
                false);
$$;
grant execute on function private.campaign_open_now(public.scratch_campaigns),
  private.customer_eligible(public.scratch_campaigns, uuid) to anon, authenticated;

-- One play's result as the customer sees it. An unclaimed prize past its expiry reads as expired even
-- before the hourly clean-up job marks it.
create or replace function private.play_json(p public.scratch_plays)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'play_id', p.id,
    'campaign_id', p.campaign_id,
    'campaign_name', c.name,
    'played_at', p.played_at,
    'won', p.won,
    'prize', case when p.won then jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'description', pr.description, 'image_key', pr.image_key) end,
    'sponsor', case when v.id is not null then jsonb_build_object('vendor_id', v.id, 'name', v.business_name) end,
    'claim_code', p.claim_code,
    'claim_status', case when p.claim_status = 'unclaimed' and p.expires_at < now() then 'expired'
                         else p.claim_status::text end,
    'expires_at', p.expires_at,
    'claimed_at', p.claimed_at
  )
  from public.scratch_campaigns c
  left join public.scratch_prizes pr on pr.id = p.prize_id
  left join public.vendors v on v.id = p.vendor_id
  where c.id = p.campaign_id;
$$;
revoke execute on function private.play_json(public.scratch_plays) from public, anon, authenticated;

create or replace function private.new_claim_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- no 0/O or 1/I so codes read cleanly aloud
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid());
  code text := '';
  i int;
begin
  -- bytes 6 and 8 of a v4 uuid carry version bits; use the fully random ones
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;
revoke execute on function private.new_claim_code() from public, anon, authenticated;

-- Today's campaigns for the home screen and scratch page, with the caller's play if they already had one.
create or replace function public.scratch_today()
returns table (
  id bigint, name text, description text, banner_key text, starts_on date, ends_on date,
  active_from time, active_to time, is_open_now boolean, eligible boolean, today_play jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.description, c.banner_key, c.starts_on, c.ends_on, c.active_from, c.active_to,
    private.campaign_open_now(c),
    (select auth.uid()) is null or private.customer_eligible(c, (select auth.uid())),
    (select private.play_json(p) from public.scratch_plays p
      where p.campaign_id = c.id and p.customer_id = (select auth.uid()) and p.play_date = private.today_ist())
  from public.scratch_campaigns c
  where c.is_active
    and c.starts_on <= private.today_ist()
    and (c.ends_on is null or c.ends_on >= private.today_ist())
  order by c.starts_on desc, c.id desc;
$$;

-- Scratch once. Picks the result on the server and takes the prize out of stock atomically.
create or replace function public.play_scratch(p_campaign_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  c public.scratch_campaigns;
  existing public.scratch_plays;
  roll numeric := random();
  cum numeric := 0;
  pr record;
  won_prize public.scratch_prizes;
  play public.scratch_plays;
  attempt int := 0;
begin
  if uid is null then
    raise exception 'Sign in to scratch' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.scratch_campaigns where id = p_campaign_id for share;
  if not found or not c.is_active then
    raise exception 'This campaign is not running' using errcode = 'P0001';
  end if;

  select * into existing from public.scratch_plays
    where campaign_id = c.id and customer_id = uid and play_date = private.today_ist();
  if found then
    return private.play_json(existing) || jsonb_build_object('status', 'already_played');
  end if;

  if not private.campaign_open_now(c) then
    raise exception 'Scratch is open % to % today', to_char(c.active_from, 'HH12:MI AM'), to_char(c.active_to, 'HH12:MI AM')
      using errcode = 'P0001';
  end if;
  if not private.customer_eligible(c, uid) then
    raise exception 'This campaign is not available in your area' using errcode = 'P0001';
  end if;

  -- Walk the prizes in a fixed order; a roll inside a prize's slice wins it. Prizes that ran out keep their
  -- slice, so running out never raises anyone else's odds. Customers past the win cap, and sponsors playing
  -- for their own prizes, always lose.
  if c.max_wins_per_customer is null
     or (select count(*) from public.scratch_plays
         where campaign_id = c.id and customer_id = uid and won) < c.max_wins_per_customer then
    for pr in
      select sp.id, sp.probability, sp.remaining, sp.sponsor_vendor_id from public.scratch_prizes sp
      where sp.campaign_id = c.id and sp.is_active and sp.probability > 0
      order by sp.id
    loop
      cum := cum + pr.probability;
      if roll < cum then
        if pr.remaining > 0
           and (pr.sponsor_vendor_id is null or private.vendor_is_live(pr.sponsor_vendor_id))
           and not exists (select 1 from public.vendors where id = pr.sponsor_vendor_id and owner_id = uid) then
          update public.scratch_prizes set remaining = remaining - 1
            where id = pr.id and remaining > 0
            returning * into won_prize;
        end if;
        exit;
      end if;
    end loop;
  end if;

  loop
    begin
      insert into public.scratch_plays (campaign_id, customer_id, play_date, prize_id, vendor_id, won,
                                        claim_code, claim_status, expires_at)
      values (c.id, uid, private.today_ist(), won_prize.id, won_prize.sponsor_vendor_id, won_prize.id is not null,
              case when won_prize.id is not null then private.new_claim_code() end,
              case when won_prize.id is not null then 'unclaimed'::public.claim_status end,
              case when won_prize.id is not null then now() + make_interval(days => c.claim_valid_days) end)
      returning * into play;
      exit;
    exception when unique_violation then
      -- a second tap in the same instant: hand back the first result (this block's stock change is undone)
      select * into existing from public.scratch_plays
        where campaign_id = c.id and customer_id = uid and play_date = private.today_ist();
      if found then
        return private.play_json(existing) || jsonb_build_object('status', 'already_played');
      end if;
      -- otherwise the claim code collided; try another
      attempt := attempt + 1;
      if attempt > 5 then raise; end if;
    end;
  end loop;

  return private.play_json(play) || jsonb_build_object('status', case when play.won then 'won' else 'lost' end);
end;
$$;

-- The caller's wins, newest first.
create or replace function public.my_prizes()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.play_json(p) from public.scratch_plays p
  where p.customer_id = (select auth.uid()) and p.won
  order by p.played_at desc;
$$;

-- Vendor (sponsor) or manager looks up a claim code; with p_confirm it also hands the prize over.
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
  me bigint := private.my_vendor_id();
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

-- A vendor's winners across the campaigns they sponsor. Claim codes are left out: the customer shows theirs.
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
  where p.won and p.vendor_id = (select private.my_vendor_id())
    and (p_campaign_id is null or p.campaign_id = p_campaign_id)
  order by p.played_at desc
  limit 500;
$$;

-- Managers: winner history with names, for the admin winners and fraud screens.
create or replace function public.campaign_winners(p_campaign_id bigint)
returns table (
  play_id bigint, prize_id bigint, prize_name text, sponsor_name text, customer_id uuid, customer_name text,
  customer_email text, played_at timestamptz, claim_code text, claim_status text, expires_at timestamptz,
  claimed_at timestamptz, fraud_flag boolean, fraud_note text, customer_wins bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_campaigns() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  select p.id, p.prize_id, pr.name, v.business_name, p.customer_id, coalesce(pf.full_name, ''), u.email::text,
    p.played_at, p.claim_code,
    case when p.claim_status = 'unclaimed' and p.expires_at < now() then 'expired' else p.claim_status::text end,
    p.expires_at, p.claimed_at, p.fraud_flag, p.fraud_note,
    count(*) over (partition by p.customer_id)
  from public.scratch_plays p
  join public.scratch_prizes pr on pr.id = p.prize_id
  left join public.vendors v on v.id = p.vendor_id
  left join public.profiles pf on pf.id = p.customer_id
  left join auth.users u on u.id = p.customer_id
  where p.campaign_id = p_campaign_id and p.won
  order by p.played_at desc
  limit 1000;
end;
$$;

-- Managers: per-prize stock check. given_out always equals won (the Phase 2 gate).
create or replace function public.campaign_stats(p_campaign_id bigint)
returns table (
  prize_id bigint, prize_name text, quantity int, remaining int, given_out int, won bigint,
  claimed bigint, unclaimed bigint, expired bigint, plays_total bigint, players bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_campaigns() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  select pr.id, pr.name, pr.quantity, pr.remaining, pr.quantity - pr.remaining,
    count(p.id),
    count(p.id) filter (where p.claim_status = 'claimed'),
    count(p.id) filter (where p.claim_status = 'unclaimed' and p.expires_at >= now()),
    count(p.id) filter (where p.claim_status = 'expired' or (p.claim_status = 'unclaimed' and p.expires_at < now())),
    (select count(*) from public.scratch_plays a where a.campaign_id = p_campaign_id),
    (select count(distinct a.customer_id) from public.scratch_plays a where a.campaign_id = p_campaign_id)
  from public.scratch_prizes pr
  left join public.scratch_plays p on p.prize_id = pr.id
  where pr.campaign_id = p_campaign_id
  group by pr.id
  order by pr.id;
end;
$$;

-- Housekeeping, run hourly by pg_cron: unclaimed prizes past their expiry become expired.
create or replace function public.expire_scratch_claims()
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with done as (
    update public.scratch_plays set claim_status = 'expired'
    where claim_status = 'unclaimed' and expires_at < now()
    returning 1
  )
  select count(*)::int from done;
$$;

revoke execute on function public.scratch_today(), public.play_scratch(bigint), public.my_prizes(),
  public.claim_prize(text, boolean), public.vendor_winners(bigint), public.campaign_winners(bigint),
  public.campaign_stats(bigint), public.expire_scratch_claims() from public, anon;
grant execute on function public.scratch_today() to anon, authenticated;
grant execute on function public.play_scratch(bigint), public.my_prizes(), public.claim_prize(text, boolean),
  public.vendor_winners(bigint), public.campaign_winners(bigint), public.campaign_stats(bigint) to authenticated;
revoke execute on function public.expire_scratch_claims() from authenticated;
