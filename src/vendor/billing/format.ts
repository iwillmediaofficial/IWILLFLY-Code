import type { AddonKind, InvoiceStatus, Plan } from '../../lib/types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 123456.5 or "123456.50" -> "₹1,23,456.50" */
export function money(n: number | string | null | undefined) {
  return inr.format(Number(n ?? 0));
}

/** 30 -> "month", 365 -> "year", 45 -> "45 days" */
export function periodText(days: number) {
  if (days === 30 || days === 31) return 'month';
  if (days === 365 || days === 366) return 'year';
  if (days === 7) return 'week';
  if (days === 90 || days === 91) return '3 months';
  if (days === 180 || days === 182) return '6 months';
  return `${days} days`;
}

/** "Free" or "₹499.00 / month" */
export function planPrice(p: Pick<Plan, 'price' | 'period_days'>) {
  return Number(p.price) === 0 ? 'Free' : `${money(p.price)} / ${periodText(p.period_days)}`;
}

/** "Up to 3 shops", or "Unlimited shops" when there is no limit. */
export function limitText(max: number | null, one: string, many: string) {
  if (max == null) return `Unlimited ${many}`;
  return `Up to ${max} ${max === 1 ? one : many}`;
}

/** "1 of 3", or "1 · No limit" */
export function usageText(used: number, max: number | null) {
  return max == null ? `${used} · No limit` : `${used} of ${max}`;
}

/** Whole days from today to an ISO date (negative when it has passed). */
export function daysUntil(iso: string, today: string) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export const invoiceLabel: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  submitted: 'Payment submitted',
  paid: 'Paid',
  void: 'Cancelled',
};

export const invoiceClass: Record<InvoiceStatus, string> = {
  unpaid: 'rejected',
  submitted: 'pending',
  paid: 'live',
  void: '',
};

export const addonHint: Record<AddonKind, string> = {
  featured_shop: 'Your shop shows with the featured ones in search and lists.',
  promoted_offer: 'Your offer is marked Featured and shown first to customers.',
  banner_ad: 'A banner on the IWILLFLY home page. Our team sets it up with you after payment.',
};

/** upi://pay link that UPI apps (and their QR scanners) understand. */
export function upiLink(o: { upiId: string; payee: string; amount: number | string; note: string }) {
  const e = encodeURIComponent;
  return `upi://pay?pa=${e(o.upiId)}&pn=${e(o.payee)}&am=${Number(o.amount).toFixed(2)}&cu=INR&tn=${e(o.note)}`;
}
