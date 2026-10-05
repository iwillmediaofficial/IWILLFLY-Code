import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type {
  Addon,
  BillingSettings,
  Invoice,
  InvoiceItem,
  MyBilling,
  Plan,
  PurchaseItem,
} from '../../lib/types';
import { VENDOR_KEY } from '../api';
import { useVendor, useVendorRole } from '../context';

/** Current plan, usage and running add-ons. my_billing() refuses blocked businesses, so it is skipped then. */
export function useMyBilling() {
  const vendor = useVendor();
  return useQuery({
    queryKey: ['vendor', 'billing', 'me', vendor.id],
    queryFn: async () => must<MyBilling>(await db().rpc('my_billing')),
    enabled: vendor.status !== 'blocked',
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ['vendor', 'billing', 'plans'],
    queryFn: async () =>
      must<Plan[]>(
        await db()
          .from('plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order')
          .order('price', { ascending: true }),
      ),
  });
}

export function useAddons() {
  return useQuery({
    queryKey: ['vendor', 'billing', 'addons'],
    queryFn: async () =>
      must<Addon[]>(
        await db().from('addons').select('*').eq('is_active', true).order('sort_order').order('id'),
      ),
  });
}

export function useBillingSettings() {
  return useQuery({
    queryKey: ['vendor', 'billing', 'settings'],
    queryFn: async () =>
      must<BillingSettings | null>(await db().from('billing_settings').select('*').eq('id', 1).maybeSingle()),
  });
}

/** Owner only (RLS hides invoices from managers and staff). */
export function useInvoices() {
  const vendor = useVendor();
  const { isOwner } = useVendorRole();
  return useQuery({
    queryKey: ['vendor', 'billing', 'invoices', vendor.id],
    queryFn: async () =>
      must<Invoice[]>(
        await db()
          .from('invoices')
          .select('*')
          .eq('vendor_id', vendor.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ),
    enabled: isOwner,
  });
}

export function useInvoice(id: number) {
  return useQuery({
    queryKey: ['vendor', 'billing', 'invoice', id],
    queryFn: async () => {
      const invoice = must<Invoice | null>(
        await db().from('invoices').select('*').eq('id', id).maybeSingle(),
      );
      const items = invoice
        ? must<InvoiceItem[]>(
            await db()
              .from('invoice_items')
              .select('*')
              .eq('invoice_id', id)
              .order('id', { ascending: true }),
          )
        : [];
      return { invoice, items };
    },
    enabled: Number.isFinite(id),
  });
}

/** Creates an invoice for plans or add-ons and returns its id. */
export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: PurchaseItem[]) =>
      must<number>(await db().rpc('create_invoice', { p_items: items })),
    // a free item is switched on straight away, so refresh everything
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDOR_KEY }),
  });
}

export function useSubmitPayment(invoiceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { ref: string; note: string | null }) =>
      must(await db().rpc('submit_payment', { p_invoice_id: invoiceId, p_ref: p.ref, p_note: p.note })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor', 'billing'] }),
  });
}
