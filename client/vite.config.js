import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.MOCKFORGE_SERVER || 'http://localhost:4000';

export default defineConfig({
  base: '/__mockforge/',
  plugins: [react()],
  // Nested so static hosts (Vercel) serve the UI at /__mockforge/ straight from client/dist.
  build: { outDir: 'dist/__mockforge', emptyOutDir: true },
  server: {
    port: 5173,
    open: '/__mockforge/',
    proxy: { '/__mockforge/api': server },
  },
});
