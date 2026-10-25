-- Scratch & Win prizes per branch.
--   * A prize is collected at every branch of the sponsor (scratch_prizes.all_branches) or only at the
--     branches listed in scratch_prize_branches, like offers.
--   * Branch managers add and edit prizes for their own branch; brand editors choose the branches.
--   * Branch members check claim codes and see winners only for prizes their branch hands over.
--   * The winner sees which branches to visit (play_json sponsor.collect_at).

alter table public.scratch_prizes
  add column if not exists all_branches boolean not null default true;

create table if not exists public.scratch_prize_branches (
  prize_id bigint not null references public.scratch_prizes (id) on delete cascade,
  branch_id bigint not null references public.branches (id) on delete cascade,
  primary key (prize_id, branch_id)
);
create index if not exists scratch_prize_branches_branch_idx on public.scratch_prize_branches (branch_id);
alter table public.scratch_prize_branches enable row level security;
-- Where a prize is collected is not secret. Written only by set_prize_branches() and the insert trigger.
drop policy if exists "scratch_prize_branches: signed-in read" on public.scratch_prize_branches;
create policy "scratch_prize_branches: signed-in read" on public.scratch_prize_branches
  for select to authenticated using (true);
grant select on public.scratch_prize_branches to authenticated;
revoke insert, update, delete on public.scratch_prize_branches from anon, authenticated;

-- True when the prize is handed over at branch b.
create or replace function private.prize_at_branch(p bigint, b bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.scratch_prizes x where x.id = p and x.all_branches)
    or exists (select 1 from public.scratch_prize_branches pb where pb.prize_id = p and pb.branch_id = b);
$$;

-- A branch manager may change a prize only when it is for their branch alone.
create or replace function private.branch_owns_prize(p bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.my_branch_id() is not null
    and exists (select 1 from public.scratch_prizes x
                where x.id = p and not x.all_branches and x.sponsor_vendor_id = private.my_member_vendor_id())
    and exists (select 1 from public.scratch_prize_branches pb
                where pb.prize_id = p and pb.branch_id = private.my_branch_id())
    and not exists (select 1 from public.scratch_prize_branches pb
                    where pb.prize_id = p and pb.branch_id <> private.my_branch_id());
$$;

-- Branch members belong to the campaigns their business joined.
create or replace function private.joined_campaign(c bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_vendors cv
    where cv.campaign_id = c and cv.vendor_id = (select private.my_member_vendor_id())
  );
$$;

revoke execute on function private.prize_at_branch(bigint, bigint), private.branch_owns_prize(bigint) from public;
grant execute on function private.prize_at_branch(bigint, bigint), private.branch_owns_prize(bigint) to authenticated;

-- Who may add and change prizes ------------------------------------------------------------------------

drop policy if exists "scratch_prizes: public read active" on public.scratch_prizes;
create policy "scratch_prizes: public read active" on public.scratch_prizes
  for select to authenticated
  using (
    (is_active and exists (select 1 from public.scratch_campaigns c where c.id = campaign_id and c.is_active))
    or sponsor_vendor_id = (select private.my_member_vendor_id())
    or (select private.can_manage_campaigns())
  );
-- Brand editors for any branch; a branch manager for their branch (the insert trigger links it).
drop policy if exists "scratch_prizes: sponsor or manager insert" on public.scratch_prizes;
create policy "scratch_prizes: sponsor or manager insert" on public.scratch_prizes
  for insert to authenticated
  with check (
    (select private.can_manage_campaigns())
    or ((sponsor_vendor_id = (select private.my_vendor_id())
         or ((select private.my_branch_id()) is not null
             and sponsor_vendor_id = (select private.my_member_vendor_id())
             and private.vendor_is_live(sponsor_vendor_id)))
        and (select private.joined_campaign(campaign_id)))
  );
drop policy if exists "scratch_prizes: sponsor or manager update" on public.scratch_prizes;
create policy "scratch_prizes: sponsor or manager update" on public.scratch_prizes
  for update to authenticated
  using (sponsor_vendor_id = (select private.my_vendor_id()) or private.branch_owns_prize(id)
         or (select private.can_manage_campaigns()))
  with check (sponsor_vendor_id = (select private.my_vendor_id()) or private.branch_owns_prize(id)
              or (select private.can_manage_campaigns()));

-- Same as before, plus: where a prize is collected changes only through set_prize_branches(), and a
-- branch manager's new prize is for their branch.
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
      if private.my_vendor_id() is null then
        new.all_branches := false;
      end if;
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
    if current_setting('iwillfly.prize_branches', true) is distinct from 'on' then
      new.all_branches := old.all_branches;
    end if;
  end if;
  return new;
end;
$$;

-- A branch manager's new prize is collected at their branch.
create or replace function public.link_branch_prize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.all_branches and private.my_branch_id() is not null
     and new.sponsor_vendor_id = private.my_member_vendor_id() then
    insert into public.scratch_prize_branches (prize_id, branch_id)
    values (new.id, private.my_branch_id()) on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists scratch_prizes_branch_link on public.scratch_prizes;
create trigger scratch_prizes_branch_link after insert on public.scratch_prizes
  for each row execute function public.link_branch_prize();
revoke execute on function public.link_branch_prize() from public, anon, authenticated;

-- Sets where a prize is collected: every branch, or the listed branches of the sponsor's shops.
create or replace function public.set_prize_branches(p_prize_id bigint, p_all boolean, p_branch_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.scratch_prizes;
  manager boolean := private.can_manage_campaigns();
  ids bigint[] := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_branch_ids, '{}')) x
                   where x is not null);
