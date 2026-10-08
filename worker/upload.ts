import { handleBillUpload } from './bills';
import { isWebp, json, rolesFor, type Env } from './env';

const FOLDERS = ['shops', 'offers', 'ads', 'prizes', 'support', 'categories', 'test'] as const;
const UPLOAD_ROLES = ['vendor', 'admin', 'super_admin', 'campaign_manager'];
export const MAX_BYTES = 1024 * 1024; // images arrive as ~150 KB WebP; 1 MB is a hard ceiling

/**
 * POST /api/upload?folder=offers  body: the WebP image  with  Authorization: Bearer <supabase access token>
 * Stores the image in the media bucket through the Worker's R2 binding and returns its key.
 * Going through the app's own address means the bucket needs no CORS rule and no API keys.
 * folder=bills is the customers' bill photo route, which goes to a private bucket (worker/bills.ts).
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

  if (!env.MEDIA) return json({ error: 'Image storage is not connected to the app' }, 500);
  const folder = FOLDERS.find((f) => f === requested);
  if (!folder) return json({ error: 'Unknown folder' }, 400);

  // Supabase checks the token; RLS returns only this user's own roles.
  const roles = await rolesFor(request, env);
  if (roles === null) return json({ error: 'Session expired, sign in again' }, 401);
  if (roles === 'error') return json({ error: 'Could not verify account' }, 502);
  if (!roles.some((r) => UPLOAD_ROLES.includes(r)))
    return json({ error: 'Your account cannot upload images' }, 403);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: 'Empty image' }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: 'Image too large' }, 413);
  // The real file type, from its first bytes, not the header the browser sent.
  if (!isWebp(body)) return json({ error: 'This file is not an image' }, 415);

  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.webp`;
  await env.MEDIA.put(key, body, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
  });
  return json({ key });
}
