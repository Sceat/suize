import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// suize.io — the flagship Dispatch front page. Unique dev port 5184
// (crash 5173, deploy 5183).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5184,
  },
})
