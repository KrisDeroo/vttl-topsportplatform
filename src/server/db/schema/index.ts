/**
 * Schema barrel re-export — ALL Phase-1 core tables.
 *
 * Plan 02 (this file) wires the auth, lookups, memberships, consent,
 * audit, and idempotency schemas. Plan 03 will append `./medical`
 * for the encrypted medical-isolation tables.
 *
 * Drizzle Kit reads this barrel as the single source of truth for
 * `drizzle-kit generate` / `migrate` (see drizzle.config.ts).
 *
 * `import * as schema from '@/server/db/schema'` in client.ts gives
 * Drizzle visibility to every table for relational query helpers.
 */
export * from './auth';
export * from './lookups';
export * from './memberships';
export * from './consent';
export * from './audit';
export * from './idempotency';
