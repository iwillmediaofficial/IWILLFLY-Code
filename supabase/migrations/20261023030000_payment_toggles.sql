-- Admins choose which payment methods vendors are offered (Admin > Billing settings):
--   pay_instamojo: online through Instamojo (card, UPI, net banking, wallets)
--   pay_upi:       direct UPI to billing_settings.upi_id, then a transaction ID or screenshot
-- Vendors read both from billing_settings as before (signed-in read). Switched-off methods are refused
-- here too, not only hidden on the invoice page. Admins can still mark any invoice paid by hand.

alter table public.billing_settings
  add column if not exists pay_instamojo boolean not null default true,
  add column if not exists pay_upi boolean not null default true;

-- Same as 20261023010000_instamojo_payments.sql, plus the pay_instamojo switch.
create or replace function public.gateway_invoice_for(p_invoice_id bigint, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  v public.vendors;
  recent public.gateway_payments;
begin
  if not coalesce((select pay_instamojo from public.billing_settings where id = 1), true) then
    raise exception 'Online payment is switched off' using errcode = 'P0001';
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
  if i.total < 9 then
    raise exception 'Online payment needs at least Rs 9' using errcode = 'P0001';
  end if;
  -- A payment page opened in the last 20 minutes for the same amount is offered again instead of a new one.
  select * into recent from public.gateway_payments
    where invoice_id = i.id and status = 'created' and amount = i.total and created_at > now() - interval '20 minutes'
    order by created_at desc, id desc limit 1;
  return jsonb_build_object(
    'invoice_id', i.id, 'number', i.number, 'amount', i.total, 'vendor_id', v.id,
    'business_name', v.business_name,
    'email', (select u.email from auth.users u where u.id = v.owner_id),
    'phone', coalesce(v.contact_phone, (select p.phone from public.profiles p where p.id = v.owner_id)),
    'reuse_url', recent.longurl,
    'open_requests', coalesce((select jsonb_agg(g.request_id) from public.gateway_payments g
                               where g.invoice_id = i.id and g.status = 'created'), '[]'::jsonb));
end;
$$;

-- Same as 20261023020000_upi_proof.sql, plus the pay_upi switch.
create or replace function public.submit_payment(p_invoice_id bigint, p_ref text default null,
                                                 p_note text default null, p_proof_key text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ref text := nullif(trim(coalesce(p_ref, '')), '');
  proof text := nullif(trim(coalesce(p_proof_key, '')), '');
  i public.invoices;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce((select pay_upi from public.billing_settings where id = 1), true) then
    raise exception 'UPI payment is switched off' using errcode = 'P0001';
  end if;
  if ref is null and proof is null then
    raise exception 'Enter the UPI transaction ID or add a screenshot of the payment' using errcode = '22023';
  end if;
  if ref is not null and char_length(ref) > 60 then
    raise exception 'Transaction ID is too long (60 characters max)' using errcode = '22023';
  end if;
  -- Only a screenshot this person uploaded (the Worker names it after their user id).
  if proof is not null and (proof !~ '^payments/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
                            or split_part(proof, '/', 2) <> (select auth.uid())::text) then
    raise exception 'Please add the screenshot again' using errcode = '22023';
  end if;

  update public.invoices
    set status = 'submitted',
        payer_ref = ref,
        payer_note = left(nullif(trim(coalesce(p_note, '')), ''), 300),
        payer_proof_key = proof,
        submitted_at = now()
    where id = p_invoice_id and status in ('unpaid', 'submitted') and private.is_vendor_owner(vendor_id)
    returning * into i;
  if i.id is null then
    raise exception 'Invoice not found or already settled' using errcode = 'P0002';
  end if;

  -- Tell the admins there is a UPI payment to check.
  perform private.notify(u.user_id, 'billing', 'UPI payment to check: ' || i.number,
    coalesce(i.bill_to->>'business_name', 'A vendor') || ' says they paid ' || i.total::text
      || ' by UPI' || coalesce(' (ref ' || ref || ')', ' (screenshot added)') || '.',
    '/admin/billing/invoices/' || i.id)
  from (select distinct user_id from public.user_roles where role in ('admin', 'super_admin')) u;
end;
$$;
