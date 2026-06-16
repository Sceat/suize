import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Suize Agents — STANDALONE at agents.suize.io: the public live directory of
// AI-agent commerce on Suize (the on-chain x402 payment feed, the merchant
// volume leaderboard, and the on-chain ad-slot auction). Read-only by default;
// the ONE write is an ad-slot bid, signed LOCALLY via dapp-kit (the bidder pays
// their own gas — non-sponsored v1). This origin runs its OWN Enoki Google
// zkLogin (registered in main.tsx) so a visitor can sign in and bid without
// leaving the page; no SSO bridge.
//
// DEV: this server on 5174 (pay holds 5173, the wallet 5180). Data comes from
// the unified backend (config API_BASE → http://localhost:8099 in dev).
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
})
