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
  // Plan 06 added React Email templates (.tsx). esbuild's default `transform`
  // JSX mode is the classic runtime, which requires `React` in scope. Use the
  // automatic runtime (React 17+) so templates do not need a `React` import.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Next.js `server-only` is a virtual package shipped only by Next at
      // build time; in a vitest (Node) run we alias it to a no-op stub so
      // any source module guarded by `import 'server-only'` loads cleanly.
      // Without this alias every test that transitively imports the tRPC
      // app router fails at module-load time (the storage client guards
      // itself with `server-only`). Plan 03-08 Rule 3 deviation.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
