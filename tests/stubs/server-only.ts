/**
 * Vitest stub for Next.js's `server-only` virtual package.
 *
 * Next.js ships `server-only` as a small npm shim that throws when imported
 * from the client bundle. In a Node test environment (vitest) there's no
 * client/server split, so the package isn't installed by default. Without
 * a stub, every test file that transitively imports a `server-only`-guarded
 * module (e.g. `src/server/storage/client.ts`) fails to load.
 *
 * This stub is a no-op — server modules are always safe to load in tests.
 *
 * Wired via `vitest.config.ts` resolve.alias.
 */
export {};
