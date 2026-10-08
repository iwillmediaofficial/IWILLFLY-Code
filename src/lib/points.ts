import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { db, must } from './queries';
import { supabase } from './supabase';
import type { MyBill, MyUpi, PointsEntry, PointsShop, PointsWallet, Redemption } from './types';
import { photoWebp, sendWebp } from './upload';

export const POINTS_KEYS = [['points_wallet'], ['my_bills'], ['my_points_history']];

/** The signed-in customer's balance, rules and pending bills. */
export function usePointsWallet() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['points_wallet', session?.user.id ?? null],
    queryFn: async () => must<PointsWallet>(await db().rpc('points_wallet')),
    enabled: Boolean(supabase && session),
  });
}

export function useMyBills() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my_bills', session?.user.id ?? null],
    queryFn: async () => must<MyBill[]>(await db().rpc('my_bills')),
    enabled: Boolean(supabase && session),
  });
}

export function usePointsHistory() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my_points_history', session?.user.id ?? null],
    queryFn: async () => must<PointsEntry[]>(await db().rpc('my_points_history', { p_limit: 200 })),
    enabled: Boolean(supabase && session),
  });
}

/** Live shops matching the typed name, for the "Which shop?" picker. */
export function usePointsShops(q: string) {
  return useQuery({
    queryKey: ['points_shops', q.trim().toLowerCase()],
    queryFn: async () => must<PointsShop[]>(await db().rpc('points_shops', { p_q: q.trim() || null })),
    enabled: Boolean(supabase),
    staleTime: 5 * 60_000,
  });
}

/** One live shop by id (when the add-bill page is opened from a shop page). */
export function usePointsShop(id: number | null) {
  return useQuery({
    queryKey: ['points_shop', id],
    queryFn: async () =>
      must<{ id: number; name: string; logo_key: string | null }[]>(
        await db().from('shops').select('id, name, logo_key').eq('id', id!).limit(1),
      )[0] ?? null,
    enabled: Boolean(supabase && id),
  });
}

export interface BillInput {
  shopId: number;
  billNumber: string;
  billDate: string;
  amount: number;
  /** a new photo, or keepPhotoKey to send a fixed bill with the photo it already had */
  photo: File | null;
  keepPhotoKey?: string | null;
  resubmitOf?: number | null;
}

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Phone photos only: JPG, PNG, WebP, HEIC. */
export function isPhoto(file: File) {
  return (
    /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  );
}

/**
 * Checks the bill first (so a bill that will be refused is never uploaded), then uploads the photo to the
 * private bill storage and adds the bill for checking. Returns the new bill's id.
 */
export async function submitBill(b: BillInput): Promise<number> {
  const args = {
    p_shop_id: b.shopId,
    p_bill_number: b.billNumber,
    p_bill_date: b.billDate,
    p_amount: b.amount,
    p_resubmit_of: b.resubmitOf ?? null,
  };
  must(await db().rpc('check_bill', args));
  if (!b.photo && b.keepPhotoKey)
    return must<number>(await db().rpc('submit_bill', { ...args, p_photo_key: b.keepPhotoKey }));
  const photo = b.photo;
  if (!photo || !isPhoto(photo)) throw new Error('Choose a photo of the bill (JPG, PNG, WebP or HEIC)');

  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in first');
  const [source, webp] = await Promise.all([
    sha256Hex(photo),
    photoWebp(photo).catch(() => {
      throw new Error('This photo could not be read. Try another photo of the bill.');
    }),
  ]);
  const key = await sendWebp(webp, 'bills', token);
  return must<number>(await db().rpc('submit_bill', { ...args, p_photo_key: key, p_source_sha256: source }));
}

export function useSubmitBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitBill,
    onSuccess: () => POINTS_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey })),
  });
}

/** A link to a bill photo that works for 10 minutes (admins: any bill; customers: their own). */
export async function billPhotoLink(key: string): Promise<string> {
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in first');
  const res = await fetch('/api/bills/photo-link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const out = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !out?.url) throw new Error(out?.error || `Could not open the photo (${res.status})`);
  return out.url;
}

export function useBillPhoto(key: string | null) {
  return useQuery({
    queryKey: ['bill_photo', key],
    queryFn: () => billPhotoLink(key!),
    enabled: Boolean(supabase && key),
    // links work for 10 minutes; fetch a fresh one before that
    staleTime: 8 * 60_000,
    gcTime: 8 * 60_000,
    retry: 1,
  });
}

export const REJECT_REASONS: Record<string, string> = {
  blurry: 'Photo is blurry or unreadable',
  wrong_shop: 'Bill is from another shop',
  duplicate: 'Bill was already added',
  amount_mismatch: 'Amount does not match the bill',
};

/** "₹1,23,456" or "₹99.50" */
export function rupees(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function pointsText(n: number) {
  return `${n.toLocaleString('en-IN')} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
}

/** Today's date in India as YYYY-MM-DD. */
export function todayIndia() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus n days. */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Cash-outs ---------------------------------------------------------------------------------------

export const REDEEM_KEYS = [['my_upi'], ['my_redemptions'], ...POINTS_KEYS];

export function useMyUpi() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my_upi', session?.user.id ?? null],
    queryFn: async () => must<MyUpi | null>(await db().rpc('my_upi')),
    enabled: Boolean(supabase && session),
  });
}

export function useMyRedemptions() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my_redemptions', session?.user.id ?? null],
    queryFn: async () => must<Redemption[]>(await db().rpc('my_redemptions')),
    enabled: Boolean(supabase && session),
  });
}

export function useSaveUpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (upi: string) => must<MyUpi>(await db().rpc('save_upi', { p_upi_id: upi })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my_upi'] }),
  });
}

export function useRequestRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (points: number) =>
      must<number>(await db().rpc('request_redemption', { p_points: points })),
    onSuccess: () => REDEEM_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey })),
  });
}

/** Same rule as the database: name@bank, bank starting with a letter. */
export function isUpiId(s: string) {
  return /^[a-z0-9._-]{2,200}@[a-z][a-z0-9]{1,63}$/.test(s.trim().toLowerCase());
}

/** "8 Oct, 11:59 PM" style, India time. */
export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
