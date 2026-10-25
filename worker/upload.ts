import { handleBillUpload } from './bills';
import { isWebp, json, rolesFor, userIdFor, type Env } from './env';

const FOLDERS = ['shops', 'offers', 'ads', 'prizes', 'support', 'categories', 'locations', 'test'] as const;
const STAFF_UPLOAD_ROLES = ['admin', 'super_admin', 'campaign_manager'];
export const MAX_BYTES = 1024 * 1024; // images arrive as ~150 KB WebP; 1 MB is a hard ceiling
// Approved vendor teams may upload this many images per India day; staff have no limit.
const VENDOR_UPLOADS_PER_DAY = 100;
// A business still under review may add only its shop logo and cover photo, with a few retries.
const PENDING_UPLOADS_PER_DAY = 6;
// One empty marker per vendor upload, upload-log/<user id>/<India date>/<random>, counts the day's uploads.
const LOG_PREFIX = 'upload-log/';

/**
 * POST /api/upload?folder=offers  body: the WebP image  with  Authorization: Bearer <supabase access token>
 * Stores the image in the media bucket through the Worker's R2 binding and returns its key.
 * Going through the app's own address means the bucket needs no CORS rule and no API keys.
 * folder=bills (customers' bill photos) and folder=payments (vendors' UPI payment screenshots) go to a
 * private bucket instead (worker/bills.ts).
 */
export async function handleUpload(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return json({ error: 'Sign in required' }, 401);

  const requested = new URL(request.url).searchParams.get('folder');
  if (request.headers.get('Content-Type') !== 'image/webp')
    return json({ error: 'Images must be WebP' }, 400);
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES)
    return json({ error: 'Image too large' }, 413);
  if (requested === 'bills') return handleBillUpload(request, env);
  // Vendors' UPI payment screenshots: private, like bill photos (allowed while the business is under review).
  if (requested === 'payments') return handleBillUpload(request, env, 'payments');

  if (!env.MEDIA) return json({ error: 'Image storage is not connected to the app' }, 500);
  const folder = FOLDERS.find((f) => f === requested);
  if (!folder) return json({ error: 'Unknown folder' }, 400);

  // Supabase checks the token; RLS returns only this user's own roles.
  const roles = await rolesFor(request, env);
  if (roles === null) return json({ error: 'Session expired, sign in again' }, 401);
  if (roles === 'error') return json({ error: 'Could not verify account' }, 502);
  const staff = roles.some((r) => STAFF_UPLOAD_ROLES.includes(r));
  if (!staff && !roles.includes('vendor')) return json({ error: 'Your account cannot upload images' }, 403);

  // Approved vendors upload anything up to a daily allowance; a business under review only its shop
  // logo and cover photo (folder 'shops'), a few a day.
  let logKey: string | null = null;
  if (!staff) {
    const vendor = await myVendor(request, env);
    if (vendor === 'error') return json({ error: 'Could not verify account' }, 502);
    const pending = vendor?.status === 'pending';
    if (pending && folder !== 'shops')
      return json({ error: 'You can add pictures once IWILLFLY approves your business' }, 403);
    if (!vendor || (!pending && vendor.status !== 'approved'))
      return json({ error: 'Your account cannot upload images' }, 403);
    const allowance = pending ? PENDING_UPLOADS_PER_DAY : VENDOR_UPLOADS_PER_DAY;
    const prefix = `${LOG_PREFIX}${vendor.uid}/${indiaDate()}/`;
    const used = await env.MEDIA.list({ prefix, limit: allowance });
    if (used.objects.length >= allowance)
      return json({ error: `You can upload ${allowance} images a day. Please try again tomorrow.` }, 429);
    logKey = `${prefix}${crypto.randomUUID()}`;
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: 'Empty image' }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: 'Image too large' }, 413);
  // The real file type, from its first bytes, not the header the browser sent.
  if (!isWebp(body)) return json({ error: 'This file is not an image' }, 415);

  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.webp`;
  await env.MEDIA.put(key, body, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
  });
  if (logKey) await env.MEDIA.put(logKey, new Uint8Array(0));
  return json({ key });
}

/** Today's date in India (YYYY-MM-DD), the day the upload limit counts. */
function indiaDate() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** The caller's vendor (owner or team member) with its status, null when they have none. */
async function myVendor(
  request: Request,
  env: Env,
): Promise<{ status: string; uid: string } | null | 'error'> {
  const uid = await userIdFor(request, env);
  if (uid === 'error') return 'error';
  if (uid === null) return null;
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/my_vendor`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: request.headers.get('Authorization') ?? '',
      'Content-Type': 'application/json',
    },
    body: '{}',
  }).catch(() => null);
  if (!res?.ok) return 'error';
  const v = (await res.json()) as { status?: string } | null;
  return v?.status ? { status: v.status, uid } : null;
}

/** Daily (from the cron trigger): removes upload-limit markers from before yesterday. */
export async function cleanupUploadLog(env: Env): Promise<number> {
  if (!env.MEDIA) return 0;
  const before = Date.now() - 2 * 86400_000;
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ prefix: LOG_PREFIX, cursor, limit: 1000 });
    const old = page.objects.filter((o) => o.uploaded.getTime() < before).map((o) => o.key);
    if (old.length) await env.MEDIA.delete(old);
    removed += old.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}
