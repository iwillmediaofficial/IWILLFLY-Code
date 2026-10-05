import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'iwillfly-logo.jpg', 'icons/apple-touch-icon.png'],
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
        navigateFallbackDenylist: [/^\/api\//],
        // Shows web push notifications and opens the app when one is tapped.
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
});
