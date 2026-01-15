import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/types'),
      '@shared-utils': path.resolve(__dirname, '../shared/utils'),
      // Resolve shared package to source for proper ES module handling
      '@claude-code-web/shared': path.resolve(__dirname, '../shared/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,  // Listen on 0.0.0.0 for mobile access
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3333',
        ws: true,
      },
    },
  },
});
