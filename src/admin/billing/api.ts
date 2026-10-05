import { useQuery, type QueryKey } from '@tanstack/react-query';
import { db, must } from '../../lib/queries';
import type {
  Addon,
  AddonKind,
  AddonPurchase,
  BillingSettings,
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  Plan,
  PurchaseItem,
  Subscription,
} from '../../lib/types';

/** Every admin billing query key starts with this, so one invalidate refreshes them all. */
export const BILL_KEY = 'admin-billing';

/** Keys to refresh after a billing change: these screens, the dashboard counts and featured lists. */
export const BILL_KEYS: QueryKey[] = [
  [BILL_KEY],
  ['admin_stats'],
  ['admin-attention'],
  ['search_offers'],
  ['search_shops'],
  ['admin', 'offers'],
];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 499 -> "₹499.00". numeric columns can arrive as strings. */
export function money(v: number | string | null | undefined) {
  return inr.format(Number(v ?? 0));
}

export const ADDON_LABEL: Record<AddonKind, string> = {
  featured_shop: 'Featured shop',
  promoted_offer: 'Promoted offer',
  banner_ad: 'Home banner ad',
};

export const ADDON_HELP: Record<AddonKind, string> = {
  featured_shop: 'The shop ranks with featured shops while it runs.',
  promoted_offer: 'The offer is featured while it runs.',
  banner_ad: 'You create the banner by hand in Home ads after payment.',
};

export const INVOICE_STATUS: Record<InvoiceStatus, { text: string; cls: string }> = {
  unpaid: { text: 'Unpaid', cls: '' },
  submitted: { text: 'Needs checking', cls: 'pending' },
  paid: { text: 'Paid', cls: 'approved' },
  void: { text: 'Cancelled', cls: 'rejected' },
};

export const PAY_METHODS: { key: 'upi' | 'cash' | 'bank' | 'razorpay'; label: string }[] = [
  { key: 'upi', label: 'UPI' },
  { key: 'bank', label: 'Bank transfer' },
  { key: 'cash', label: 'Cash' },
  { key: 'razorpay', label: 'Razorpay' },
];

/** Whole days from today (India) to `day`; negative when it has passed. */
export function daysUntil(day: string, today: string) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export function endsInWords(day: string, today: string) {
  const n = daysUntil(day, today);
  if (n < 0) return 'ended';
  if (n === 0) return 'ends today';
  if (n === 1) return 'ends tomorrow';
  return `ends in ${n} days`;
}

// Settings -----------------------------------------------------------------------------------------

export function useBillingSettings() {
  return useQuery({
    queryKey: [BILL_KEY, 'settings'],
    queryFn: async () =>
      must<BillingSettings>(await db().from('billing_settings').select('*').eq('id', 1).single()),
  });
}

export type SettingsInput = Omit<BillingSettings, 'id' | 'updated_at'>;

export async function saveSettings(row: SettingsInput) {
  must(await db().from('billing_settings').update(row).eq('id', 1));
}

// Catalogue ----------------------------------------------------------------------------------------

export function usePlans() {
  return useQuery({
    queryKey: [BILL_KEY, 'plans'],
    queryFn: async () =>
      must<Plan[]>(await db().from('plans').select('*').order('sort_order').order('price')),
  });
}

export type PlanInput = Omit<Plan, 'id'>;

export async function savePlan(id: number | null, row: PlanInput) {
  if (id != null) must(await db().from('plans').update(row).eq('id', id));
  else must(await db().from('plans').insert(row));
}

export async function deletePlan(id: number) {
  must(await db().from('plans').delete().eq('id', id));
}

export function useAddons() {
  return useQuery({
    queryKey: [BILL_KEY, 'addons'],
    queryFn: async () =>
      must<Addon[]>(await db().from('addons').select('*').order('sort_order').order('price')),
  });
}

export type AddonInput = Omit<Addon, 'id'>;

export async function saveAddon(id: number | null, row: AddonInput) {
  if (id != null) must(await db().from('addons').update(row).eq('id', id));
  else must(await db().from('addons').insert(row));
}

export async function deleteAddon(id: number) {
  must(await db().from('addons').delete().eq('id', id));
}

// Invoices -----------------------------------------------------------------------------------------

export type InvoiceFilter = 'submitted' | 'unpaid' | 'paid' | 'void' | 'all';

export function useInvoices(filter: InvoiceFilter) {
  return useQuery({
    queryKey: [BILL_KEY, 'invoices', filter],
    queryFn: async () => {
      let q = db()
        .from('invoices')
        .select('*')
        .order(filter === 'submitted' ? 'submitted_at' : 'created_at', {
          ascending: filter === 'submitted',
        })
        .limit(200);
      if (filter !== 'all') q = q.eq('status', filter);
      return must<Invoice[]>(await q);
    },
  });
}

export type InvoiceWithItems = Invoice & { invoice_items: InvoiceItem[] };

