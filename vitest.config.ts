import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    // Test-only values that always win over the private .env, so the suite
    // runs the same in a fresh clone or worktree. The .invalid host can never
    // resolve, so a test that forgets its fetch stub fails instead of reaching
    // the real backend.
    env: {
      VITE_SUPABASE_URL: 'https://hyper-test.invalid',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_PHOTO_WORKER_URL: '',
      VITE_FOOD_ANALYSIS_MODE: '',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
