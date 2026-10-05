import { handleUpload, type Env } from './upload';

// The app itself is static files served by Workers Static Assets (see wrangler.jsonc).
// Only /api/* reaches this code.
export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/upload' && request.method === 'POST') return handleUpload(request, env);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
