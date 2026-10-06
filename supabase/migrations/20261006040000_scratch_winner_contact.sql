-- Scratch & Win: let a winner and the sponsor vendor contact each other.
--
-- Vendors see the mobile number of the customers who won their prizes (vendor_winners, claim_prize).
-- Winners see the sponsor's business phone, WhatsApp and a shop to visit (play_json's sponsor, which is
-- only ever returned for the customer's own plays).

-- The sponsor in a play result now carries the business contact and the vendor's first active shop.
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
      'shop_id', (select s.id from public.shops s where s.vendor_id = v.id and s.is_active
                  order by s.created_at, s.id limit 1)) end,
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

-- The vendor's winners, now with the winner's mobile number. The return type changes, so drop and recreate.
drop function public.vendor_winners(bigint);
create function public.vendor_winners(p_campaign_id bigint default null)
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
  order by p.played_at desc
  limit 500;
$$;
revoke execute on function public.vendor_winners(bigint) from public, anon;
grant execute on function public.vendor_winners(bigint) to authenticated, service_role;

-- Checking a claim code also shows the winner's mobile number.
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
                          'customer_phone', (select phone from public.profiles where id = p.customer_id),
                          'fraud_flag', p.fraud_flag);
end;
$$;
