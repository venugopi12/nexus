import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const api = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@nexus\/shared$/, replacement: path.resolve(__dirname, '../../packages/shared/src/core.ts') },
      { find: /^@nexus\/shared\/schemas$/, replacement: path.resolve(__dirname, '../../packages/shared/src/schemas.ts') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/healthz': api,
      '/socket.io': { target: api, ws: true },
    },
  },
  preview: {
    port: 4273,
    strictPort: true,
    proxy: { '/api': { target: api }, '/healthz': api, '/socket.io': { target: api, ws: true } },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/echarts|zrender/.test(id)) return 'echarts';
          if (/@xyflow|d3-/.test(id)) return 'flow';
          if (/[\\/]motion|framer-motion|motion-dom|motion-utils/.test(id)) return 'motion';
          if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@tanstack)/.test(id)) return 'vendor';
          if (/zod|react-hook-form|@hookform/.test(id)) return 'forms';
          if (/socket\.io|engine\.io|@socket\.io/.test(id)) return 'realtime';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
