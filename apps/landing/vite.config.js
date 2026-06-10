import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Suize landing — "money for the agentic web." Dark experiential editorial:
// hand-authored CSS, an OGL flow-field shader, Lenis smooth scroll + GSAP
// ScrollTrigger, on the shared brand type triad. Dev port 5173.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
})
