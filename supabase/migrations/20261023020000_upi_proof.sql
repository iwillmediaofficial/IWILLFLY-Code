-- Direct UPI payments (Google Pay, PhonePe, Paytm…) to the UPI ID an admin sets in Admin > Billing settings,
-- next to Instamojo. After paying, the owner sends the UPI transaction ID, a screenshot of the payment, or both
-- (at least one). An admin checks the money arrived and marks the invoice paid (mark_invoice_paid), which also
-- lets them approve a new vendor on a paid plan (vendor_payment_first).
--
-- Screenshots are stored privately by the Worker (worker/bills.ts) under payments/<owner's user id>/<sha256>.webp
-- and opened through 10-minute signed links. Only the uploader and admins can open them.

alter table public.invoices
  add column if not exists payer_proof_key text
    constraint invoices_payer_proof_key_check
    check (payer_proof_key ~ '^payments/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$');

-- Replaces submit_payment(bigint, text, text): the transaction ID becomes optional when a screenshot is sent.
drop function if exists public.submit_payment(bigint, text, text);

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
revoke execute on function public.submit_payment(bigint, text, text, text) from public, anon;
grant execute on function public.submit_payment(bigint, text, text, text) to authenticated;
