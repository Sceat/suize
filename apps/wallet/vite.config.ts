import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
      },
      manifest: {
        name: 'Suize',
        short_name: 'Suize',
        description: 'The AI wallet that works for you — your money, without banks, on Sui.',
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
  server: {
    port: 5180,
    host: true,
  },
});