export function useInvoice(id: number | null) {
  return useQuery({
    queryKey: [BILL_KEY, 'invoice', id],
    queryFn: async () => {
      const inv = must<InvoiceWithItems>(
        await db().from('invoices').select('*, invoice_items(*)').eq('id', id!).single(),
      );
      inv.invoice_items.sort((a, b) => a.id - b.id);
      return inv;
    },
    enabled: id != null,
  });
}

export async function markPaid(id: number, method: string, ref: string | null, paidOn: string | null) {
  must(
    await db().rpc('mark_invoice_paid', {
      p_invoice_id: id,
      p_method: method,
      p_ref: ref,
      p_paid_on: paidOn,
    }),
  );
}

export async function voidInvoice(id: number, reason: string) {
  must(await db().rpc('void_invoice', { p_invoice_id: id, p_reason: reason }));
}

export async function createInvoice(vendorId: number, items: PurchaseItem[]) {
  return Number(must<number>(await db().rpc('create_invoice', { p_items: items, p_vendor_id: vendorId })));
}

// Bill a vendor ------------------------------------------------------------------------------------

export type VendorRef = { id: number; business_name: string; status: string };

export function useBillableVendors() {
  return useQuery({
    queryKey: [BILL_KEY, 'vendors'],
    queryFn: async () =>
      must<VendorRef[]>(
        await db()
          .from('vendors')
          .select('id, business_name, status')
          .neq('status', 'blocked')
          .order('business_name'),
      ),
  });
}

export type VendorShop = {
  id: number;
  name: string;
  offers: { id: number; title: string; status: string }[];
};

export function useVendorShops(vendorId: number | null) {
  return useQuery({
    queryKey: [BILL_KEY, 'vendor-shops', vendorId],
    queryFn: async () =>
      must<VendorShop[]>(
        await db()
          .from('shops')
          .select('id, name, offers(id, title, status)')
          .eq('vendor_id', vendorId!)
          .order('name'),
      ),
    enabled: vendorId != null,
  });
}

// Running purchases --------------------------------------------------------------------------------

type Ref<T> = T | T[] | null;

export type SubscriptionRow = Subscription & {
  vendor: Ref<{ business_name: string }>;
  plan: Ref<{ name: string }>;
};

export type PurchaseRow = AddonPurchase & {
  vendor: Ref<{ business_name: string }>;
  addon: Ref<{ name: string }>;
  shop: Ref<{ name: string }>;
  offer: Ref<{ title: string }>;
};

/** running: not cancelled and not ended yet (includes paid time queued for later). */
export function useSubscriptions(running: boolean, today: string) {
  return useQuery({
    queryKey: [BILL_KEY, 'subscriptions', running, today],
    queryFn: async () => {
      let q = db()
        .from('subscriptions')
        .select('*, vendor:vendors(business_name), plan:plans(name)')
        .limit(200);
      q = running
        ? q.is('cancelled_at', null).gte('ends_on', today).order('ends_on')
        : q.or(`cancelled_at.not.is.null,ends_on.lt.${today}`).order('ends_on', { ascending: false });
      return must<SubscriptionRow[]>(await q);
    },
  });
}

export function usePurchases(running: boolean, today: string) {
  return useQuery({
    queryKey: [BILL_KEY, 'purchases', running, today],
    queryFn: async () => {
      let q = db()
        .from('addon_purchases')
        .select('*, vendor:vendors(business_name), addon:addons(name), shop:shops(name), offer:offers(title)')
        .limit(200);
      q = running
        ? q.is('cancelled_at', null).gte('ends_on', today).order('ends_on')
        : q.or(`cancelled_at.not.is.null,ends_on.lt.${today}`).order('ends_on', { ascending: false });
      return must<PurchaseRow[]>(await q);
    },
  });
}

export async function updateRunning(
  table: 'subscriptions' | 'addon_purchases',
  id: number,
  patch: { cancelled_at?: string; ends_on?: string },
) {
  must(await db().from(table).update(patch).eq('id', id));
}

/** Postgres errors in words an admin can act on. */
export function billError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/plans_one_default_idx|duplicate key/i.test(msg))
    return 'Only one plan can be the free default. Untick it on the other plan first.';
  if (/foreign key/i.test(msg))
    return 'This has already been bought, so it cannot be deleted. Switch it off instead (untick “Can be bought”).';
  if (/upi_id/i.test(msg)) return 'Enter a UPI ID like name@bank.';
  if (/gstin/i.test(msg)) return 'A GSTIN is 15 capital letters and numbers.';
  if (/invoice_prefix/i.test(msg)) return 'The invoice prefix may use 1 to 8 capital letters and numbers.';
  if (/ends_on/i.test(msg)) return 'The end date cannot be before the start date.';
  if (/violates check constraint/i.test(msg)) return 'Some values are too long or out of range.';
  return msg;
}
