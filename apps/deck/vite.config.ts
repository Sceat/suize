import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Suize Deck — the interactive pitch/architecture app (standalone origin).
export default defineConfig({
  plugins: [react()],
  server: { port: 5190, host: true },
});
