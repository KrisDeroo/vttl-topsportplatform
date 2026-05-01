/**
 * TIMESTAMPTZ helper — GDPR-08, RESEARCH §TIMESTAMPTZ helper.
 *
 * Drizzle's `timestamp(name)` defaults to `TIMESTAMP WITHOUT TIME ZONE`,
 * which silently drops the offset. Every datetime in the VTTL platform
 * MUST be `TIMESTAMPTZ` so cross-region reads (Belgium UI vs UTC
 * Postgres vs UTC backups) never disagree on what "now" is.
 *
 * Use only this helper in schema files. An ESLint rule (Plan 18) will
 * forbid bare `timestamp(...)` outside this file.
 *
 *   userCreatedAt: tstz('created_at', { defaultNow: true }).notNull(),
 *   sessionExpiresAt: tstz('expires_at').notNull(),
 *
 * `mode: 'date'` returns a JS `Date` — kept consistent across the codebase
 * so we never accidentally compare a string date to a Date in business
 * logic.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §TIMESTAMPTZ helper (lines 514-526)
 */
import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Always TIMESTAMPTZ; defaults to NOW() in UTC when `defaultNow` is set.
 * Never use Drizzle's `timestamp()` directly outside this helper.
 */
export const tstz = (name: string, opts?: { defaultNow?: boolean }) => {
  const col = timestamp(name, { withTimezone: true, mode: 'date' });
  return opts?.defaultNow ? col.defaultNow() : col;
};
