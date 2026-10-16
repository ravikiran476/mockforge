import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.MOCKFORGE_SERVER || 'http://localhost:4000';

export default defineConfig({
  base: '/__mockforge/',
  plugins: [react()],
  server: {
    port: 5173,
    open: '/__mockforge/',
    proxy: { '/__mockforge/api': server },
  },
});
