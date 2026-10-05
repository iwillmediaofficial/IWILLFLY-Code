import type { ClaimStatus, ScratchCampaign } from '../../lib/types';
import { formatTime } from '../../lib/scratch';
import { formatDate, todayIST } from '../format';

/**
 * The 8-character claim code from a scanned QR or typed text: accepts "IWILLFLY:ABCD2345",
 * "abcd-2345" or "ABCD 2345". Returns null when it can't be a claim code.
 */
export function parseClaimCode(raw: string): string | null {
  let s = raw.trim().toUpperCase();
  if (s.startsWith('IWILLFLY:')) s = s.slice('IWILLFLY:'.length);
  s = s.replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8}$/.test(s) ? s : null;
}

/** "2026-10-05T10:30:00Z" -> "5 Oct, 4:00 pm" in India time */
export function formatDateTime(ts: string | null | undefined) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export const claimLabel: Record<ClaimStatus, string> = {
  unclaimed: 'Waiting',
  claimed: 'Handed over',
  expired: 'Expired',
};

export const claimClass: Record<ClaimStatus, string> = {
  unclaimed: 'pending',
  claimed: 'live',
  expired: '',
};

/** "5 Oct 2026 – no end date · 9:00 AM–10:00 PM" */
export function campaignWhen(c: ScratchCampaign) {
  const dates = `${formatDate(c.starts_on)} – ${c.ends_on ? formatDate(c.ends_on) : 'no end date'}`;
  return `${dates} · ${formatTime(c.active_from)}–${formatTime(c.active_to)}`;
}

export type CampaignPhase = 'running' | 'scheduled' | 'ended' | 'off';

export function campaignPhase(c: ScratchCampaign, today = todayIST()): CampaignPhase {
  if (!c.is_active) return 'off';
  if (c.starts_on > today) return 'scheduled';
  if (c.ends_on && c.ends_on < today) return 'ended';
  return 'running';
}

export const campaignPhaseLabel: Record<CampaignPhase, string> = {
  running: 'Running',
  scheduled: 'Starts soon',
  ended: 'Ended',
  off: 'Switched off',
};

export const campaignPhaseClass: Record<CampaignPhase, string> = {
  running: 'live',
  scheduled: 'approved',
  ended: '',
  off: '',
};
