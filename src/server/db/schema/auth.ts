/**
 * Auth schema — users, sessions, accounts, verifications.
 *
 * Better Auth-aligned: Better Auth's Drizzle adapter expects the
 * shapes (user, session, account, verification). We extend `users`
 * with VTTL-specific fields (role, preferredLocale, dateOfBirth,
 * active flag) — never override columns that Better Auth manages
 * (id, email, emailVerified, name, image).
 *
 * Two enums:
 *  - `localeEnum` — nl/en/fr (I18N-02). Default 'nl' (Belgian Flemish
 *    primary audience). Order matters: a 4th locale would shift
 *    enum ordinal positions and break any pg_dump comparisons.
 *  - `userRoleEnum` — 7 roles (D-11). Order matters for pg_dump
 *    diffs as well; do not reorder.
 *
 * `users.active` defaults to `false`: AUTH-04 requires the technical
 * director to explicitly activate accounts. A new registration is
 * inert until activated — prevents drive-by enumeration of registered
 * email addresses.
 *
 * `sessions.freshUntil` is the SEC-03 re-auth window: actions like
 * linking a parent-child or accessing medical data require a "fresh"
 * session (re-auth within last 5 minutes). Plan 11 (CallerContext)
 * checks this column before allowing those actions.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Users + sessions (lines 580-642)
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, uuid, pgEnum, date } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';

/** Supported UI locales — I18N-02. */
export const localeEnum = pgEnum('locale', ['nl', 'en', 'fr']);

/** VTTL role hierarchy — D-11. Order is fixed; reordering shifts pg_dump ordinals. */
export const userRoleEnum = pgEnum('user_role', [
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(), // canonical proper noun
  image: text('image'), // profile photo URL — populated in Phase 2
  role: userRoleEnum('role').notNull().default('player'),
  preferredLocale: localeEnum('preferred_locale').notNull().default('nl'), // I18N-02
  // dateOfBirth nullable in Phase 1 because TD/staff users don't need it.
  // Phase 2 player flow makes this NOT NULL via expand-contract migration.
  dateOfBirth: date('date_of_birth'),
  /**
   * `is_minor` — generated stored column (Plan 12, Migration 0003).
   *
   * The `canActivate` minor-gate (`src/server/auth/activate.ts`, GDPR-02)
   * needs a deterministic boolean per user. Computing it in app code (`age
   * < 16`) at every check would re-introduce wall-clock drift between
   * application and DB rows on the day of a user's 16th birthday; computing
   * it via `(CURRENT_DATE - date_of_birth) < INTERVAL '16 years'` inside a
   * stored generated column delegates the truth to Postgres so RLS policies
   * (and any non-application reader) see the same value.
   *
   *   - NULL when `date_of_birth IS NULL` — adult/staff users without DOB
   *     are not minors but also not non-minors; the minor-gate explicitly
   *     blocks `IS TRUE` (i.e. NULL → not a minor for activation purposes).
   *   - TRUE when `(CURRENT_DATE - date_of_birth) < INTERVAL '16 years'`.
   *   - FALSE otherwise.
   *
   * Postgres only supports STORED generated columns; the migration SQL
   * (drizzle/0003_users_is_minor.sql) emits the `STORED` keyword
   * explicitly. Drizzle 0.45's `generatedAlwaysAs` is single-arg so the
   * `{ mode: 'stored' }` option from newer Drizzle versions is omitted
   * here; the migration is the source of truth for the Postgres-side
   * column definition (CREATE TABLE assertion lives in
   * `tests/unit/migration-format.test.ts` if needed).
   */
  isMinor: boolean('is_minor').generatedAlwaysAs(
    sql`CASE WHEN date_of_birth IS NULL THEN NULL
             WHEN (CURRENT_DATE - date_of_birth) < INTERVAL '16 years' THEN TRUE
             ELSE FALSE END`,
  ),
  // active=false until TD explicitly activates — AUTH-04.
  active: boolean('active').notNull().default(false),
  deactivatedAt: tstz('deactivated_at'),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: tstz('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  // SEC-03: 'fresh' session window for sensitive actions (re-auth required if expired).
  freshUntil: tstz('fresh_until'),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(), // 'credential' for email+password
  accountId: text('account_id').notNull(),
  password: text('password'), // scrypt hash via Better Auth defaults
});

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(), // verification token
  expiresAt: tstz('expires_at').notNull(),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
});
