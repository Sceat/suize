import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: precache the static marketing shell only for instant repeat loads.
    // Network requests (waitlist POST etc.) are left untouched — no runtime caching.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['logo.png', 'droplet.svg', 'og-banner.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,webp}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Suize',
        short_name: 'Suize',
        description: 'The agentic Sui wallet — your money, on autopilot.',
        theme_color: '#031021',
        background_color: '#031021',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5173, host: true },
})
