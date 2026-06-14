import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      // Dev parity with the prod vercel rewrite: /bridge → bridge.html (prod
      // adds the frame-ancestors CSP there too — see vercel.json).
      name: 'suize-bridge-path',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/bridge' || req.url?.startsWith('/bridge?')) req.url = '/bridge.html';
          next();
        });
      },
    },
    // PWA: precache the static app shell only for instant repeat loads.
    // We deliberately do NOT runtime-cache or intercept the Enoki WebSocket
    // (wss://api.suize.io/ws) or any api.suize.io HTTP (sponsor/execute) —
    // network requests are left untouched.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['logo.png', 'og.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,webp}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Without this the OLD service worker keeps serving the stale precached
        // index.html (old <title>) until every tab closes — a new deploy must
        // take over immediately.
        skipWaiting: true,
        // /bridge is its OWN html entry (bridge.html, rewritten by vercel) —
        // the SPA navigation fallback must not hijack it into index.html.
        navigateFallbackDenylist: [/^\/bridge/],
      },
      manifest: {
        name: 'Suize',
        short_name: 'Suize',
        description: 'The AI wallet that makes life easier — fully non-custodial, on Sui.',
        theme_color: '#F6F8FA',
        background_color: '#F6F8FA',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Two entries: the wallet SPA + the SSO bridge iframe (served at /bridge —
  // a separate page so embedding products load providers only, never the UI).
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        bridge: 'bridge.html',
      },
    },
  },
  server: {
    port: 5180,
    host: true,
  },
});
