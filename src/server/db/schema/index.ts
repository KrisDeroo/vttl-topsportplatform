/**
 * Schema barrel re-export.
 *
 * Plan 01-02 fills this with real schema imports (auth, lookups, memberships,
 * consent, audit, idempotency). Plan 01-03 adds medical isolation tables.
 *
 * Empty re-export until then so:
 *  - drizzle-kit reads a real (empty) schema instead of crashing on missing file
 *  - `import * as schema from '@/server/db/schema'` works in client wiring (Plan 02)
 */
export {};
