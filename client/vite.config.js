import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /ws to the Node backend, so the browser talks to a single
// origin and API keys never leave the server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
