import type { Env } from './env';

// Search engine and link preview support for the single-page app.
// /shop/:id and /mall/:id get a real <title>, description, canonical, Open Graph tags and JSON-LD
// in the HTML itself, so crawlers that do not run JavaScript still see the shop or mall.
// /sitemap.xml and /robots.txt are generated here too. wrangler.jsonc routes these paths to the Worker.

const SITE = 'IWILLFLY';
const LOOKUP_TTL = 300; // seconds a shop or mall lookup is cached
const SITEMAP_TTL = 3600;
const SITEMAP_LIMIT = 5000;
const PAGE_SIZE = 1000; // Supabase's default API max rows
const PRIVATE_PATHS = [
  '/admin',
  '/vendor',
  '/login',
  '/profile',
  '/settings',
  '/saved',
  '/prizes',
  '/notifications',
  '/history',
  '/help',
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
  name: string;
  description: string | null;
  logo_key: string | null;
  cover_key: string | null;
  phone: string | null;
  branches: BranchRow[] | null;
};
type MallRow = {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  cover_key: string | null;
};
/** A row, null when RLS hides it or it does not exist, undefined when the lookup failed. */
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
  else if (url.pathname === '/sitemap.xml') res = await sitemap(url.origin, env, ctx);
  else {
    const m = /^\/(shop|mall)\/(\d{1,15})\/?$/.exec(url.pathname);
    if (m) res = await detailPage(m[1] as 'shop' | 'mall', Number(m[2]), url, env, ctx);
  }
  if (res && request.method === 'HEAD') return new Response(null, res);
  return res;
}

// ---------- shop and mall pages ----------

async function detailPage(
  kind: 'shop' | 'mall',
  id: number,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const [shell, row] = await Promise.all([
    // The SPA's index.html. Fetched without the visitor's conditional headers so it is never a 304.
    env.ASSETS.fetch(new URL('/', url.origin)),
    kind === 'shop' ? lookupShop(id, url.origin, env, ctx) : lookupMall(id, url.origin, env, ctx),
  ]);
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

  const canonical = `${url.origin}/${kind}/${id}`;
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

function lookupShop(id: number, origin: string, env: Env, ctx: ExecutionContext): Promise<Lookup<ShopRow>> {
  const select = 'id,name,description,logo_key,cover_key,phone,branches(name,address,lat,lng,phone)';
  return cachedJson(`shop/${id}`, origin, LOOKUP_TTL, ctx, async () => {
    const rows = await rest<ShopRow[]>(
      env,
      `shops?id=eq.${id}&select=${encodeURIComponent(select)}&branches.order=id.asc&limit=1`,
    );
    return rows && (rows[0] ?? null);
  });
}

function lookupMall(id: number, origin: string, env: Env, ctx: ExecutionContext): Promise<Lookup<MallRow>> {
  return cachedJson(`mall/${id}`, origin, LOOKUP_TTL, ctx, async () => {
    const rows = await rest<MallRow[]>(
      env,
      `malls?id=eq.${id}&select=id,name,description,address,lat,lng,cover_key&limit=1`,
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

type SitemapRow = { id: number; updated_at?: string | null };

async function sitemap(origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ids = await cachedJson('sitemap', origin, SITEMAP_TTL, ctx, async () => {
    const [shops, malls] = await Promise.all([
      restPaged<SitemapRow>(env, 'shops?select=id,updated_at&order=id.asc'),
      restPaged<SitemapRow>(env, 'malls?select=id&order=sort_order.asc,id.asc'),
    ]);
    return shops && malls ? { shops, malls } : undefined;
  });
  const entries: { loc: string; lastmod?: string | null }[] = [
    { loc: `${origin}/` },
    { loc: `${origin}/explore` },
    { loc: `${origin}/malls` },
    ...(ids?.malls ?? []).map((m) => ({ loc: `${origin}/mall/${m.id}` })),
    ...(ids?.shops ?? []).map((s) => ({ loc: `${origin}/shop/${s.id}`, lastmod: s.updated_at })),
  ];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(
      (e) =>
        `<url><loc>${text(e.loc)}</loc>${e.lastmod ? `<lastmod>${text(e.lastmod.slice(0, 10))}</lastmod>` : ''}</url>`,
    ),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Shorter when the lookup failed, so a Supabase hiccup is not served for an hour.
      'Cache-Control': `public, max-age=${ids ? SITEMAP_TTL : 60}`,
    },
  });
}

// ---------- Supabase and caching ----------

/** GET from Supabase REST with the anon key, so RLS shows only public, live rows. Undefined on failure. */
async function rest<T>(env: Env, path: string): Promise<T | undefined> {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return undefined;
  const headers = {
    apikey: env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
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

/** Up to SITEMAP_LIMIT rows, a page at a time because Supabase caps each response. */
async function restPaged<T>(env: Env, path: string): Promise<T[] | undefined> {
  const all: T[] = [];
  while (all.length < SITEMAP_LIMIT) {
    const from = all.length;
    const size = Math.min(PAGE_SIZE, SITEMAP_LIMIT - from);
    const page = await rest<T[]>(env, `${path}&limit=${size}&offset=${from}`);
    if (!page) return undefined;
    all.push(...page);
    if (page.length < size) break;
  }
  return all;
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
