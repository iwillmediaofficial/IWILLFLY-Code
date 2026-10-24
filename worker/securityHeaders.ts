/**
 * Browser security headers for every page and file the site serves.
 * Static files get them from dist/_headers, written at build time (vite.config.ts);
 * responses built by the Worker (/api/*, /shop/*, /mall/*, sitemap, robots) get them in worker/index.ts.
 * Both use this one list, so they cannot drift apart.
 */
export function securityHeaders(supabaseUrl: string | undefined): Record<string, string> {
  // The app talks to Supabase (REST, auth and realtime). Everything else it loads comes from this site,
  // except images (shop pictures on the media URL, map tiles, Google profile pictures) and Google's sign-in button.
  const gsi = 'https://accounts.google.com/gsi/';
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  const realtime = supabase.replace(/^http/, 'ws');
  const csp = [
    "default-src 'self'",
    // WebAssembly: the WebP encoder used on Safari and iPhone, which cannot save WebP themselves.
    `script-src 'self' 'wasm-unsafe-eval' ${gsi}client`,
    // Inline style attributes are needed by Leaflet's map pin and the QR scanner.
    `style-src 'self' 'unsafe-inline' ${gsi}style`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${gsi} ${supabase} ${realtime}`.trim(),
    `frame-src ${gsi}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Camera is for the vendor QR scanner, location for "Near you" and the Scratch & Win check.
    'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
    // Google's sign-in popup has to report back to the page that opened it.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  };
}

/** The same response with the security headers added (Worker and asset responses have read-only headers). */
export function withSecurityHeaders(res: Response, supabaseUrl: string | undefined): Response {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(securityHeaders(supabaseUrl))) out.headers.set(name, value);
  return out;
}
