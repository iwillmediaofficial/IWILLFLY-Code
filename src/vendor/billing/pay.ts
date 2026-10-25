import { supabase } from '../../lib/supabase';

export type Gateway = 'razorpay' | 'instamojo';

/**
 * Opens the Razorpay or Instamojo payment page for an invoice (the Worker works out the amount from the invoice).
 * Resolves 'paid' when an earlier payment page turned out to be paid already; otherwise the browser leaves.
 */
export async function payOnline(invoiceId: number, gateway: Gateway): Promise<'paid' | 'leaving'> {
  if (!supabase) throw new Error('Supabase is not configured');
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('Please sign in again');
  const res = await fetch(`/api/pay/${gateway}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice_id: invoiceId }),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach IWILLFLY. Please check your internet connection.');
  const out = (await res.json().catch(() => null)) as { url?: string; paid?: boolean; error?: string } | null;
  if (out?.paid) return 'paid';
  if (!res.ok || !out?.url) throw new Error(out?.error || `Payment could not start (${res.status})`);
  window.location.assign(out.url);
  return 'leaving';
}
