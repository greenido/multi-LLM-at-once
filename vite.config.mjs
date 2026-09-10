import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Express API (server.mjs) owns the LLM routes; Vite owns the UI.
// In dev they run side by side and Vite proxies the API calls across.
// 127.0.0.1, not localhost: the API binds loopback IPv4 by default, and on a
// machine where localhost resolves to ::1 first this skips a failed attempt.
const API = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': API,
      '/query': API,
    },
  },
  build: { outDir: 'dist' },
});
