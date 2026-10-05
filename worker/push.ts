import { buildPushHTTPRequest } from '@pushforge/builder';
import { json, rolesFor, type Env } from './env';

interface QueuedPush {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
}

// The free Workers plan allows 50 outgoing requests per run: 1 to read the queue, 1 to drop dead
// browsers, the rest for pushes.
const MAX_PUSHES = 40;

/**
 * Sends queued notifications as web pushes. Runs on the cron trigger (wrangler.jsonc) and right after
 * an admin broadcast. Does nothing until the push secrets are set in Cloudflare.
 */
export async function dispatchPush(env: Env): Promise<{ sent: number; failed: number; configured: boolean }> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.VAPID_PRIVATE_JWK)
    return { sent: 0, failed: 0, configured: false };
  const service = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/push_queue`, {
    method: 'POST',
    headers: service,
    body: JSON.stringify({ p_max: MAX_PUSHES }),
  });
  if (!res.ok) throw new Error(`push_queue failed (${res.status})`);
  const queue = (await res.json()) as QueuedPush[];

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  const jobs = queue.flatMap((n) =>
    n.subscriptions.map(async (s) => {
      const req = await buildPushHTTPRequest({
        privateJWK: env.VAPID_PRIVATE_JWK!,
        subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message: {
          payload: { title: n.title, body: n.body ?? '', link: n.link ?? '/notifications', id: n.id },
          adminContact: env.VAPID_SUBJECT || 'mailto:iwillflyofficial@gmail.com',
          options: { ttl: 86400, urgency: 'normal' },
        },
      }).catch(() => null);
      if (!req) {
        // a broken subscription (bad keys or endpoint) can never work
        failed++;
        gone.push(s.endpoint);
        return;
      }
      const out = await fetch(req.endpoint, { method: 'POST', headers: req.headers, body: req.body }).catch(
        () => null,
      );
      if (out?.ok) sent++;
      else {
        failed++;
        // 404/410: the browser unsubscribed or the subscription expired
        if (out && (out.status === 404 || out.status === 410)) gone.push(s.endpoint);
      }
    }),
  );
  await Promise.all(jobs);

  if (gone.length) {
    const list = gone.map((e) => `"${e.replace(/"/g, '\\"')}"`).join(',');
    await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=in.(${encodeURIComponent(list)})`,
      {
        method: 'DELETE',
        headers: service,
      },
    );
  }
  return { sent, failed, configured: true };
}

/** POST /api/push/dispatch: a signed-in user (the admin app after a broadcast) asks for an immediate send. */
export async function handleDispatch(request: Request, env: Env): Promise<Response> {
  const roles = await rolesFor(request, env);
  if (roles === null) return json({ error: 'Sign in required' }, 401);
  if (roles === 'error') return json({ error: 'Could not verify account' }, 502);
  try {
    return json(await dispatchPush(env));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
