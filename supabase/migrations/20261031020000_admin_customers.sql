-- Admin > Customers: a searchable list of customer accounts and one customer's full details.
-- Emails live in auth.users, which the API cannot read, so both are role-checked security definer
-- functions. Read-only: nothing here changes any data.

-- One row per customer account, newest first. p_q searches name, email and phone.
-- p_kind: 'all', 'customers' (only plain customers) or 'staff' (also a vendor, branch manager or admin).
create or replace function public.admin_customers(p_q text default null, p_kind text default 'all',
                                                  p_limit int default 50, p_offset int default 0)
returns table (id uuid, full_name text, email text, phone text, area text, district text,
               date_of_birth date, created_at timestamptz, last_sign_in_at timestamptz, provider text,
               points int, bills bigint, bills_pending bigint, wins bigint, is_staff boolean,
               total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := nullif(lower(trim(p_q)), '');
  digits text := nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '');
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  with c as (
    select r.user_id as uid from public.user_roles r where r.role = 'customer'
  ), m as (
    select c.uid, u.email::text as email, pf.full_name, pf.phone, pf.location_id, pf.date_of_birth,
           coalesce(pf.created_at, u.created_at) as created_at, u.last_sign_in_at,
           coalesce(u.raw_app_meta_data ->> 'provider', 'email') as provider,
           exists (select 1 from public.user_roles r where r.user_id = c.uid and r.role <> 'customer')
             or exists (select 1 from public.vendors v where v.owner_id = c.uid)
             or exists (select 1 from public.vendor_staff vs where vs.user_id = c.uid) as is_staff
    from c
    join auth.users u on u.id = c.uid
    left join public.profiles pf on pf.id = c.uid
    where (q is null
       or lower(coalesce(pf.full_name, '')) like '%' || q || '%'
       or lower(u.email) like '%' || q || '%'
       or (digits is not null and length(digits) >= 3
           and regexp_replace(coalesce(pf.phone, ''), '\D', '', 'g') like '%' || digits || '%'))
  )
  select m.uid, coalesce(m.full_name, ''), m.email, m.phone, a.name, d.name, m.date_of_birth,
         m.created_at, m.last_sign_in_at, m.provider,
         coalesce((select sum(l.points_remaining) from public.points_ledger l
                   where l.customer_id = m.uid and l.points_remaining > 0 and l.expires_at > now()), 0)::int,
         (select count(*) from public.bill_submissions b where b.customer_id = m.uid),
         (select count(*) from public.bill_submissions b where b.customer_id = m.uid and b.status = 'pending'),
         (select count(*) from public.scratch_plays s where s.customer_id = m.uid and s.won),
         m.is_staff,
         count(*) over ()
  from m
  left join public.locations a on a.id = m.location_id
  left join public.locations d on d.id = a.parent_id
  where coalesce(p_kind, 'all') = 'all'
     or (p_kind = 'customers' and not m.is_staff)
     or (p_kind = 'staff' and m.is_staff)
  order by m.created_at desc, m.uid
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Everything about one customer for the detail page: profile, points, bills, Scratch & Win, cash-outs.
create or replace function public.admin_customer(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  res jsonb;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select jsonb_build_object(
    'id', u.id,
    'full_name', coalesce(pf.full_name, ''),
    'email', u.email,
    'phone', pf.phone,
    'date_of_birth', pf.date_of_birth,
    'area', a.name,
    'district', d.name,
    'created_at', coalesce(pf.created_at, u.created_at),
    'last_sign_in_at', u.last_sign_in_at,
    'provider', coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
    'roles', (select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb)
              from public.user_roles r where r.user_id = u.id),
    'vendor', (select jsonb_build_object('id', v.id, 'name', v.business_name)
               from public.vendors v where v.owner_id = u.id limit 1),
    'points', jsonb_build_object(
      'balance', coalesce((select sum(l.points_remaining) from public.points_ledger l
                           where l.customer_id = u.id and l.points_remaining > 0 and l.expires_at > now()), 0),
      'earned', coalesce((select sum(l.points) from public.points_ledger l
                          where l.customer_id = u.id and l.kind = 'earn'), 0),
      'cashed_out', coalesce((select sum(x.points) from public.redemptions x
                              where x.customer_id = u.id and x.status = 'paid'), 0),
      'cashed_out_amount', coalesce((select sum(x.amount) from public.redemptions x
                                     where x.customer_id = u.id and x.status = 'paid'), 0)
    ),
    'bill_counts', (select jsonb_build_object(
                      'all', count(*),
                      'pending', count(*) filter (where b.status = 'pending'),
                      'approved', count(*) filter (where b.status = 'approved'),
                      'rejected', count(*) filter (where b.status = 'rejected'),
                      'approved_amount', coalesce(sum(coalesce(b.approved_amount, b.amount))
                                                  filter (where b.status = 'approved'), 0))
                    from public.bill_submissions b where b.customer_id = u.id),
    'bills', (select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
                select b.id, b.status, b.bill_number, b.bill_date, coalesce(b.approved_amount, b.amount) as amount,
                       b.points, b.created_at, sh.name as shop_name
                from public.bill_submissions b join public.shops sh on sh.id = b.shop_id
                where b.customer_id = u.id order by b.id desc limit 20) x),
    'scratch', (select jsonb_build_object('plays', count(*), 'wins', count(*) filter (where s.won),
                                          'claimed', count(*) filter (where s.claim_status = 'claimed'))
                from public.scratch_plays s where s.customer_id = u.id),
    'wins', (select coalesce(jsonb_agg(x order by x.played_at desc), '[]'::jsonb) from (
               select s.id, s.played_at, s.claim_status, p.name as prize_name
               from public.scratch_plays s left join public.scratch_prizes p on p.id = s.prize_id
               where s.customer_id = u.id and s.won order by s.played_at desc limit 10) x),
    'cashouts', (select coalesce(jsonb_agg(x order by x.requested_at desc), '[]'::jsonb) from (
                   select r.id, r.points, r.amount, r.status, r.requested_at, r.decided_at
                   from public.redemptions r where r.customer_id = u.id
                   order by r.requested_at desc limit 10) x),
    'saved_offers', (select count(*) from public.saved_offers so where so.user_id = u.id),
    'saved_shops', (select count(*) from public.saved_shops ss where ss.user_id = u.id)
  ) into res
  from auth.users u
  left join public.profiles pf on pf.id = u.id
  left join public.locations a on a.id = pf.location_id
  left join public.locations d on d.id = a.parent_id
  where u.id = p_id;
  return res;
end;
$$;

revoke execute on function public.admin_customers(text, text, int, int), public.admin_customer(uuid)
from public, anon;
grant execute on function public.admin_customers(text, text, int, int), public.admin_customer(uuid)
to authenticated;
