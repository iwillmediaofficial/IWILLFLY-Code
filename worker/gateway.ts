import type { Env } from './env';

// Shared by the online payment gateways (worker/instamojo.ts, worker/razorpay.ts).

const TIMEOUT_MS = 15_000;

/** Calls one of the gateway_* database functions with the service role (they are closed to everyone else). */
export async function gatewayRpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as T & { message?: string };
  if (!res.ok) throw new Error(body?.message || `Database error (${res.status})`);
  return body;
}

/** The invoice a payment request belongs to (service role read). */
export async function gatewayInvoiceOf(env: Env, requestId: string): Promise<number | null> {
  const res = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/gateway_payments?select=invoice_id&request_id=eq.${encodeURIComponent(requestId)}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  ).catch(() => null);
  const rows = res?.ok ? ((await res.json()) as { invoice_id: number }[]) : [];
  return rows[0]?.invoice_id ?? null;
}

/** Indian mobile number (10 digits, without +91), or undefined. */
export function indianMobile(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/[^\d]/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : undefined;
}
