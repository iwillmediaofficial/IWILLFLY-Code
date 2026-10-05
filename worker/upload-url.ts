import { AwsClient } from 'aws4fetch';

export interface Env {
  ASSETS: Fetcher;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
}

const FOLDERS = ['shops', 'offers', 'ads', 'prizes', 'test'] as const;
const UPLOAD_ROLES = ['vendor', 'admin', 'super_admin', 'campaign_manager'];
const MAX_BYTES = 1024 * 1024; // images arrive as ~150 KB WebP; 1 MB is a hard ceiling
const EXPIRES_SECONDS = 300;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * POST /api/upload-url  { folder, size }  with  Authorization: Bearer <supabase access token>
 * Returns a 5-minute presigned PUT URL for a new WebP object in the media bucket.
 */
export async function handleUploadUrl(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return json({ error: 'Sign in required' }, 401);

  // Supabase checks the token; RLS returns only this user's own roles.
  const rolesRes = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/user_roles?select=role`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (rolesRes.status === 401) return json({ error: 'Session expired, sign in again' }, 401);
  if (!rolesRes.ok) return json({ error: 'Could not verify account' }, 502);
  const roles = ((await rolesRes.json()) as { role: string }[]).map((r) => r.role);
  if (!roles.some((r) => UPLOAD_ROLES.includes(r)))
    return json({ error: 'Your account cannot upload images' }, 403);

  const body = (await request.json().catch(() => null)) as { folder?: string; size?: number } | null;
  const folder = FOLDERS.find((f) => f === body?.folder);
  const size = Number(body?.size);
  if (!folder) return json({ error: 'Unknown folder' }, 400);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES)
    return json({ error: 'Image too large' }, 400);

  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.webp`;
  const headers = {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const target = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
  target.searchParams.set('X-Amz-Expires', String(EXPIRES_SECONDS));
  // Content-Length is signed too, so the browser can only upload exactly the size it declared.
  const signed = await r2.sign(target.toString(), {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': String(size) },
    aws: { signQuery: true, allHeaders: true },
  });

  return json({ url: signed.url, key, headers });
}