begin
  select * into pr from public.scratch_prizes where id = p_prize_id;
  if pr.id is null then
    raise exception 'Prize not found' using errcode = 'P0002';
  end if;
  if not manager and pr.sponsor_vendor_id is distinct from private.my_vendor_id() then
    if not private.branch_owns_prize(pr.id) then
      raise exception 'You can only change prizes of your own branch' using errcode = 'insufficient_privilege';
    end if;
    p_all := false;
    ids := array[private.my_branch_id()];
  end if;
  if not coalesce(p_all, false) then
    if pr.sponsor_vendor_id is null then
      raise exception 'IWILLFLY prizes are handed over by IWILLFLY, not at a branch' using errcode = '22023';
    end if;
    if cardinality(ids) = 0 then
      raise exception 'Choose at least one branch' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(ids) x
      where not exists (select 1 from public.branches b join public.shops s on s.id = b.shop_id
                        where b.id = x and s.vendor_id = pr.sponsor_vendor_id)) then
      raise exception 'Choose branches of the sponsoring business' using errcode = '22023';
    end if;
    if exists (select 1 from public.branches b where b.id = any(ids) and b.review_status = 'rejected') then
      raise exception 'A chosen branch was not approved. Fix the branch first.' using errcode = '22023';
    end if;
  end if;

  perform set_config('iwillfly.prize_branches', 'on', true);
  update public.scratch_prizes set all_branches = coalesce(p_all, false) where id = pr.id;
  perform set_config('iwillfly.prize_branches', 'off', true);
  delete from public.scratch_prize_branches where prize_id = pr.id
    and (coalesce(p_all, false) or not (branch_id = any(ids)));
  if not coalesce(p_all, false) then
    insert into public.scratch_prize_branches (prize_id, branch_id)
    select pr.id, x from unnest(ids) x on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.set_prize_branches(bigint, boolean, bigint[]) from public, anon;
grant execute on function public.set_prize_branches(bigint, boolean, bigint[]) to authenticated;

-- Winners and claim codes per branch ------------------------------------------------------------------

-- The sponsor in a play result also names the branches where the prize is collected.
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
    'sponsor', case when v.id is not null then jsonb_build_object(
      'vendor_id', v.id, 'name', v.business_name, 'phone', v.contact_phone, 'whatsapp', v.whatsapp,
      'shop_id', coalesce(
        (select b.shop_id from public.scratch_prize_branches pb join public.branches b on b.id = pb.branch_id
         where pb.prize_id = pr.id and not pr.all_branches order by b.id limit 1),
        (select s.id from public.shops s where s.vendor_id = v.id and s.is_active
         order by s.created_at, s.id limit 1)),
      'collect_at', case when pr.id is not null and not pr.all_branches then
        (select jsonb_agg(b.name order by b.name) from public.scratch_prize_branches pb
         join public.branches b on b.id = pb.branch_id where pb.prize_id = pr.id) end) end,
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

-- Branch members see the winners of prizes their branch hands over.
create or replace function public.vendor_winners(p_campaign_id bigint default null)
returns table (
  play_id bigint, campaign_id bigint, campaign_name text, prize_id bigint, prize_name text,
  customer_name text, customer_phone text, played_at timestamptz, claim_status text, expires_at timestamptz,
  claimed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.campaign_id, c.name, p.prize_id, pr.name, private.masked_name(p.customer_id), pf.phone,
    p.played_at,
    case when p.claim_status = 'unclaimed' and p.expires_at < now() then 'expired' else p.claim_status::text end,
    p.expires_at, p.claimed_at
  from public.scratch_plays p
  join public.scratch_campaigns c on c.id = p.campaign_id
  join public.scratch_prizes pr on pr.id = p.prize_id
  left join public.profiles pf on pf.id = p.customer_id
  where p.won and p.vendor_id = (select private.my_member_vendor_id())
    and (p_campaign_id is null or p.campaign_id = p_campaign_id)
    and ((select private.my_member_branch_id()) is null
         or private.prize_at_branch(p.prize_id, (select private.my_member_branch_id())))
  order by p.played_at desc
  limit 500;
$$;

-- Branch members can check only codes for prizes their branch hands over.
create or replace function public.claim_prize(p_code text, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  p public.scratch_plays;
  manager boolean := private.can_manage_campaigns();
  me bigint := private.my_member_vendor_id();
  my_branch bigint := private.my_member_branch_id();
  status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into p from public.scratch_plays where claim_code = code for update;
  -- Someone else's code looks the same as a wrong one, so codes cannot be probed.
  if not found or not coalesce(manager or (p.vendor_id = me and private.vendor_is_live(me)
                                           and (my_branch is null or private.prize_at_branch(p.prize_id, my_branch))),
                               false) then
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
                          'customer_phone', (select phone from public.profiles where id = p.customer_id),
                          'fraud_flag', p.fraud_flag);
end;
$$;
