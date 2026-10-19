import type { Env } from './env';

// Search engine and link preview support for the single-page app.
// /shop/:slug and /mall/:slug get a real <title>, description, canonical, Open Graph tags and JSON-LD
// in the HTML itself, so link previews (WhatsApp, Facebook, ...) still show the shop or mall even
// though the app itself needs a sign-in. /sitemap.xml and /robots.txt are generated here too.
// Old number links (/shop/2) redirect to the name link. wrangler.jsonc routes these paths to the Worker.

const SITE = 'IWILLFLY';
const LOOKUP_TTL = 300; // seconds a shop or mall lookup is cached
const SITEMAP_TTL = 86400;
/** The only pages guests can open; everything else needs a sign-in. */
const PUBLIC_PAGES = ['/', '/login', '/privacy', '/terms'];
const PRIVATE_PATHS = [
  '/admin',
  '/vendor',
  '/profile',
  '/settings',
  '/saved',
  '/prizes',
  '/notifications',
  '/history',
  '/help',
  '/points',
];

type BranchRow = {
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
};
type ShopRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  logo_key: string | null;
  cover_key: string | null;
  phone: string | null;
  branches: BranchRow[] | null;
};
type MallRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  cover_key: string | null;
};
/** A row, null when it is hidden (not live) or does not exist, undefined when the lookup failed. */
type Lookup<T> = T | null | undefined;

type PageMeta = {
  title: string;
  description: string;
  url: string;
  image: string;
  largeImage: boolean;
  jsonLd: Record<string, unknown>;
};

/** Returns a response for the SEO paths, or null to let the caller serve the request as usual. */
export async function handleSeo(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  let res: Response | null = null;
  if (url.pathname === '/robots.txt') res = robots(url.origin);
  else if (url.pathname === '/sitemap.xml') res = sitemap(url.origin);
  else {
    const m = /^\/(shop|mall)\/([a-z0-9-]{1,80})\/?$/.exec(url.pathname);
    if (m) res = await detailPage(m[1] as 'shop' | 'mall', m[2], url, env, ctx);
  }
  if (res && request.method === 'HEAD') return new Response(null, res);
  return res;
}

// ---------- shop and mall pages ----------

