import type { Env } from './env';
import { dispatchPush, handleDispatch } from './push';
import { handleSeo } from './seo';
import { handleUpload } from './upload';

// The app itself is static files served by Workers Static Assets (see wrangler.jsonc).
// Only /api/*, the SEO paths (/shop/*, /mall/*, /sitemap.xml, /robots.txt) and the cron trigger reach this code.
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/api/upload') return handleUpload(request, env);
    if (request.method === 'POST' && pathname === '/api/push/dispatch') return handleDispatch(request, env);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    const seo = await handleSeo(request, env, ctx);
    if (seo) return seo;
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatchPush(env));
  },
} satisfies ExportedHandler<Env>;
