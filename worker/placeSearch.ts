import { inIndia } from '../src/lib/mapsLink';
import { json, rolesFor, type Env } from './env';

// Admin > Locations: find a town or area by name so its latitude and longitude fill in by themselves.
// Uses OpenStreetMap's free place search (Nominatim). Its rules: at most 1 search a second, and say who we are
// in the User-Agent. Only admins can call this and they type a whole name, so we stay far below that.

const ADMIN_ROLES = ['admin', 'super_admin'];
const UA = 'IWILLFLY-admin/1.0 (+https://www.iwillfly.in)';

type NominatimRow = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  type?: string;
  addresstype?: string;
};

export type PlaceHit = { name: string; label: string; kind: string; lat: number; lng: number };

/** POST /api/places/search  body: { q, near?: { lat, lng } }  with  Authorization: Bearer <supabase access token> */
export async function handlePlaceSearch(request: Request, env: Env): Promise<Response> {
  const roles = await rolesFor(request, env);
  if (roles === null) return json({ error: 'Session expired, sign in again' }, 401);
  if (roles === 'error') return json({ error: 'Could not verify account' }, 502);
  if (!roles.some((r) => ADMIN_ROLES.includes(r))) return json({ error: 'Not allowed' }, 403);

  const body = (await request.json().catch(() => null)) as {
    q?: unknown;
    near?: { lat?: unknown; lng?: unknown };
  } | null;
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 120) : '';
  if (q.length < 2) return json({ error: 'Type at least 2 letters' }, 400);

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'in');
  url.searchParams.set('limit', '8');
  url.searchParams.set('accept-language', 'en');
  // Prefer places near the parent city or district (not a hard limit, other matches still show).
  const lat = Number(body?.near?.lat);
  const lng = Number(body?.near?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && inIndia({ lat, lng })) {
    const d = 0.6; // about 65 km each way
    url.searchParams.set('viewbox', `${lng - d},${lat + d},${lng + d},${lat - d}`);
  }

  const res = await fetch(url.href, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(
    () => null,
  );
  if (!res || !res.ok) return json({ error: 'Place search is not answering. Try again in a minute.' }, 502);
  const rows = ((await res.json().catch(() => [])) as NominatimRow[]) ?? [];

  const hits: PlaceHit[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const la = Number(r.lat);
    const ln = Number(r.lon);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || !inIndia({ lat: la, lng: ln })) continue;
    const label = (r.display_name ?? '').replace(/, India$/, '');
    hits.push({
      name: r.name || label.split(',')[0] || q,
      label,
      kind: r.addresstype || r.type || '',
      lat: Math.round(la * 1e6) / 1e6,
      lng: Math.round(ln * 1e6) / 1e6,
    });
  }
  return json({ hits });
}
