import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mobile-first dapp; default dev port 5173.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
})
