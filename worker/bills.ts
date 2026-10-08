import { isWebp, json, rolesFor, userIdFor, type Env } from './env';
import { MAX_BYTES } from './upload';

// Customers' bill photos for points. They go to the private BILLS bucket (no public URL), under
// bills/<customer id>/<sha256 of the file>.webp. The database reads the fingerprint for its duplicate-photo
// check from that key, which only this Worker writes. Admins (and the customer, for their own bills) view a
// photo through a signed link that works for 10 minutes. Photos are deleted 90 days after the bill is decided.

const KEY_RE = /^bills\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/;
const ADMIN_ROLES = ['admin', 'super_admin'];
const LINK_SECONDS = 600;
const UPLOADS_PER_HOUR = 20;

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** HMAC key for photo links, derived from the service-role key so no extra secret is needed. */
async function linkKey(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`iwillfly bill photo links:${env.SUPABASE_SERVICE_ROLE_KEY}`),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** POST /api/upload?folder=bills (called from handleUpload): any signed-in customer, WebP only. */
export async function handleBillUpload(request: Request, env: Env): Promise<Response> {
  if (!env.BILLS) return json({ error: 'Bill photo storage is not connected to the app' }, 500);
  const uid = await userIdFor(request, env);
  if (uid === null) return json({ error: 'Session expired, sign in again' }, 401);
  if (uid === 'error') return json({ error: 'Could not verify account' }, 502);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: 'Empty image' }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: 'Image too large' }, 413);
  if (!isWebp(body)) return json({ error: 'This file is not an image' }, 415);

  const key = `bills/${uid}/${hex(await crypto.subtle.digest('SHA-256', body))}.webp`;
  // the same photo again: nothing new to store
  if (await env.BILLS.head(key)) return json({ key });

  // Slow down repeated uploads from one account.
  const since = Date.now() - 3600_000;
  let recent = 0;
  let cursor: string | undefined;
  do {
    const page = await env.BILLS.list({ prefix: `bills/${uid}/`, cursor, limit: 1000 });
    recent += page.objects.filter((o) => o.uploaded.getTime() > since).length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && recent < UPLOADS_PER_HOUR);
  if (recent >= UPLOADS_PER_HOUR)
    return json({ error: 'Too many bill photos in the last hour. Please try again later.' }, 429);

  await env.BILLS.put(key, body, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
  });
  return json({ key });
}

/**
 * POST /api/bills/photo-link  { key }  ->  { url }
 * A link to one bill photo that works for 10 minutes. Admins may open any bill; customers only their own.
 */
export async function handlePhotoLink(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!KEY_RE.test(key)) return json({ error: 'Bad request' }, 400);
  const hmac = await linkKey(env);
  if (!hmac) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set for the Worker' }, 500);

  const uid = await userIdFor(request, env);
  if (uid === null) return json({ error: 'Session expired, sign in again' }, 401);
  if (uid === 'error') return json({ error: 'Could not verify account' }, 502);
  if (!key.startsWith(`bills/${uid}/`)) {
    const roles = await rolesFor(request, env);
    if (roles === null) return json({ error: 'Session expired, sign in again' }, 401);
    if (roles === 'error') return json({ error: 'Could not verify account' }, 502);
    if (!roles.some((r) => ADMIN_ROLES.includes(r))) return json({ error: 'Not allowed' }, 403);
  }

  const exp = Math.floor(Date.now() / 1000) + LINK_SECONDS;
  const sig = b64url(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(`${key}|${exp}`)));
  const q = new URLSearchParams({ k: key, e: String(exp), s: sig });
  return json({ url: `/api/bills/photo?${q}`, expires_at: new Date(exp * 1000).toISOString() });
}

/** GET /api/bills/photo?k=&e=&s=  serves the photo while the signed link is valid. */
export async function handlePhoto(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const key = q.get('k') ?? '';
  const exp = Number(q.get('e'));
  const sig = fromB64url(q.get('s') ?? '');
  const hmac = await linkKey(env);
  if (!env.BILLS || !hmac || !KEY_RE.test(key) || !Number.isInteger(exp) || !sig)
    return new Response('Not found', { status: 404 });
  if (exp < Date.now() / 1000) return new Response('This link has expired', { status: 410 });
  const ok = await crypto.subtle.verify('HMAC', hmac, sig, new TextEncoder().encode(`${key}|${exp}`));
  if (!ok) return new Response('Not found', { status: 404 });

  const obj = await env.BILLS.get(key);
  if (!obj) return new Response('This photo has been deleted', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': `private, max-age=${Math.max(0, exp - Math.floor(Date.now() / 1000))}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/** Daily (from the cron trigger): deletes bill photos 90 days after the bill was decided. */
export async function cleanupBillPhotos(env: Env): Promise<number> {
  if (!env.BILLS || !env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  const service = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/bill_photos_due`, {
    method: 'POST',
    headers: service,
    body: JSON.stringify({ p_limit: 1000 }),
  });
  if (!res.ok) throw new Error(`bill_photos_due failed (${res.status})`);
  const keys = ((await res.json()) as string[]).filter((k) => KEY_RE.test(k));
  if (!keys.length) return 0;
  await env.BILLS.delete(keys);
  const done = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/mark_bill_photos_deleted`, {
    method: 'POST',
    headers: service,
    body: JSON.stringify({ p_keys: keys }),
  });
  if (!done.ok) throw new Error(`mark_bill_photos_deleted failed (${done.status})`);
  return keys.length;
}
