-- Online payments through Razorpay, next to Instamojo and direct UPI. The Worker (worker/razorpay.ts) holds the
-- Razorpay keys and opens a Razorpay payment link for the invoice; it uses the same gateway_* functions as
-- Instamojo, now told which provider they are for:
--   * gateway_invoice_for(invoice, user, provider) checks that provider's switch and hands back the amount.
--   * gateway_payment_created(..., provider) records the payment link (its id in request_id).
--   * gateway_record_payment() marks the invoice paid with the provider's own payment method.
-- The two-argument gateway_invoice_for() and five-argument gateway_payment_created() stay for Instamojo.
--
-- pay_razorpay starts off: an admin switches it on in Admin > Billing settings once the Worker has its keys.

alter table public.billing_settings
  add column if not exists pay_razorpay boolean not null default false;

alter table public.gateway_payments drop constraint if exists gateway_payments_provider_check;
alter table public.gateway_payments add constraint gateway_payments_provider_check
  check (provider in ('instamojo', 'razorpay'));

-- What to charge for an invoice through one provider, for its owner only. Raises when it cannot be paid that way.
create or replace function public.gateway_invoice_for(p_invoice_id bigint, p_user uuid, p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  v public.vendors;
  s public.billing_settings;
  recent public.gateway_payments;
begin
  select * into s from public.billing_settings where id = 1;
  if p_provider = 'instamojo' then
    if not coalesce(s.pay_instamojo, true) then
      raise exception 'Online payment is switched off' using errcode = 'P0001';
    end if;
  elsif p_provider = 'razorpay' then
    if not coalesce(s.pay_razorpay, false) then
      raise exception 'Razorpay payment is switched off' using errcode = 'P0001';
    end if;
  else
    raise exception 'Unknown payment provider' using errcode = '22023';
  end if;
  select * into i from public.invoices where id = p_invoice_id;
  select * into v from public.vendors where id = i.vendor_id;
  if i.id is null or v.owner_id is distinct from p_user then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if v.status = 'blocked' then
    raise exception 'This account is blocked' using errcode = 'insufficient_privilege';
  end if;
  if i.status not in ('unpaid', 'submitted') then
    raise exception 'This invoice is already settled' using errcode = 'P0001';
  end if;
  if p_provider = 'instamojo' and i.total < 9 then
    raise exception 'Online payment needs at least Rs 9' using errcode = 'P0001';
  end if;
  if p_provider = 'razorpay' and i.total < 1 then
    raise exception 'Online payment needs at least Rs 1' using errcode = 'P0001';
  end if;
  -- A payment page opened in the last 20 minutes for the same amount is offered again instead of a new one.
  select * into recent from public.gateway_payments
    where invoice_id = i.id and provider = p_provider and status = 'created' and amount = i.total
      and created_at > now() - interval '20 minutes'
    order by created_at desc, id desc limit 1;
  return jsonb_build_object(
    'invoice_id', i.id, 'number', i.number, 'amount', i.total, 'vendor_id', v.id,
    'business_name', v.business_name,
    'email', (select u.email from auth.users u where u.id = v.owner_id),
    'phone', coalesce(v.contact_phone, (select p.phone from public.profiles p where p.id = v.owner_id)),
    'reuse_url', recent.longurl,
    'open_requests', coalesce((select jsonb_agg(g.request_id order by g.created_at) from public.gateway_payments g
                               where g.invoice_id = i.id and g.provider = p_provider and g.status = 'created'),
                              '[]'::jsonb));
end;
$$;

-- The Instamojo version (still called by worker/instamojo.ts), same as before.
create or replace function public.gateway_invoice_for(p_invoice_id bigint, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.gateway_invoice_for(p_invoice_id, p_user, 'instamojo');
$$;

create or replace function public.gateway_payment_created(p_invoice_id bigint, p_request_id text, p_longurl text,
                                                          p_amount numeric, p_user uuid, p_provider text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.gateway_payments (invoice_id, vendor_id, provider, request_id, longurl, amount, created_by)
  select i.id, i.vendor_id, p_provider, p_request_id, p_longurl, p_amount, p_user
  from public.invoices i where i.id = p_invoice_id;
$$;

-- Same as 20261023010000_instamojo_payments.sql, but the invoice is paid with the payment's own provider
-- ('instamojo' or 'razorpay') and the refund notice names it.
create or replace function public.gateway_record_payment(p_request_id text, p_payment_id text, p_amount numeric,
                                                         p_details jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.gateway_payments;
  i public.invoices;
  v public.vendors;
  a record;
begin
  select * into g from public.gateway_payments where request_id = p_request_id for update;
  if g.id is null then
    return jsonb_build_object('result', 'unknown');
  end if;
  if g.status in ('paid', 'duplicate') then
    return jsonb_build_object('result', 'already', 'invoice_id', g.invoice_id);
  end if;
  select * into i from public.invoices where id = g.invoice_id for update;
  if p_amount is distinct from g.amount or p_amount is distinct from i.total then
    update public.gateway_payments set details = p_details, payment_id = p_payment_id, status = 'failed'
      where id = g.id;
    return jsonb_build_object('result', 'mismatch', 'invoice_id', g.invoice_id);
  end if;
  if i.status not in ('unpaid', 'submitted') then
    -- Paid twice (two payment pages): keep the record so the team can refund it.
    update public.gateway_payments
      set status = 'duplicate', payment_id = p_payment_id, details = p_details, paid_at = now()
      where id = g.id;
    for a in select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin') loop
      perform private.notify(a.user_id, 'billing', 'Refund needed: ' || i.number,
        'This invoice was paid twice online (' || initcap(g.provider) || ' payment ' || p_payment_id || ').',
        '/admin/billing/invoices/' || i.id);
    end loop;
    return jsonb_build_object('result', 'duplicate', 'invoice_id', g.invoice_id);
  end if;
  update public.gateway_payments
    set status = 'paid', payment_id = p_payment_id, details = p_details, paid_at = now()
    where id = g.id;
  perform private.activate_invoice(i.id, g.provider, p_payment_id, null);
  select * into v from public.vendors where id = i.vendor_id;
  if v.status = 'pending' then
    for a in select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin') loop
      perform private.notify(a.user_id, 'billing', 'Paid and ready to review: ' || v.business_name,
        'The plan is paid online. Check the shop details and approve.', '/admin/vendors?status=pending');
    end loop;
  end if;
  return jsonb_build_object('result', 'paid', 'invoice_id', i.id);
end;
$$;

revoke execute on function public.gateway_invoice_for(bigint, uuid, text),
  public.gateway_invoice_for(bigint, uuid),
  public.gateway_payment_created(bigint, text, text, numeric, uuid, text),
  public.gateway_record_payment(text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.gateway_invoice_for(bigint, uuid, text),
  public.gateway_invoice_for(bigint, uuid),
  public.gateway_payment_created(bigint, text, text, numeric, uuid, text),
  public.gateway_record_payment(text, text, numeric, jsonb) to service_role;
