import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests only. The server and library suites stay on node:test, which
// needs no transform and no DOM; these need both. Everything under test/ui is
// .jsx so that `node --test` does not pick it up.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/ui/**/*.test.jsx'],
    setupFiles: ['test/ui/setup.jsx'],
  },
});
