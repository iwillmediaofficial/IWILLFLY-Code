import { isGoogleMapsUrl, isShortLink, spotFromGooglePage, spotFromGoogleUrl } from '../src/lib/mapsLink';
import { json, userIdFor, type Env } from './env';

// Short Google Maps share links (maps.app.goo.gl/…) only say where the place is after a redirect, which the
// browser cannot follow across sites. This follows them here and sends back just the coordinates.
// Only Google Maps addresses are ever fetched, on every step, so it cannot be used to open other sites.

const MAX_HOPS = 5;
const MAX_PAGE_BYTES = 2_000_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function allowed(u: URL) {
  return u.protocol === 'https:' && (isShortLink(u) || isGoogleMapsUrl(u));
}

async function readPage(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
    if (out.length > MAX_PAGE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return out;
}

/** POST /api/maps/resolve  body: { url }  with  Authorization: Bearer <supabase access token> */
export async function handleMapsResolve(request: Request, env: Env): Promise<Response> {
  const uid = await userIdFor(request, env);
  if (uid === null) return json({ error: 'Session expired, sign in again' }, 401);
  if (uid === 'error') return json({ error: 'Could not verify account' }, 502);

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const raw = typeof body?.url === 'string' ? body.url.trim() : '';
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    url.protocol = 'https:';
  } catch {
    return json({ error: 'not_google' }, 400);
  }
  if (raw.length > 2000 || !allowed(url)) return json({ error: 'not_google' }, 400);

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const spot = spotFromGoogleUrl(url.href);
    if (spot && !spot.approx) return json(spot);

    const res = await fetch(url.href, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9' },
    }).catch(() => null);
    if (!res) return json({ error: 'not_opened' }, 502);

    const next = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
    if (next) {
      await res.body?.cancel();
      let to: URL;
      try {
        to = new URL(next, url);
      } catch {
        return json({ error: 'not_opened' }, 502);
      }
      // Outside India Google may stop at its cookie page first; the real link is in ?continue=.
      if (to.hostname === 'consent.google.com' && to.searchParams.get('continue')) {
        try {
          to = new URL(to.searchParams.get('continue')!);
        } catch {
          return json({ error: 'not_opened' }, 502);
        }
      }
      if (!allowed(to)) return spot ? json(spot) : json({ error: 'not_found' }, 422);
      url = to;
      continue;
    }

    if (!res.ok) return spot ? json(spot) : json({ error: 'not_opened' }, 502);
    // A place link without numbers in it: the page's map preview says where the place is.
    const fromPage = isShortLink(url) ? null : spotFromGooglePage(await readPage(res));
    if (fromPage) return json(fromPage);
    return spot ? json(spot) : json({ error: 'not_found' }, 422);
  }
  return json({ error: 'not_opened' }, 502);
}
