import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Express API (server.mjs) owns the LLM routes; Vite owns the UI.
// In dev they run side by side and Vite proxies the API calls across.
const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': API,
      '/query': API,
      '/set-context': API,
    },
  },
  build: { outDir: 'dist' },
});
