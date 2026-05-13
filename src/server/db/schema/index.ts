/**
 * Schema barrel re-export — ALL core tables.
 *
 * Phase 1 wired auth, lookups, memberships, consent, audit, idempotency,
 * and medical (pgcrypto-encrypted Article-9 + dedicated
 * `medical_access_audit`). RLS policies live in the migration SQL, not
 * here.
 *
 * Phase 2 (02-02) appends `./files`, `./players`, and `./trainers`:
 *  - `./files` exports `uploadedFiles` (single source of truth for every
 *    file managed by the platform — D-30).
 *  - `./players` exports `players` + `ageCategoryHistory` (D-26..D-34,
 *    PLAYER-01..06).
 *  - `./trainers` exports `trainers` (D-26/D-38, TRAINER-01..02).
 *  - The Phase-2 lookup additions (`ageCategories`, `trainerDiploma`)
 *    re-export through the existing `./lookups` line.
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
export * from './files';
export * from './players';
export * from './trainers';
