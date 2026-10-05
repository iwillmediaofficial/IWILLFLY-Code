import { useQuery } from '@tanstack/react-query';
import { db, must } from '../lib/queries';
import { supabase } from '../lib/supabase';

/** Row from admin_vendor_directory(): a vendor's owner contact details and counts. */
export interface VendorOwnerRow {
  vendor_id: number;
  owner_id: string;
  owner_email: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_since: string;
  shop_count: number;
  offer_count: number;
  staff_count: number;
  invoice_count: number;
}

export const DIRECTORY_KEY = ['admin', 'vendor-directory'];

/** Owner details for every vendor, keyed by vendor id. */
export function useVendorDirectory() {
  return useQuery({
    queryKey: DIRECTORY_KEY,
    queryFn: async () => {
      const rows = must<VendorOwnerRow[]>(await db().rpc('admin_vendor_directory'));
      return new Map(rows.map((r) => [r.vendor_id, r]));
    },
  });
}

/** Calls a super-admin endpoint on the Worker (worker/adminVendors.ts) with the signed-in user's token. */
export async function adminApi<T>(path: string, body: unknown): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error('Please sign in again');
  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !out) {
    if (res.status === 404 && !out)
      throw new Error(
        'The server part is not running. Locally, use `npx wrangler dev` (http://localhost:8787).',
      );
    throw new Error(out?.error || `Request failed (${res.status})`);
  }
  return out;
}
