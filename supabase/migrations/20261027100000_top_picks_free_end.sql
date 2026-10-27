-- Top Picks: free days from Admin stop at the offer's end date, like bought ones.

-- A free sponsorship (launch partner, or days given back after a removal). Adds days if already running.
-- It can't run past the offer's end date.
create or replace function public.admin_give_top_pick(p_offer_id bigint, p_district_id bigint, p_days int,
                                                      p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  v public.vendors;
  t public.top_picks;
  inv bigint;
  s public.billing_settings;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Days must be between 1 and 366' using errcode = '22023';
  end if;
  select * into o from public.offers where id = p_offer_id;
  if o.id is null or o.status <> 'approved' then
    raise exception 'Only approved offers can be Top Picks' using errcode = '22023';
  end if;
  if not exists (select 1 from private.offer_branches_in(o.id, p_district_id)) then
    raise exception 'This offer has no branch in that district' using errcode = '22023';
  end if;
  select v2.* into v from public.vendors v2 join public.shops sh on sh.vendor_id = v2.id where sh.id = o.shop_id;
  select * into t from public.top_picks
    where offer_id = o.id and district_id = p_district_id and status in ('awaiting_payment', 'waiting', 'live');
  -- Free days stop at the offer's end date too, like a bought Top Pick.
  perform private.top_pick_check_offer(o,
    case when t.status = 'live' then greatest(t.ends_on, private.today_ist() - 1) + p_days
         when t.status = 'waiting' then private.today_ist() + t.waiting_days + p_days - 1
         else private.today_ist() + p_days - 1 end);
  if t.id is null then
    insert into public.top_picks (vendor_id, shop_id, offer_id, district_id, bought_by)
    values (v.id, o.shop_id, o.id, p_district_id, (select auth.uid()))
    returning * into t;
  end if;
  select * into s from public.billing_settings where id = 1;
  insert into public.invoices (number, vendor_id, gst_percent, bill_to, bill_from, created_by, admin_note)
  values (s.invoice_prefix || '-' || to_char(private.today_ist(), 'YYYY') || '-'
            || lpad(nextval('public.invoice_number_seq')::text, 5, '0'),
          v.id, s.gst_percent,
          jsonb_build_object('business_name', v.business_name, 'phone', v.contact_phone, 'vendor_id', v.id),
          jsonb_build_object('name', s.business_name, 'address', s.business_address, 'gstin', s.gstin,
                             'upi_id', s.upi_id, 'payee_name', s.payee_name, 'note', s.payment_note),
          (select auth.uid()), left(nullif(trim(coalesce(p_note, '')), ''), 500))
  returning id into inv;
  insert into public.invoice_items (invoice_id, top_pick_id, shop_id, offer_id, description, days, amount)
  values (inv, t.id, o.shop_id, o.id,
          left('Top Picks (free): ' || o.title || ' in ' || (select name from public.locations where id = p_district_id)
               || ' (' || private.top_pick_days_text(p_days) || ')', 200),
          p_days, 0);
  perform private.activate_invoice(inv, 'free', null, null);
  return t.id;
end;
$$;
