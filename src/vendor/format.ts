import { DAYS, nowIST } from '../lib/hours';
import type { Hours, Offer } from '../lib/types';

/** "2026-10-05" -> "5 Oct 2026" */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const todayIST = () => nowIST().date;

/** Trimmed text, or null when empty, ready for a nullable column. */
export const orNull = (s: string) => s.trim() || null;

/** A friendly message when an optional phone number looks wrong, else null. */
export function phoneError(value: string, label = 'Phone') {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 20 || !/^\+?[\d\s-]{6,}$/.test(v))
    return `${label}: enter digits only, like +91 98765 43210`;
  return null;
}

/** "40% OFF" from the two prices, or '' when they do not give a discount. */
export function suggestDiscount(original: number | null, offer: number | null) {
  if (original == null || offer == null || original <= 0 || offer >= original) return '';
  const pct = Math.round((1 - offer / original) * 100);
  return pct > 0 ? `${pct}% OFF` : '';
}

export type OfferPhase = 'pending' | 'rejected' | 'paused' | 'scheduled' | 'ended' | 'live';

/** What a customer would see for this offer right now (ignoring whether the vendor itself is approved). */
export function offerPhase(o: Offer, today = todayIST()): OfferPhase {
  if (o.status === 'pending') return 'pending';
  if (o.status === 'rejected') return 'rejected';
  if (o.is_paused) return 'paused';
  if (o.starts_on > today) return 'scheduled';
  if (o.ends_on && o.ends_on < today) return 'ended';
  return 'live';
}

export const phaseLabel: Record<OfferPhase, string> = {
  pending: 'In review',
  rejected: 'Rejected',
  paused: 'Paused',
  scheduled: 'Scheduled',
  ended: 'Ended',
  live: 'Live',
};

/** The pill-status modifier class for a phase. */
export const phaseClass: Record<OfferPhase, string> = {
  pending: 'pending',
  rejected: 'rejected',
  paused: '',
  scheduled: 'approved',
  ended: '',
  live: 'live',
};

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

/** A friendly message for the first day with a missing or zero-length time range, else null. */
export function hoursError(hours: Hours) {
  for (const { key, label } of DAYS) {
    const d = hours[key];
    if (!d) continue;
    if (!d.open || !d.close) return `${label}: enter both opening and closing times, or tick Closed.`;
    if (d.open === d.close) return `${label}: opening and closing times can't be the same.`;
  }
  return null;
}
