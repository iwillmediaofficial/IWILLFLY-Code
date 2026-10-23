import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { securityHeaders } from './worker/securityHeaders';

/** Writes dist/_headers so Workers Static Assets sends the browser security headers with every static file. */
function staticSecurityHeaders(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'static-security-headers',
    apply: 'build',
    generateBundle() {
      const lines = Object.entries(securityHeaders(supabaseUrl)).map(([k, v]) => `  ${k}: ${v}`);
      this.emitFile({ type: 'asset', fileName: '_headers', source: ['/*', ...lines, ''].join('\n') });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    staticSecurityHeaders(process.env.VITE_SUPABASE_URL ?? loadEnv(mode, process.cwd()).VITE_SUPABASE_URL),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered in src/main.tsx, which also reloads open pages onto a new version.
      injectRegister: false,
      includeAssets: ['favicon.png', 'iwillfly-logo.jpg', 'iwillfly-logo.webp', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'IWILLFLY',
        short_name: 'IWILLFLY',
        description: 'Local offers, malls and daily Scratch & Win near you.',
        theme_color: '#1760d9',
        background_color: '#f4f7fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,woff2}'],
        // Cloudflare redirects /index.html to /, so the app page is cached and served as / directly.
        manifestTransforms: [
          async (entries) => ({
            manifest: entries.map((e) => (e.url === 'index.html' ? { ...e, url: '/' } : e)),
          }),
        ],
        navigateFallback: '/',
        navigateFallbackDenylist: [/^\/api\//, /^\/(sitemap\.xml|robots\.txt)$/],
        // Shows web push notifications and opens the app when one is tapped.
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
}));
