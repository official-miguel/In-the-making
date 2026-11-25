import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered from src/lib/pwa.ts
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        name: 'Better Me',
        short_name: 'Better Me',
        description: 'Keep your PDFs on a beautiful bookshelf, read them like books and take notes. Built by Trillionaire Designs.',
        theme_color: '#0F172A',
        background_color: '#0F172A',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything, including pdf.js fonts and character maps, is cached on first visit,
        // so any PDF opens with no connection at all.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,webmanifest,pfb,ttf,bcmap}'],
        navigateFallback: '/index.html',
        // New versions take over straight away (no stuck "waiting" worker).
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
