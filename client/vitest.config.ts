import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

export default defineConfig({
  envDir: false,
  server: { host: '127.0.0.1' },
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    include: ['src/**/*.spec.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    env: {
      VITE_API_URL: 'http://127.0.0.1:9',
      VITE_SUPABASE_URL: 'http://127.0.0.1:9',
      VITE_SUPABASE_ANON_KEY: 'offline-component-test-key',
    },
  },
});
