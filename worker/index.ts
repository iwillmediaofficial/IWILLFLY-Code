import { handleCreateVendor, handleSetVendorPassword } from './adminVendors';
import { handleBranchLoginActive, handleBranchLoginPassword, handleCreateBranchLogin } from './branchLogins';
import { cleanupBillPhotos, handlePhoto, handlePhotoLink } from './bills';
import type { Env } from './env';
import { handleInstamojoReturn, handleInstamojoStart, handleInstamojoWebhook } from './instamojo';
import { handleMapsResolve } from './mapsLink';
import { dispatchPush, handleDispatch } from './push';
import { handleRazorpayReturn, handleRazorpayStart, handleRazorpayWebhook } from './razorpay';
import { withSecurityHeaders } from './securityHeaders';
import { handleSeo } from './seo';
import { cleanupUploadLog, handleUpload } from './upload';

// The app itself is static files served by Workers Static Assets (see wrangler.jsonc).
// Only /api/*, the SEO paths (/shop/*, /mall/*, /sitemap.xml, /robots.txt), the app's start file
// (/assets/index-*.js, see isMissingAppFile) and the cron trigger reach this code.
async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === 'POST' && pathname === '/api/upload') return handleUpload(request, env);
  if (request.method === 'POST' && pathname === '/api/push/dispatch') return handleDispatch(request, env);
  if (request.method === 'POST' && pathname === '/api/admin/vendors') return handleCreateVendor(request, env);
  if (request.method === 'POST' && pathname === '/api/admin/vendors/password')
    return handleSetVendorPassword(request, env);
  if (request.method === 'POST' && pathname === '/api/vendor/branch-login')
    return handleCreateBranchLogin(request, env);
  if (request.method === 'POST' && pathname === '/api/vendor/branch-login/password')
    return handleBranchLoginPassword(request, env);
  if (request.method === 'POST' && pathname === '/api/vendor/branch-login/active')
    return handleBranchLoginActive(request, env);
  if (request.method === 'POST' && pathname === '/api/bills/photo-link') return handlePhotoLink(request, env);
  if (request.method === 'GET' && pathname === '/api/bills/photo') return handlePhoto(request, env);
  if (request.method === 'POST' && pathname === '/api/maps/resolve') return handleMapsResolve(request, env);
  if (request.method === 'POST' && pathname === '/api/pay/instamojo/start')
    return handleInstamojoStart(request, env);
  if (request.method === 'GET' && pathname === '/api/pay/instamojo/return')
    return handleInstamojoReturn(request, env);
  if (request.method === 'POST' && pathname === '/api/pay/instamojo/webhook')
    return handleInstamojoWebhook(request, env);
  if (request.method === 'POST' && pathname === '/api/pay/razorpay/start')
    return handleRazorpayStart(request, env);
  if (request.method === 'GET' && pathname === '/api/pay/razorpay/return')
    return handleRazorpayReturn(request, env);
  if (request.method === 'POST' && pathname === '/api/pay/razorpay/webhook')
    return handleRazorpayWebhook(request, env);
  if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
  const seo = await handleSeo(request, env, ctx);
  if (seo) return seo;
  const res = await env.ASSETS.fetch(request);
  if (isMissingAppFile(pathname, res)) return reloadScript();
  return res;
}

/**
 * True when the app's start file asked for no longer exists: asset serving then answers with the app page
 * (single-page-application), which the browser refuses to run as a script. Only the start file
 * (/assets/index-<hash>.js) is routed here, one Worker request per visit; other files stay on asset serving.
 */
function isMissingAppFile(pathname: string, res: Response): boolean {
  return (
    pathname.startsWith('/assets/') &&
    pathname.endsWith('.js') &&
    (res.headers.get('Content-Type') ?? '').includes('text/html')
  );
}

/**
 * Sent in place of an app file a deploy removed. A copy of the page saved before the deploy (Instagram's and
 * Facebook's in-app browsers keep one, even copies older than public/boot-check.js) asks for those files;
 * this reloads it once with a fresh address so the current page loads. At most once per 30 seconds.
 */
function reloadScript(): Response {
  const js = `(function(){
  var K = 'iwf-stale-reload';
  try {
    var last = Number(sessionStorage.getItem(K));
    if (last && Date.now() - last < 30000) return;
    sessionStorage.setItem(K, String(Date.now()));
  } catch (e) {
    if (/[?&]_r=/.test(location.search)) return;
  }
  var url = new URL(location.href);
  url.searchParams.set('_r', Date.now().toString(36));
  location.replace(url.toString());
})();
`;
  return new Response(js, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return withSecurityHeaders(await route(request, env, ctx), env.VITE_SUPABASE_URL);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchPush(env));
    // The cron runs every 2 minutes; old bill photos and upload-limit markers are cleared once a day, at 02:30 India time.
    const at = new Date(event.scheduledTime);
    if (at.getUTCHours() === 21 && at.getUTCMinutes() < 2) {
      ctx.waitUntil(cleanupBillPhotos(env));
      ctx.waitUntil(cleanupUploadLog(env));
    }
  },
} satisfies ExportedHandler<Env>;
