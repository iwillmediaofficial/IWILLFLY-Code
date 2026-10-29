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
// Only /api/*, /assets/*, the SEO paths (/shop/*, /mall/*, /sitemap.xml, /robots.txt) and the cron trigger reach this code.
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
  if (pathname.startsWith('/assets/')) return handleAsset(request, env);
  const seo = await handleSeo(request, env, ctx);
  if (seo) return seo;
  return env.ASSETS.fetch(request);
}

// Built files have hashed names and are deleted by the next deploy. Without this, a request for an old one gets
// index.html (the single-page fallback), which the browser cannot run as a script, so a page left open goes blank.
// A real 404 makes the app reload onto the new version instead (src/lib/chunkReload.ts).
async function handleAsset(request: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  if (res.headers.get('content-type')?.includes('text/html'))
    return new Response('Not found', { status: 404 });
  return res;
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
