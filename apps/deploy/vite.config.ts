import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Suize Deploy dashboard. Unique dev port 5183 (crash uses 5173).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5183,
  },
})
