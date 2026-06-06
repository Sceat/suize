import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mobile-first dapp; default dev port 5173.
export default defineConfig({
  plugins: [
    react(),
    // PWA: precache the static app shell only for instant repeat loads.
    // We deliberately do NOT runtime-cache or intercept the Enoki WebSocket
    // (wss://api.suize.io/ws) or any api.suize.io HTTP (sponsor/execute) —
    // network requests are left untouched. The plugin OWNS the manifest now
    // (the old empty-icons public/manifest.webmanifest was removed).
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
        name: 'Crash · by Suize',
        short_name: 'Crash',
        description: 'One-tap 15-minute BTC up/down crash game by Suize, on Sui.',
        theme_color: '#05080f',
        background_color: '#05080f',
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
    host: true,
    port: 5173,
  },
})
