import { supabase } from './supabase';

/** POSTs to an /api endpoint of the Worker with the signed-in user's token, and returns its JSON. */
export async function serverApi<T>(path: string, body: unknown): Promise<T> {
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
