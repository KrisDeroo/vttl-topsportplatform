/**
 * Schema barrel re-export — ALL Phase-1 core tables.
 *
 * Plan 02 wired auth, lookups, memberships, consent, audit, and
 * idempotency. Plan 03 (this update) appends `./medical` for the
 * pgcrypto-encrypted Article-9 tables and the dedicated
 * `medical_access_audit`. Plan 04 will extend with RLS policies (no
 * additional table imports — policies live in the migration SQL).
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
export * from './medical';
