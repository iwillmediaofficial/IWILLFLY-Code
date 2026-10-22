// Reads a map spot from what a vendor pastes: plain coordinates, or a Google Maps link.
// Shared by the app (full links and coordinates, read in the browser) and the Worker
// (short share links, which the browser cannot follow). No Google API is used: only the
// numbers already written in the link.

export interface Spot {
  lat: number;
  lng: number;
  /** The link only had the map view (@lat,lng), which is the middle of the screen, not a place. */
  approx?: boolean;
}

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`^\s*(${NUM})\s*[,\s]\s*(${NUM})\s*$`);
// 10°24'56.5"N 76°16'12.6"E, as Google shows on a computer
const DMS_PART = String.raw`(\d{1,3})\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')\s*)?([NSEW])`;
const DMS = new RegExp(String.raw`^\s*${DMS_PART}[\s,]+${DMS_PART}\s*$`, 'i');

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  (lat !== 0 || lng !== 0);

/** India, with a little room around the borders. */
export const inIndia = (s: { lat: number; lng: number }) =>
  s.lat >= 6 && s.lat <= 37.5 && s.lng >= 68 && s.lng <= 97.5;

/** "10.41570, 76.27017" (also "10.4157 76.2701") or 10°24'56.5"N 76°16'12.6"E. */
export function parseCoords(text: string): Spot | null {
  const p = PAIR.exec(text);
  if (p) {
    const lat = Number(p[1]);
    const lng = Number(p[2]);
    return valid(lat, lng) ? { lat, lng } : null;
  }
  const d = DMS.exec(text);
  if (d) {
    const part = (deg: string, min?: string, sec?: string, hemi?: string) => {
      const v = Number(deg) + Number(min ?? 0) / 60 + Number(sec ?? 0) / 3600;
      return /[SW]/i.test(hemi ?? '') ? -v : v;
    };
    const a = { v: part(d[1], d[2], d[3], d[4]), ns: /[NS]/i.test(d[4]) };
    const b = { v: part(d[5], d[6], d[7], d[8]), ns: /[NS]/i.test(d[8]) };
    if (a.ns === b.ns) return null;
    const lat = a.ns ? a.v : b.v;
    const lng = a.ns ? b.v : a.v;
    return valid(lat, lng) ? { lat, lng } : null;
  }
  return null;
}

const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|co\.in|[a-z]{2,3}|com?\.[a-z]{2})$/;

export type LinkKind = 'coords' | 'google' | 'short' | 'other';

function toUrl(text: string): URL | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
}

/** A short Google share link that has to be followed to the full link (maps.app.goo.gl, goo.gl/maps). */
export function isShortLink(u: URL) {
  const host = u.hostname.toLowerCase();
  return host === 'maps.app.goo.gl' || (host === 'goo.gl' && u.pathname.startsWith('/maps'));
}

/** A full Google Maps link (google.com/maps…, maps.google.com, google.co.in/maps…). */
export function isGoogleMapsUrl(u: URL) {
  const host = u.hostname.toLowerCase();
  if (!GOOGLE_HOST.test(host)) return false;
  return host.startsWith('maps.') || u.pathname === '/maps' || u.pathname.startsWith('/maps/');
}

export function linkKind(text: string): LinkKind {
  if (parseCoords(text)) return 'coords';
  const u = toUrl(text);
  if (!u || !/^https?:$/.test(u.protocol)) return 'other';
  if (isShortLink(u)) return 'short';
  if (isGoogleMapsUrl(u)) return 'google';
  return 'other';
}

/** The spot in a full Google Maps link, best first: the place itself, a search or pin, then the map view. */
export function spotFromGoogleUrl(link: string): Spot | null {
  const u = toUrl(link);
  if (!u) return null;
  let text = link;
  try {
    text = decodeURIComponent(link.replace(/\+/g, ' '));
  } catch {
    /* keep the raw link */
  }

  // !3d<lat>!4d<lng>: the place the link points at (the last one when there are several)
  const places = [...text.matchAll(new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`, 'g'))];
  for (const m of places.reverse()) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (valid(lat, lng)) return { lat, lng };
  }

  // ?q=, ?query=, ?ll=, ?destination=, ?daddr=, ?center= holding plain coordinates
  for (const key of ['q', 'query', 'll', 'sll', 'destination', 'daddr', 'center']) {
    const v = u.searchParams.get(key);
    const s = v ? parseCoords(v.replace(/^loc:/i, '')) : null;
    if (s) return s;
  }

  // /maps/place/10.4157,76.2701/… , /maps/search/10.4157,+76.2701 , /maps/dir/…/10.4157,76.2701
  const segs = u.pathname.split('/').map((p) => {
    try {
      return decodeURIComponent(p.replace(/\+/g, ' '));
    } catch {
      return p;
    }
  });
  for (const seg of segs.reverse()) {
    if (seg.startsWith('@')) continue;
    const s = parseCoords(seg);
    if (s) return s;
  }

  // @lat,lng,zoom: only where the map was looking
  const view = new RegExp(String.raw`@(${NUM}),(${NUM})`).exec(text);
  if (view) {
    const lat = Number(view[1]);
    const lng = Number(view[2]);
    if (valid(lat, lng)) return { lat, lng, approx: true };
  }
  return null;
}

/** Coordinates inside a Google Maps page (the static map preview), for place links whose URL has none. */
export function spotFromGooglePage(html: string): Spot | null {
  for (const key of ['markers', 'center']) {
    const m = new RegExp(String.raw`${key}=(${NUM})(?:%2C|,)(${NUM})`).exec(html);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) return { lat, lng };
    }
  }
  return null;
}
