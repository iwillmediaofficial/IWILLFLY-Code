import type { Festival, PlacementKind, RequestStatus, ReviewStatus } from '../../lib/types';
import { todayIST } from '../format';

/** "2026-10-05" -> "5 Oct" */
export function shortDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** 1234 -> "1,234" */
export const num = (n: number) => n.toLocaleString('en-IN');

/** Taps per view as a percentage, or a dash when nothing was viewed. */
export function tapRate(clicks: number, views: number) {
  if (!views) return '–';
  const pct = (clicks / views) * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/** The last day vendors can submit offers to a festival. */
export const submissionsCloseOn = (f: Festival) => f.submissions_close_on ?? f.ends_on;

export const festivalOpen = (f: Festival, today = todayIST()) => submissionsCloseOn(f) >= today;

export const reviewLabel: Record<ReviewStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const reviewClass: Record<ReviewStatus, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

export const requestLabel: Record<RequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};

export const requestClass: Record<RequestStatus, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: '',
};

export const kindInfo: Record<PlacementKind, { label: string; hint: string }> = {
  featured_offer: {
    label: 'Featured offer',
    hint: 'Your offer gets the Featured badge and shows first in lists. Featured as soon as it is approved.',
  },
  home_banner: {
    label: 'Home page banner',
    hint: 'A slide for your shop in the ad slider at the top of the IWILLFLY home page.',
  },
  festival_spotlight: {
    label: 'Festival spotlight',
    hint: 'Your offer highlighted at the top of a festival page while the festival runs.',
  },
};
