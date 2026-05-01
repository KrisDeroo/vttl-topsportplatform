import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globalSetup: ['./tests/setup.ts'],
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    testTimeout: 30_000, // testcontainers boot can take ~10s
    hookTimeout: 60_000,
    pool: 'forks', // separate Postgres container per worker; avoid shared state
    poolOptions: { forks: { singleFork: true } }, // single container, ephemeral schemas per test
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
