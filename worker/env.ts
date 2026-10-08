export interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  // Private bucket for customers' bill photos (never on the public media URL). See worker/bills.ts.
  BILLS?: R2Bucket;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  // Public media URL, the same value as the build variable; used for og:image on shop and mall pages.
  VITE_MEDIA_BASE_URL?: string;
  // Web push (optional until set in the Cloudflare dashboard; pushes are skipped without them)
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The caller's roles, checked by Supabase from their access token; null when the token is bad. */
export async function rolesFor(request: Request, env: Env): Promise<string[] | null | 'error'> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return null;
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/user_roles?select=role`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return 'error';
  if (res.status === 401) return null;
  if (!res.ok) return 'error';
  return ((await res.json()) as { role: string }[]).map((r) => r.role);
}

/** The caller's user id, checked by Supabase from their access token; null when the token is bad. */
export async function userIdFor(request: Request, env: Env): Promise<string | null | 'error'> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return null;
  const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return 'error';
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) return 'error';
  return ((await res.json()) as { id?: string }).id ?? null;
}

/** True when the bytes start like a WebP file ("RIFF" .... "WEBP"), whatever the request claims. */
export function isWebp(bytes: ArrayBuffer) {
  if (bytes.byteLength < 12) return false;
  const b = new Uint8Array(bytes, 0, 12);
  const ascii = (from: number) => String.fromCharCode(b[from], b[from + 1], b[from + 2], b[from + 3]);
  return ascii(0) === 'RIFF' && ascii(8) === 'WEBP';
}
