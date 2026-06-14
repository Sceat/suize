import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Suize Pay — STANDALONE at pay.suize.io (owner 2026-06-11; the /pay base-path
// era on the wallet origin is over — the SSO bridge replaced the same-origin
// trick). Identity comes from the WALLET origin via the bridge
// (src/bridge-client.ts): the hidden /bridge iframe answers "who is signed
// in"; the visible /confirm popup signs money. This app registers NO Enoki
// wallet and has NO /enoki OAuth return — auth is the wallet origin only
// (the old /connect MCP door was removed 2026-06-11 with the consolidation).
//
// DEV: this server on 5173, the WALLET dev server on 5180 (run it — the bridge
// points there via config BRIDGE_ORIGIN; override with VITE_BRIDGE_ORIGIN).
// Sessions are origin-scoped: sign into the wallet at localhost:5180 first,
// then localhost:5173/?to=…&amount=… exercises the full bridge flow.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
})