async function detailPage(
  kind: 'shop' | 'mall',
  key: string,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const [shell, row] = await Promise.all([
    // The SPA's index.html. Fetched without the visitor's conditional headers so it is never a 304.
    env.ASSETS.fetch(new URL('/', url.origin)),
    kind === 'shop' ? lookupShop(key, url.origin, env, ctx) : lookupMall(key, url.origin, env, ctx),
  ]);
  if (row && row.slug !== key) {
    return new Response(null, {
      status: 301,
      headers: { Location: `/${kind}/${row.slug}${url.search}`, 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (!shell.ok || row === undefined) return shell;

  const headers = new Headers(shell.headers);
  headers.delete('ETag');
  headers.delete('Content-Length');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  const base = new Response(shell.body, { status: shell.status, headers });

  if (row === null) {
    return new HTMLRewriter()
      .on('head', {
        element: (el) => void el.append('<meta name="robots" content="noindex" />', { html: true }),
      })
      .transform(base);
  }

  const canonical = `${url.origin}/${kind}/${row.slug}`;
  const meta =
    kind === 'shop'
      ? shopMeta(row as ShopRow, canonical, url.origin, env)
      : mallMeta(row as MallRow, canonical, url.origin, env);
  return new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(meta.title) })
    .on('meta[name="description"]', { element: (el) => void el.remove() })
    .on('meta[name="robots"]', { element: (el) => void el.remove() })
    .on('meta[property^="og:"]', { element: (el) => void el.remove() })
    .on('meta[name^="twitter:"]', { element: (el) => void el.remove() })
    .on('link[rel="canonical"]', { element: (el) => void el.remove() })
    .on('head', { element: (el) => void el.append(headTags(meta), { html: true }) })
    .transform(base);
}

function headTags(m: PageMeta): string {
  const tags: [string, string, string][] = [
    ['name', 'description', m.description],
    ['property', 'og:site_name', SITE],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', m.title],
    ['property', 'og:description', m.description],
    ['property', 'og:image', m.image],
    ['property', 'og:url', m.url],
    ['name', 'twitter:card', m.largeImage ? 'summary_large_image' : 'summary'],
  ];
  return [
    `<link rel="canonical" href="${attr(m.url)}" />`,
    ...tags.map(([k, name, content]) => `<meta ${k}="${name}" content="${attr(content)}" />`),
    `<script type="application/ld+json">${jsonForScript(m.jsonLd)}</script>`,
  ].join('\n');
}

function shopMeta(s: ShopRow, canonical: string, origin: string, env: Env): PageMeta {
  const branch = s.branches?.[0];
  const cover = imageUrl(s.cover_key, env);
  const logo = imageUrl(s.logo_key, env);
  const description = clip(
    s.description || `${s.name}: live offers, opening hours and directions on ${SITE}.`,
  );
  const images = [cover, logo].filter((x): x is string => Boolean(x));
  const phone = branch?.phone || s.phone;
  return {
    // Matches what the app sets (src/lib/pageMeta.ts).
    title: `${s.name} | ${SITE}`,
    description,
    url: canonical,
    image: images[0] ?? `${origin}/iwillfly-logo.jpg`,
    largeImage: Boolean(cover),
    jsonLd: compact({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': canonical,
      name: s.name,
      description,
      url: canonical,
      image: images.length ? images : undefined,
      telephone: phone || undefined,
      address: branch?.address
        ? { '@type': 'PostalAddress', streetAddress: branch.address, addressCountry: 'IN' }
        : undefined,
      geo: geo(branch?.lat, branch?.lng),
    }),
  };
}

function mallMeta(m: MallRow, canonical: string, origin: string, env: Env): PageMeta {
  const cover = imageUrl(m.cover_key, env);
  const description = clip(m.description || `Shops and live offers inside ${m.name} on ${SITE}.`);
  return {
    title: `${m.name} | ${SITE}`,
    description,
    url: canonical,
    image: cover ?? `${origin}/iwillfly-logo.jpg`,
    largeImage: Boolean(cover),
    jsonLd: compact({
      '@context': 'https://schema.org',
      '@type': 'ShoppingCenter',
      '@id': canonical,
      name: m.name,
      description,
      url: canonical,
      image: cover ?? undefined,
      address: m.address
        ? { '@type': 'PostalAddress', streetAddress: m.address, addressCountry: 'IN' }
        : undefined,
      geo: geo(m.lat, m.lng),
    }),
  };
}

// The service key skips RLS, so these lookups repeat the guest rules that used to apply:
// a shop only when it is active and its vendor is approved, a mall only when it is active.

/** A filter on the number (old links) or the slug. Both are already limited to [a-z0-9-]. */
function keyFilter(key: string): string {
  return /^\d+$/.test(key) ? `id=eq.${key}` : `slug=eq.${key}`;
}

function lookupShop(key: string, origin: string, env: Env, ctx: ExecutionContext): Promise<Lookup<ShopRow>> {
  const select =
    'id,slug,name,description,logo_key,cover_key,phone,branches(name,address,lat,lng,phone),vendors!inner()';
  return cachedJson(`shop/${key}`, origin, LOOKUP_TTL, ctx, async () => {
    const rows = await rest<ShopRow[]>(
      env,
      `shops?${keyFilter(key)}&is_active=is.true&vendors.status=eq.approved` +
        `&select=${encodeURIComponent(select)}&branches.order=id.asc&limit=1`,
    );
    return rows && (rows[0] ?? null);
  });
}

function lookupMall(key: string, origin: string, env: Env, ctx: ExecutionContext): Promise<Lookup<MallRow>> {
  return cachedJson(`mall/${key}`, origin, LOOKUP_TTL, ctx, async () => {
    const rows = await rest<MallRow[]>(
      env,
      `malls?${keyFilter(key)}&is_active=is.true&select=id,slug,name,description,address,lat,lng,cover_key&limit=1`,
    );
    return rows && (rows[0] ?? null);
  });
}

// ---------- sitemap and robots ----------

function robots(origin: string): Response {
  const body = [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

/** Only the pages guests can open. Shops and malls need a sign-in, so they are not listed. */
function sitemap(origin: string): Response {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PUBLIC_PAGES.map((p) => `<url><loc>${text(origin + p)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${SITEMAP_TTL}`,
    },
  });
}

// ---------- Supabase and caching ----------

/**
 * GET from Supabase REST with the service key (server side only: guests can no longer read shops or
 * malls). Callers filter to live rows and select only public columns. Undefined on failure or when the
 * key is not set, which serves the plain app HTML.
 */
async function rest<T>(env: Env, path: string): Promise<T | undefined> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.VITE_SUPABASE_URL || !key) return undefined;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  try {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Caches a lookup's JSON result in the Cache API (per data centre), so crawlers do not hit
 * Supabase on every request. `load` returns undefined on failure, which is never cached.
 */
async function cachedJson<T>(
  key: string,
  origin: string,
  ttl: number,
  ctx: ExecutionContext,
  load: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const cache = caches.default;
  const cacheKey = new Request(`${origin}/__seo-cache/${key}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return (await hit.json()) as T;
  } catch {
    /* cache unavailable; fall through to a live lookup */
  }
  const value = await load();
  if (value !== undefined) {
    const res = new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
    });
    ctx.waitUntil(cache.put(cacheKey, res).catch(() => undefined));
  }
  return value;
}

// ---------- helpers ----------

/** Same mapping as mediaUrl() in src/lib/supabase.ts; null without a public media base URL. */
function imageUrl(key: string | null, env: Env): string | null {
  const base = env.VITE_MEDIA_BASE_URL?.replace(/\/$/, '');
  return key && base ? `${base}/${key}` : null;
}

function geo(lat: number | null | undefined, lng: number | null | undefined) {
  return lat != null && lng != null
    ? { '@type': 'GeoCoordinates', latitude: lat, longitude: lng }
    : undefined;
}

function clip(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Escapes a value for a double-quoted HTML attribute. */
function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text content for HTML or XML. */
function text(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** JSON that cannot close the <script> element or break out of it. */
function jsonForScript(o: unknown): string {
  return JSON.stringify(o)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
