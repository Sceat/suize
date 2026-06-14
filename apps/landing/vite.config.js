import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// The Suize landing — "money for the agentic web." Dark experiential editorial:
// hand-authored CSS, an OGL flow-field shader, Lenis smooth scroll + GSAP
// ScrollTrigger, on the shared brand type triad. Dev port 5173.
//
// TWO HTML entries, ONE SPA: index.html (the default PAY/wallet OG card) +
// business.html (the CHARGE/x402 card). Both boot the SAME app (/src/main.jsx);
// they differ only in their static <meta> so a social/crawler scrape of
// `/business` gets the business preview (vercel.json rewrites /business →
// business.html — see it). The path router then renders the right page.
export default defineConfig({
  plugins: [
    react(),
    {
      // Dev parity with the prod vercel rewrite: /business → business.html (so
      // the business OG card is testable locally too). The SPA router then reads
      // the /business path and renders the Businesses page.
      name: 'suize-business-path',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/business' || req.url?.startsWith('/business?'))
            req.url = '/business.html'
          next()
        })
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        business: resolve(__dirname, 'business.html'),
      },
    },
  },
  server: { port: 5173, host: true },
})
