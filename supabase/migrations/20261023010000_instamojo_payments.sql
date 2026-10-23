-- Online payments through Instamojo. The Worker (worker/instamojo.ts) holds the Instamojo keys and is the
-- only caller of these functions, with the service role key:
--   * gateway_invoice_for() hands it the amount to charge, taken from the invoice, never from the browser.
--   * gateway_payment_created() records each Instamojo payment request against its invoice.
--   * gateway_record_payment() is called only after the Worker has asked Instamojo itself that the payment
--     is a Credit; it checks the amount again and marks the invoice paid, once.
-- Vendors can read their own payment attempts; nobody writes them except through these functions.

alter table public.invoices drop constraint if exists invoices_payment_method_check;
alter table public.invoices add constraint invoices_payment_method_check
  check (payment_method in ('upi', 'cash', 'bank', 'razorpay', 'free', 'instamojo'));

create table if not exists public.gateway_payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices (id) on delete restrict,
  vendor_id bigint not null references public.vendors (id) on delete cascade,
  provider text not null default 'instamojo' check (provider = 'instamojo'),
  request_id text not null unique check (char_length(request_id) <= 64),
  longurl text not null check (char_length(longurl) <= 500),
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'duplicate')),
  payment_id text unique check (char_length(payment_id) <= 64),
  details jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists gateway_payments_invoice_idx on public.gateway_payments (invoice_id, created_at desc);
create index if not exists gateway_payments_vendor_idx on public.gateway_payments (vendor_id);
create index if not exists gateway_payments_created_by_idx on public.gateway_payments (created_by);

alter table public.gateway_payments enable row level security;
create policy "gateway_payments: owner or support read" on public.gateway_payments
  for select to authenticated
  using ((select private.is_vendor_owner(vendor_id)) or (select private.is_support()));

-- What to charge for an invoice, for its owner only. Raises when the invoice cannot be paid online.
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

create or replace function public.gateway_payment_created(p_invoice_id bigint, p_request_id text, p_longurl text,
                                                          p_amount numeric, p_user uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.gateway_payments (invoice_id, vendor_id, request_id, longurl, amount, created_by)
  select i.id, i.vendor_id, p_request_id, p_longurl, p_amount, p_user
  from public.invoices i where i.id = p_invoice_id;
$$;

-- Marks the invoice paid for a payment Instamojo has confirmed as Credit. Safe to call more than once
-- (redirect and webhook both call it). Returns {"result": "paid" | "already" | "duplicate" | "mismatch" | "unknown",
-- "invoice_id": ...}.
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
        'This invoice was paid twice online (Instamojo payment ' || p_payment_id || ').',
        '/admin/billing/invoices/' || i.id);
    end loop;
    return jsonb_build_object('result', 'duplicate', 'invoice_id', g.invoice_id);
  end if;
  update public.gateway_payments
    set status = 'paid', payment_id = p_payment_id, details = p_details, paid_at = now()
    where id = g.id;
  perform private.activate_invoice(i.id, 'instamojo', p_payment_id, null);
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

revoke execute on function public.gateway_invoice_for(bigint, uuid), public.gateway_payment_created(bigint, text, text, numeric, uuid),
  public.gateway_record_payment(text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.gateway_invoice_for(bigint, uuid), public.gateway_payment_created(bigint, text, text, numeric, uuid),
  public.gateway_record_payment(text, text, numeric, jsonb) to service_role;
