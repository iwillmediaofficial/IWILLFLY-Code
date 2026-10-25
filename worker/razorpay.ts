import { json, userIdFor, type Env } from './env';
import { gatewayInvoiceOf as invoiceOf, gatewayRpc as rpc, indianMobile as mobile } from './gateway';

// Online payments with Razorpay payment links (https://razorpay.com/docs/api/payments/payment-links/).
//
// The keys live only in the Worker's secrets (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET);
// the browser never sees them and never says how much to pay. The vendor pays on Razorpay's own page and comes
// back to /api/pay/razorpay/return. An invoice is marked paid only after this Worker has asked Razorpay itself
// that the link is paid and that the payment is captured, in INR, for the exact invoice amount
// (gateway_record_payment() checks the amount again). The return and the webhook both do that check, so
// whichever arrives first settles the invoice and the other finds it already done.

const API = 'https://api.razorpay.com/v1/';
const TIMEOUT_MS = 15_000;
const LINK_ID = /^plink_[A-Za-z0-9]{1,40}$/;
const PAY_ID = /^pay_[A-Za-z0-9]{1,40}$/;

type Gateway = { auth: string; webhookSecret?: string };

function gateway(env: Env): Gateway | null {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    auth: 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`),
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || undefined,
  };
}

async function razorpay(g: Gateway, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: g.auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const out = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok && !!out && !out.error, status: res.status, body: out };
}

type Payment = {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  order_id?: string;
  method?: string;
  fee?: number;
  tax?: number;
  created_at?: number;
};

/** Razorpay's own word on a payment link: its captured payment, if the link is paid. */
async function capturedPayment(g: Gateway, linkId: string, paymentId?: string): Promise<Payment | null> {
  const link = await razorpay(g, `payment_links/${linkId}`);
  const l = link.body as {
    status?: string;
    order_id?: string;
    payments?: { payment_id?: string; status?: string }[] | null;
  } | null;
  if (!link.ok || l?.status !== 'paid' || !l.order_id) return null;
  const id =
    paymentId ??
    (l.payments ?? []).find((p) => p.status === 'captured' && PAY_ID.test(p.payment_id ?? ''))?.payment_id;
  if (!id || !PAY_ID.test(id)) return null;
  const pay = await razorpay(g, `payments/${id}`);
  const p = pay.body as Payment | null;
  // The payment must be this link's own (same order), captured, in rupees.
  return pay.ok &&
    p?.id === id &&
    p.status === 'captured' &&
    p.currency === 'INR' &&
    p.order_id === l.order_id
    ? p
    : null;
}

type Recorded = { result: 'paid' | 'already' | 'duplicate' | 'mismatch' | 'unknown'; invoice_id?: number };

/** Checks a payment link with Razorpay and, when it is paid, marks its invoice paid. */
async function settle(env: Env, g: Gateway, linkId: string, paymentId?: string): Promise<Recorded | null> {
  const p = await capturedPayment(g, linkId, paymentId);
  if (!p?.id || typeof p.amount !== 'number') return null;
  return rpc<Recorded>(env, 'gateway_record_payment', {
    p_request_id: linkId,
    p_payment_id: p.id,
    // Razorpay counts in paise.
    p_amount: p.amount / 100,
    p_details: {
      amount: p.amount / 100,
      fee: typeof p.fee === 'number' ? p.fee / 100 : null,
      tax: typeof p.tax === 'number' ? p.tax / 100 : null,
      currency: p.currency ?? null,
      method: p.method ?? null,
      order_id: p.order_id ?? null,
      created_at: p.created_at ?? null,
    },
  });
}

/**
 * POST /api/pay/razorpay/start  {invoice_id}  with the vendor owner's access token.
 * Returns {url} of the Razorpay payment page, or {paid: true} when an earlier payment page was already paid.
 */
export async function handleRazorpayStart(request: Request, env: Env): Promise<Response> {
  const g = gateway(env);
  if (!g) return json({ error: 'Razorpay payment is not set up yet. Please contact IWILLFLY support.' }, 503);
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
    inv = await rpc(env, 'gateway_invoice_for', {
      p_invoice_id: invoiceId,
      p_user: uid,
      p_provider: 'razorpay',
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Invoice not found' }, 400);
  }

  try {
    // A page opened earlier may have been paid while its return was lost: settle that instead of charging again.
    for (const id of inv.open_requests.filter((r) => LINK_ID.test(r)).slice(-3)) {
      const done = await settle(env, g, id);
      if (done && done.result !== 'mismatch' && done.result !== 'unknown') return json({ paid: true });
    }
    if (inv.reuse_url) return json({ url: inv.reuse_url });

    const origin = new URL(request.url).origin;
    const paise = Math.round(Number(inv.amount) * 100);
    const customer: Record<string, string> = { name: inv.business_name.slice(0, 100) };
    if (inv.email && inv.email.length <= 75) customer.email = inv.email;
    const phone = mobile(inv.phone);
    if (phone) customer.contact = `+91${phone}`;
    const link = {
      amount: paise,
      currency: 'INR',
      accept_partial: false,
      description: `IWILLFLY invoice ${inv.number}`.slice(0, 2048),
      // Unique for every link, as Razorpay asks.
      reference_id: `${inv.number}-${Date.now().toString(36)}`.slice(0, 40),
      // A little longer than the 20 minutes a page is offered again.
      expire_by: Math.floor(Date.now() / 1000) + 40 * 60,
      customer,
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { invoice_id: String(invoiceId), invoice_number: inv.number },
      callback_url: `${origin}/api/pay/razorpay/return`,
      callback_method: 'get',
    };

    let r = await razorpay(g, 'payment_links', link);
    // Phone and email are optional; if Razorpay refuses the ones on file, ask again without them.
    if (!r.ok && r.status === 400 && (customer.contact || customer.email)) {
      link.customer = { name: customer.name };
      r = await razorpay(g, 'payment_links', link);
    }
    const pl = r.body as { id?: string; short_url?: string } | null;
    const url = pl?.short_url ? new URL(pl.short_url) : null;
    if (
      !r.ok ||
      !pl?.id ||
      !LINK_ID.test(pl.id) ||
      !url ||
      url.protocol !== 'https:' ||
      !/(^|\.)(rzp\.io|razorpay\.com)$/.test(url.hostname)
    ) {
      console.error('razorpay create failed', r.status, JSON.stringify(r.body?.error ?? null));
      return json({ error: 'The payment page could not be opened. Please try again in a minute.' }, 502);
    }
    await rpc(env, 'gateway_payment_created', {
      p_invoice_id: invoiceId,
      p_request_id: pl.id,
      p_longurl: url.toString(),
      p_amount: Number(inv.amount),
      p_user: uid,
      p_provider: 'razorpay',
    });
    return json({ url: url.toString() });
  } catch (e) {
    console.error('razorpay start', e);
    return json({ error: 'The payment page could not be opened. Please try again in a minute.' }, 502);
  }
}

/**
 * GET /api/pay/razorpay/return?razorpay_payment_id=…&razorpay_payment_link_id=…&razorpay_payment_link_status=…
 * Where Razorpay sends the buyer back. The query string is only a hint: the payment is checked with Razorpay.
 */
export async function handleRazorpayReturn(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const linkId = url.searchParams.get('razorpay_payment_link_id') ?? '';
  const paymentId = url.searchParams.get('razorpay_payment_id') ?? '';
  const go = (path: string) => Response.redirect(new URL(path, url.origin).toString(), 303);
  const g = gateway(env);
  if (!g || !LINK_ID.test(linkId)) return go('/vendor/billing');
  const invoiceId = await invoiceOf(env, linkId);
  if (!invoiceId) return go('/vendor/billing');
  const page = `/vendor/billing/invoices/${invoiceId}`;
  if (!PAY_ID.test(paymentId)) return go(`${page}?payment=failed`);
  try {
    const done = await settle(env, g, linkId, paymentId);
    if (!done)
      return go(
        `${page}?payment=${url.searchParams.get('razorpay_payment_link_status') === 'paid' ? 'pending' : 'failed'}`,
      );
    return go(
      `${page}?payment=${done.result === 'paid' || done.result === 'already' ? 'paid' : done.result}`,
    );
  } catch (e) {
    console.error('razorpay return', e);
    return go(`${page}?payment=pending`);
  }
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Razorpay's webhook signature: HMAC-SHA256 of the raw body, keyed with the webhook secret, in hex. */
async function signatureOk(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const given = signature.toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** POST /api/pay/razorpay/webhook  (JSON, from Razorpay, event payment_link.paid). Signed, then checked with Razorpay. */
export async function handleRazorpayWebhook(request: Request, env: Env): Promise<Response> {
  const g = gateway(env);
  if (!g?.webhookSecret) return new Response('Not configured', { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get('X-Razorpay-Signature') ?? '';
  if (!signature || !(await signatureOk(raw, signature, g.webhookSecret)))
    return new Response('Bad signature', { status: 403 });
  let event: {
    event?: string;
    payload?: { payment_link?: { entity?: { id?: string } }; payment?: { entity?: { id?: string } } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const linkId = event.payload?.payment_link?.entity?.id ?? '';
  const paymentId = event.payload?.payment?.entity?.id ?? '';
  if (event.event !== 'payment_link.paid' || !LINK_ID.test(linkId) || !PAY_ID.test(paymentId))
    return new Response('OK');
  try {
    await settle(env, g, linkId, paymentId);
    return new Response('OK');
  } catch (e) {
    console.error('razorpay webhook', e);
    // Razorpay retries webhooks that do not answer 2xx.
    return new Response('Try again', { status: 500 });
  }
}
