import { json, userIdFor, type Env } from './env';
import { gatewayInvoiceOf as invoiceOf, gatewayRpc as rpc, indianMobile as mobile } from './gateway';

// Online payments with Instamojo (API v1.1, payment requests).
//
// The keys live only in the Worker's secrets (INSTAMOJO_API_KEY, INSTAMOJO_AUTH_TOKEN, INSTAMOJO_SALT); the
// browser never sees them and never says how much to pay. An invoice is marked paid only after this Worker has
// asked Instamojo itself that the payment is a Credit for the exact invoice amount (gateway_record_payment()
// checks the amount again). The redirect and the webhook both do that check, so whichever arrives first
// settles the invoice and the other finds it already done.

const LIVE_API = 'https://www.instamojo.com/api/1.1/';
const TIMEOUT_MS = 15_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Gateway = { base: string; key: string; token: string; salt: string };

function gateway(env: Env): Gateway | null {
  if (
    !env.INSTAMOJO_API_KEY ||
    !env.INSTAMOJO_AUTH_TOKEN ||
    !env.INSTAMOJO_SALT ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    return null;
  const base = env.INSTAMOJO_API_BASE || LIVE_API;
  // Only Instamojo's own servers, so a wrong setting can never send the keys elsewhere.
  if (!/^https:\/\/(www|test)\.instamojo\.com\/api\/1\.1\/$/.test(base)) return null;
  return { base, key: env.INSTAMOJO_API_KEY, token: env.INSTAMOJO_AUTH_TOKEN, salt: env.INSTAMOJO_SALT };
}

async function instamojo(g: Gateway, path: string, form?: Record<string, string>) {
  const res = await fetch(g.base + path, {
    method: form ? 'POST' : 'GET',
    headers: {
      'X-Api-Key': g.key,
      'X-Auth-Token': g.token,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok && body?.success === true, status: res.status, body };
}

type PaymentInfo = { payment_id?: string; status?: string; amount?: string; [k: string]: unknown };

/** Instamojo's own word on a payment request: the Credit payment in it, if any. */
async function creditPayment(g: Gateway, requestId: string, paymentId?: string): Promise<PaymentInfo | null> {
  if (paymentId) {
    const r = await instamojo(g, `payment-requests/${requestId}/${paymentId}/`);
    const p = (r.body?.payment_request as { payment?: PaymentInfo } | undefined)?.payment;
    return r.ok && p?.status === 'Credit' && p.payment_id === paymentId ? p : null;
  }
  const r = await instamojo(g, `payment-requests/${requestId}/`);
  const payments = (r.body?.payment_request as { payments?: unknown[] } | undefined)?.payments ?? [];
  const p = payments.find(
    (x): x is PaymentInfo => typeof x === 'object' && x !== null && (x as PaymentInfo).status === 'Credit',
  );
  return r.ok && p?.payment_id && ID.test(p.payment_id) ? p : null;
}

type Recorded = { result: 'paid' | 'already' | 'duplicate' | 'mismatch' | 'unknown'; invoice_id?: number };

/** Checks a payment request with Instamojo and, when it holds a Credit payment, marks its invoice paid. */
async function settle(env: Env, g: Gateway, requestId: string, paymentId?: string): Promise<Recorded | null> {
  const p = await creditPayment(g, requestId, paymentId);
  if (!p?.payment_id) return null;
  return rpc<Recorded>(env, 'gateway_record_payment', {
    p_request_id: requestId,
    p_payment_id: p.payment_id,
    p_amount: Number(p.amount),
    p_details: {
      amount: p.amount,
      fees: p.fees ?? null,
      currency: p.currency ?? null,
      instrument_type: p.instrument_type ?? null,
      billing_instrument: p.billing_instrument ?? null,
      created_at: p.created_at ?? null,
    },
  });
}

/**
 * POST /api/pay/instamojo/start  {invoice_id}  with the vendor owner's access token.
 * Returns {url} of the Instamojo payment page, or {paid: true} when an earlier payment page was already paid.
 */
export async function handleInstamojoStart(request: Request, env: Env): Promise<Response> {
  const g = gateway(env);
  if (!g) return json({ error: 'Online payment is not set up yet. Please contact IWILLFLY support.' }, 503);
  const uid = await userIdFor(request, env);
  if (uid === 'error') return json({ error: 'Could not verify account' }, 502);
  if (!uid) return json({ error: 'Session expired, sign in again' }, 401);
  const body = (await request.json().catch(() => null)) as { invoice_id?: unknown } | null;
  const invoiceId = Number(body?.invoice_id);
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return json({ error: 'Unknown invoice' }, 400);

  let inv: {
    number: string;
    amount: number | string;
    business_name: string;
    email: string | null;
    phone: string | null;
    reuse_url: string | null;
    open_requests: string[];
  };
  try {
    inv = await rpc(env, 'gateway_invoice_for', { p_invoice_id: invoiceId, p_user: uid });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Invoice not found' }, 400);
  }

  try {
    // A page opened earlier may have been paid while its redirect was lost: settle that instead of charging again.
    for (const rid of inv.open_requests.filter((r) => ID.test(r)).slice(-3)) {
      const done = await settle(env, g, rid);
      if (done && done.result !== 'mismatch' && done.result !== 'unknown') return json({ paid: true });
    }
    if (inv.reuse_url) return json({ url: inv.reuse_url });

    const origin = new URL(request.url).origin;
    const publicSite = origin.startsWith('https://') && !/\/\/(localhost|127\.)/.test(origin);
    const form: Record<string, string> = {
      amount: Number(inv.amount).toFixed(2),
      purpose: `IWILLFLY ${inv.number}`.slice(0, 30),
      buyer_name: inv.business_name.slice(0, 100),
      redirect_url: `${origin}/api/pay/instamojo/return`,
      allow_repeated_payments: 'false',
      send_email: 'false',
      send_sms: 'false',
    };
    // Instamojo cannot reach a computer's localhost; there the redirect alone settles the payment.
    if (publicSite) form.webhook = `${origin}/api/pay/instamojo/webhook`;
    if (inv.email && inv.email.length <= 75) form.email = inv.email;
    const phone = mobile(inv.phone);
    if (phone) form.phone = phone;

    let r = await instamojo(g, 'payment-requests/', form);
    // Phone and email are optional for Instamojo; if it refuses the ones on file, ask again without them.
    const refused = r.body?.message as Record<string, unknown> | undefined;
    if (!r.ok && refused && typeof refused === 'object' && ('phone' in refused || 'email' in refused)) {
      if ('phone' in refused) delete form.phone;
      if ('email' in refused) delete form.email;
      r = await instamojo(g, 'payment-requests/', form);
    }
    const pr = r.body?.payment_request as { id?: string; longurl?: string } | undefined;
    const url = pr?.longurl ? new URL(pr.longurl) : null;
    if (
      !r.ok ||
      !pr?.id ||
      !ID.test(pr.id) ||
      !url ||
      url.protocol !== 'https:' ||
      !/(^|\.)instamojo\.com$/.test(url.hostname)
    ) {
      console.error('instamojo create failed', r.status, JSON.stringify(r.body?.message ?? null));
      return json({ error: 'The payment page could not be opened. Please try again in a minute.' }, 502);
    }
    await rpc(env, 'gateway_payment_created', {
      p_invoice_id: invoiceId,
      p_request_id: pr.id,
      p_longurl: url.toString(),
      p_amount: Number(inv.amount),
      p_user: uid,
    });
    return json({ url: url.toString() });
  } catch (e) {
    console.error('instamojo start', e);
    return json({ error: 'The payment page could not be opened. Please try again in a minute.' }, 502);
  }
}

/**
 * GET /api/pay/instamojo/return?payment_id=…&payment_request_id=…&payment_status=…
 * Where Instamojo sends the buyer back. The query string is only a hint: the payment is checked with Instamojo.
 */
export async function handleInstamojoReturn(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = url.searchParams.get('payment_request_id') ?? '';
  const paymentId = url.searchParams.get('payment_id') ?? '';
  const go = (path: string) => Response.redirect(new URL(path, url.origin).toString(), 303);
  const g = gateway(env);
  if (!g || !ID.test(requestId)) return go('/vendor/billing');
  const invoiceId = await invoiceOf(env, requestId);
  if (!invoiceId) return go('/vendor/billing');
  const page = `/vendor/billing/invoices/${invoiceId}`;
  if (!paymentId || !ID.test(paymentId)) return go(`${page}?payment=failed`);
  try {
    const done = await settle(env, g, requestId, paymentId);
    if (!done)
      return go(
        `${page}?payment=${url.searchParams.get('payment_status') === 'Credit' ? 'pending' : 'failed'}`,
      );
    return go(
      `${page}?payment=${done.result === 'paid' || done.result === 'already' ? 'paid' : done.result}`,
    );
  } catch (e) {
    console.error('instamojo return', e);
    return go(`${page}?payment=pending`);
  }
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Instamojo's webhook MAC: HMAC-SHA1, keyed with the private salt, of the values sorted by field name, joined by "|". */
async function macOk(fields: [string, string][], mac: string, salt: string) {
  const message = fields
    .filter(([k]) => k !== 'mac')
    .sort(([a], [b]) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0))
    .map(([, v]) => v)
    .join('|');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  const given = mac.toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** POST /api/pay/instamojo/webhook  (form-encoded, from Instamojo). Signed with the salt, then checked with Instamojo. */
export async function handleInstamojoWebhook(request: Request, env: Env): Promise<Response> {
  const g = gateway(env);
  if (!g) return new Response('Not configured', { status: 503 });
  const form = await request.formData().catch(() => null);
  if (!form) return new Response('Bad request', { status: 400 });
  const fields = [...form.entries()].filter((e): e is [string, string] => typeof e[1] === 'string');
  const mac = form.get('mac');
  if (typeof mac !== 'string' || !(await macOk(fields, mac, g.salt)))
    return new Response('Bad signature', { status: 403 });
  const requestId = String(form.get('payment_request_id') ?? '');
  const paymentId = String(form.get('payment_id') ?? '');
  if (form.get('status') !== 'Credit' || !ID.test(requestId) || !ID.test(paymentId))
    return new Response('OK');
  try {
    await settle(env, g, requestId, paymentId);
    return new Response('OK');
  } catch (e) {
    console.error('instamojo webhook', e);
    // Instamojo retries failed webhooks.
    return new Response('Try again', { status: 500 });
  }
}
