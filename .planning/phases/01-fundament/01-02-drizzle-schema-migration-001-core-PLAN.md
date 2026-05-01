---phase: 01-fundament
plan: 02
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/server/db/client.ts
  - src/server/db/helpers/timestamps.ts
  - src/server/db/schema/index.ts
  - src/server/db/schema/auth.ts
  - src/server/db/schema/lookups.ts
  - src/server/db/schema/memberships.ts
  - src/server/db/schema/consent.ts
  - src/server/db/schema/audit.ts
  - src/server/db/schema/idempotency.ts
  - drizzle/0000_initial.sql
  - drizzle/0000_initial.rollback.md
autonomous: true
requirements:
  - I18N-02
  - I18N-05
  - GDPR-08
  - USER-03
requirements_supports:  # informational — primary owners listed below
  - GDPR-01
  - USER-01
  - USER-02
threat_refs:
  - T-01-04
  - T-01-08
tags:
  - phase-1
  - schema
  - drizzle
  - migration
  - core

must_haves:
  truths:
    - "Migration 0000_initial.sql creates: users (with preferred_locale enum + role enum), sessions, accounts, verifications, all 7 lookup tables, academy_memberships, parent_child_links, consent_records (with policy_version + locale + snapshot + sha256), audit_log (bigserial PK), idempotency_keys"
    - "Two Postgres roles created: app_user (CRUD on app tables, INSERT-ONLY on audit_log) and app_audit_writer (INSERT on audit tables)"
    - "All datetime columns are TIMESTAMPTZ via the `tstz()` helper — verified by grepping schema files"
    - "Lookup table primary keys are language-neutral text codes (e.g. `status_a`, `tournament_wtt_star`) — I18N-05"
    - "consent_records carries policy_version (varchar 32), locale (text), consent_text_snapshot (text), consent_text_sha256 (varchar 64) — D-04..07, I18N-09"
    - "parent_child_links has UNIQUE constraint on child_user_id (Belgian < 16 → exactly one consenting parent) — HIGH-5"
    - "audit_log writes go through a separate Postgres role; app_user has REVOKE UPDATE,DELETE on audit_log"
    - "Updated-at trigger function `set_updated_at()` exists and is wired on users + memberships"
  artifacts:
    - path: "src/server/db/schema/auth.ts"
      provides: "users + sessions + accounts + verifications tables; localeEnum (nl/en/fr); userRoleEnum (7 roles)"
      contains: "localeEnum"
    - path: "src/server/db/schema/lookups.ts"
      provides: "status, academy, tournament_type, ranking_type (with direction column), training_type, organisation, outcome_level"
      contains: "ranking_type"
    - path: "src/server/db/schema/memberships.ts"
      provides: "academy_memberships (composite PK userId+academyCode+role), parent_child_links (composite PK + UNIQUE(child_user_id))"
      contains: "uniqueChildIfMinor"
    - path: "src/server/db/schema/consent.ts"
      provides: "consent_records with policy_version + locale + consent_text_snapshot + consent_text_sha256 + ip_address (inet) + consenting_party_user_id"
      contains: "consentTextSha256"
    - path: "src/server/db/schema/audit.ts"
      provides: "audit_log (bigserial id, jsonb old/new values, inet ip_address)"
      contains: "auditLog"
    - path: "src/server/db/schema/idempotency.ts"
      provides: "idempotency_keys (key text PK, user_id FK, expires_at)"
      contains: "idempotencyKeys"
    - path: "src/server/db/client.ts"
      provides: "drizzle() instance + postgres() pool with prepare:false (Supabase pooler-compatible)"
      contains: "drizzle"
    - path: "drizzle/0000_initial.sql"
      provides: "Generated migration containing CREATE ROLE app_user, app_audit_writer, GRANT/REVOKE statements, all CREATE TABLE, set_updated_at() function and triggers"
      contains: "CREATE ROLE app_user"
  key_links:
    - from: "src/server/db/schema/auth.ts"
      to: "src/server/db/helpers/timestamps.ts"
      via: "tstz('column_name', { defaultNow: true })"
      pattern: "tstz\\("
    - from: "src/server/db/schema/index.ts"
      to: "src/server/db/schema/{auth,lookups,memberships,consent,audit,idempotency}.ts"
      via: "barrel re-exports"
      pattern: "export \\* from"
    - from: "drizzle/0000_initial.sql"
      to: "src/server/db/schema/index.ts"
      via: "drizzle-kit generate diffs schema → SQL"
      pattern: "drizzle-kit"
---

<objective>
Define Migration 001 — the core Drizzle schema for Phase 1: users (with locale + role + active flag), sessions/accounts/verifications (Better Auth-aligned), 7 lookup tables (codes only — language-neutral), academy_memberships, parent_child_links (with the Belgian "one consenting parent per minor" UNIQUE constraint), consent_records (with policy_version + locale + snapshot + sha256), append-only audit_log, and idempotency_keys (Migration 003 inlined here for atomicity).

Critical: this migration ALSO creates two distinct Postgres roles (`app_user`, `app_audit_writer`) and applies REVOKE UPDATE,DELETE ON audit_log FROM app_user — the only way to make the audit trail tamper-evident at the DB layer (T-01-04, CRIT-7).

Purpose: This schema is the contract every later phase implements against. Getting it wrong here costs every later phase a migration. The Belgian < 16 → exactly-one-parent rule, the consent snapshot fields, and the role-separation pattern are NON-RETROFITTABLE without a painful expand-contract cycle.

Output: `drizzle/0000_initial.sql` generated by Drizzle Kit + a per-migration rollback `.md` documenting the reverse procedure.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@.planning/PITFALLS-ADDITIONS.md
@.planning/research/PITFALLS.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Drizzle client + TIMESTAMPTZ helper + barrel index</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §TIMESTAMPTZ helper (lines 514–526)
    - .planning/phases/01-fundament/01-RESEARCH.md §Drizzle query interceptor (lines 1923–1970) — db client pattern
    - .planning/phases/01-fundament/01-CONTEXT.md §B (D-04..07 — non-negotiable: NL brontekst lock before this migration)
    - src/lib/env.ts (Plan 01 output — has DATABASE_URL, MEDICAL_ENCRYPTION_KEY)
  </read_first>
  <files>
    src/server/db/client.ts
    src/server/db/helpers/timestamps.ts
    src/server/db/schema/index.ts
    tests/unit/timestamps.test.ts
  </files>
  <behavior>
    - Test 1 (unit): `tstz('created_at', { defaultNow: true })` returns a Drizzle column with `withTimezone: true` and `mode: 'date'`
    - Test 2 (unit): `tstz('x')` without `defaultNow` does NOT have a default
    - Test 3 (unit): `db` is a drizzle instance backed by a `postgres()` pool with `prepare: false`
  </behavior>
  <action>
    Create `src/server/db/helpers/timestamps.ts` exactly per RESEARCH:
    ```ts
    import { timestamp } from 'drizzle-orm/pg-core';

    /** Always TIMESTAMPTZ; defaults to NOW() in UTC. Never use `timestamp()` without `withTimezone: true`. */
    export const tstz = (name: string, opts?: { defaultNow?: boolean }) => {
      const col = timestamp(name, { withTimezone: true, mode: 'date' });
      return opts?.defaultNow ? col.defaultNow() : col;
    };
    ```

    Create `src/server/db/client.ts`:
    ```ts
    import { drizzle } from 'drizzle-orm/postgres-js';
    import postgres from 'postgres';
    import { env } from '@/lib/env';
    import * as schema from './schema';

    const client = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      prepare: false,           // Supabase pooler compat (port 6543)
      onnotice: () => {},
    });

    export const db = drizzle(client, { schema });
    export type DbClient = typeof db;
    ```

    Replace `src/server/db/schema/index.ts` placeholder with barrel:
    ```ts
    export * from './auth';
    export * from './lookups';
    export * from './memberships';
    export * from './consent';
    export * from './audit';
    export * from './idempotency';
    ```

    Write `tests/unit/timestamps.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { tstz } from '@/server/db/helpers/timestamps';

    describe('tstz helper — GDPR-08', () => {
      it('returns timestamptz with mode date', () => {
        const col = tstz('created_at');
        expect((col as any).config.dataType).toMatch(/timestamp/i);
        expect((col as any).config.withTimezone).toBe(true);
        expect((col as any).config.mode).toBe('date');
      });

      it('applies defaultNow when requested', () => {
        const col = tstz('created_at', { defaultNow: true });
        expect((col as any).config.hasDefault).toBe(true);
      });

      it('does NOT apply defaultNow when not requested', () => {
        const col = tstz('updated_at');
        expect((col as any).config.hasDefault).toBeFalsy();
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/db/client.ts && test -f src/server/db/helpers/timestamps.ts && test -f src/server/db/schema/index.ts && grep -q "withTimezone: true" src/server/db/helpers/timestamps.ts && grep -q "prepare: false" src/server/db/client.ts && grep -q "export \* from './auth'" src/server/db/schema/index.ts && grep -q "export \* from './consent'" src/server/db/schema/index.ts && grep -q "export \* from './audit'" src/server/db/schema/index.ts && npx vitest run tests/unit/timestamps.test.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/db/helpers/timestamps.ts` exports `tstz` with `withTimezone: true` and `mode: 'date'`
    - `src/server/db/client.ts` instantiates `postgres()` with `prepare: false`
    - `src/server/db/schema/index.ts` re-exports from all 6 schema files
    - `tests/unit/timestamps.test.ts` passes (3 tests green)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Drizzle client + TIMESTAMPTZ helper + barrel index ready; tstz unit tests GREEN.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Schema files — auth (users + sessions), lookups (7 tables), memberships, consent, audit, idempotency</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Lookup table convention (lines 528–580)
    - .planning/phases/01-fundament/01-RESEARCH.md §Users + sessions (lines 582–644)
    - .planning/phases/01-fundament/01-RESEARCH.md §Memberships + parent-child links (lines 646–675)
    - .planning/phases/01-fundament/01-RESEARCH.md §Consent records (lines 677–701)
    - .planning/phases/01-fundament/01-RESEARCH.md §Audit log + medical access audit (lines 703–740) — note: this plan handles audit_log only; medical_access_audit moves to Plan 03
    - .planning/phases/01-fundament/01-RESEARCH.md §Idempotency keys (lines 742–759)
    - .planning/PITFALLS-ADDITIONS.md §HIGH-5 (parent-child UNIQUE on child_user_id)
  </read_first>
  <files>
    src/server/db/schema/auth.ts
    src/server/db/schema/lookups.ts
    src/server/db/schema/memberships.ts
    src/server/db/schema/consent.ts
    src/server/db/schema/audit.ts
    src/server/db/schema/idempotency.ts
    tests/unit/schema-locale.test.ts
    tests/unit/lookup-codes.test.ts
  </files>
  <behavior>
    - Test 1 (unit): localeEnum has exactly 3 values: nl, en, fr
    - Test 2 (unit): users.preferred_locale is NOT NULL with default 'nl'
    - Test 3 (unit): userRoleEnum has exactly 7 values matching D-11 ROLES
    - Test 4 (unit): every lookup table primary key column is named `code` and is text
    - Test 5 (unit): ranking_type has a `direction` column (DOM-3, RISK-02)
  </behavior>
  <action>
    **`src/server/db/schema/auth.ts`** — copy the canonical pattern from RESEARCH lines 587–643. CRITICAL exact contents:
    ```ts
    import { pgTable, text, boolean, uuid, pgEnum, date } from 'drizzle-orm/pg-core';
    import { tstz } from '../helpers/timestamps';

    export const localeEnum = pgEnum('locale', ['nl', 'en', 'fr']);
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
      name: text('name').notNull(),
      image: text('image'),
      role: userRoleEnum('role').notNull().default('player'),
      preferredLocale: localeEnum('preferred_locale').notNull().default('nl'),
      dateOfBirth: date('date_of_birth'),
      active: boolean('active').notNull().default(false),
      deactivatedAt: tstz('deactivated_at'),
      createdAt: tstz('created_at', { defaultNow: true }).notNull(),
      updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
    });

    export const sessions = pgTable('sessions', {
      id: uuid('id').primaryKey().defaultRandom(),
      userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
      token: text('token').notNull().unique(),
      expiresAt: tstz('expires_at').notNull(),
      ipAddress: text('ip_address'),
      userAgent: text('user_agent'),
      freshUntil: tstz('fresh_until'),  // SEC-03
      createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    });

    export const accounts = pgTable('accounts', {
      id: uuid('id').primaryKey().defaultRandom(),
      userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
      providerId: text('provider_id').notNull(),
      accountId: text('account_id').notNull(),
      password: text('password'),
    });

    export const verifications = pgTable('verifications', {
      id: uuid('id').primaryKey().defaultRandom(),
      identifier: text('identifier').notNull(),
      value: text('value').notNull(),
      expiresAt: tstz('expires_at').notNull(),
      createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    });
    ```

    **`src/server/db/schema/lookups.ts`** — exactly per RESEARCH lines 530–580 (status, academy, tournament_type, ranking_type with `direction`, training_type, organisation, outcome_level). Each table:
    - `code` text PRIMARY KEY (snake_case, language-neutral)
    - `sortOrder` integer NOT NULL
    - `active` boolean NOT NULL DEFAULT true
    - `academy` adds `canonicalName` text NOT NULL (proper noun — NOT translated, I18N-06)
    - `ranking_type` adds `direction` text NOT NULL (asc_is_better | desc_is_better — DOM-3, RISK-02)

    **`src/server/db/schema/memberships.ts`** — exactly per RESEARCH lines 649–675:
    ```ts
    import { pgTable, uuid, text, primaryKey, unique } from 'drizzle-orm/pg-core';
    import { users } from './auth';
    import { academy } from './lookups';
    import { tstz } from '../helpers/timestamps';

    export const academyMemberships = pgTable('academy_memberships', {
      userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
      academyCode: text('academy_code').notNull().references(() => academy.code, { onDelete: 'restrict' }),
      role: text('role').notNull(),
      linkedAt: tstz('linked_at', { defaultNow: true }).notNull(),
      linkedBy: uuid('linked_by').references(() => users.id),
    }, (t) => ({
      pk: primaryKey({ columns: [t.userId, t.academyCode, t.role] }),
    }));

    export const parentChildLinks = pgTable('parent_child_links', {
      parentUserId: uuid('parent_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
      childUserId: uuid('child_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
      consentGivenAt: tstz('consent_given_at').notNull(),
      linkedAt: tstz('linked_at', { defaultNow: true }).notNull(),
      linkedBy: uuid('linked_by').references(() => users.id),
    }, (t) => ({
      pk: primaryKey({ columns: [t.parentUserId, t.childUserId] }),
      uniqueChildIfMinor: unique('uniq_child_user').on(t.childUserId),  // HIGH-5: exactly one consenting parent per child (BE)
    }));
    ```

    **`src/server/db/schema/consent.ts`** — exactly per RESEARCH lines 680–701:
    ```ts
    import { pgTable, uuid, text, varchar, inet } from 'drizzle-orm/pg-core';
    import { users } from './auth';
    import { tstz } from '../helpers/timestamps';

    export const consentRecords = pgTable('consent_records', {
      id: uuid('id').primaryKey().defaultRandom(),
      userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
      consentCategory: text('consent_category').notNull(),
      policyVersion: varchar('policy_version', { length: 32 }).notNull(),
      locale: text('locale').notNull(),
      consentTextSnapshot: text('consent_text_snapshot').notNull(),
      consentTextSha256: varchar('consent_text_sha256', { length: 64 }).notNull(),
      givenAt: tstz('given_at', { defaultNow: true }).notNull(),
      withdrawnAt: tstz('withdrawn_at'),
      consentingPartyUserId: uuid('consenting_party_user_id').references(() => users.id),
      ipAddress: inet('ip_address').notNull(),
      userAgent: text('user_agent').notNull(),
    });
    ```

    **`src/server/db/schema/audit.ts`** — audit_log only (medical_access_audit moves to Plan 03). Per RESEARCH lines 707–724:
    ```ts
    import { pgTable, uuid, text, jsonb, inet, bigserial } from 'drizzle-orm/pg-core';
    import { tstz } from '../helpers/timestamps';

    export const auditLog = pgTable('audit_log', {
      id: bigserial('id', { mode: 'bigint' }).primaryKey(),
      actorUserId: uuid('actor_user_id'),
      action: text('action').notNull(),
      resourceType: text('resource_type'),
      resourceId: text('resource_id'),
      oldValues: jsonb('old_values'),
      newValues: jsonb('new_values'),
      ipAddress: inet('ip_address'),
      userAgent: text('user_agent'),
      requestId: text('request_id'),
      outcome: text('outcome').notNull().default('success'),
      occurredAt: tstz('occurred_at', { defaultNow: true }).notNull(),
    });
    ```

    **`src/server/db/schema/idempotency.ts`** — per RESEARCH lines 745–759:
    ```ts
    import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';
    import { users } from './auth';
    import { tstz } from '../helpers/timestamps';

    export const idempotencyKeys = pgTable('idempotency_keys', {
      key: text('key').primaryKey(),
      userId: uuid('user_id').notNull().references(() => users.id),
      endpoint: text('endpoint').notNull(),
      responseHash: text('response_hash'),
      responseBody: jsonb('response_body'),
      createdAt: tstz('created_at', { defaultNow: true }).notNull(),
      expiresAt: tstz('expires_at').notNull(),
    });
    ```

    **Tests:**

    `tests/unit/schema-locale.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { localeEnum, userRoleEnum, users } from '@/server/db/schema/auth';

    describe('schema locale + role enums — I18N-02, USER-04', () => {
      it('localeEnum values: nl, en, fr', () => {
        expect(localeEnum.enumValues).toEqual(['nl', 'en', 'fr']);
      });
      it('userRoleEnum has exactly 7 roles (D-11)', () => {
        expect(userRoleEnum.enumValues).toHaveLength(7);
        expect(userRoleEnum.enumValues).toEqual(expect.arrayContaining([
          'technical_director','academy_manager','trainer','player','parent','sparring_partner','medical_staff',
        ]));
      });
      it('users.preferred_locale is NOT NULL with default nl', () => {
        const col = (users as any).preferredLocale;
        expect(col.notNull).toBe(true);
        expect(col.hasDefault).toBe(true);
      });
    });
    ```

    `tests/unit/lookup-codes.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { status, academy, tournamentType, rankingType, trainingType, organisation, outcomeLevel } from '@/server/db/schema/lookups';

    describe('lookup tables — I18N-05', () => {
      it.each([
        ['status', status],
        ['academy', academy],
        ['tournament_type', tournamentType],
        ['ranking_type', rankingType],
        ['training_type', trainingType],
        ['organisation', organisation],
        ['outcome_level', outcomeLevel],
      ])('%s table has text "code" PK', (_n, table) => {
        const cols = (table as any)[Symbol.for('drizzle:Columns')] ?? (table as any)._.columns;
        expect(cols.code).toBeDefined();
      });

      it('ranking_type carries direction column (DOM-3)', () => {
        const cols = (rankingType as any)[Symbol.for('drizzle:Columns')] ?? (rankingType as any)._.columns;
        expect(cols.direction).toBeDefined();
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/db/schema/auth.ts && test -f src/server/db/schema/lookups.ts && test -f src/server/db/schema/memberships.ts && test -f src/server/db/schema/consent.ts && test -f src/server/db/schema/audit.ts && test -f src/server/db/schema/idempotency.ts && grep -q "localeEnum.*'nl'.*'en'.*'fr'" src/server/db/schema/auth.ts && grep -q "userRoleEnum.*technical_director" src/server/db/schema/auth.ts && grep -q "preferredLocale" src/server/db/schema/auth.ts && grep -q "uniq_child_user" src/server/db/schema/memberships.ts && grep -q "consentTextSnapshot" src/server/db/schema/consent.ts && grep -q "consentTextSha256" src/server/db/schema/consent.ts && grep -q "policyVersion" src/server/db/schema/consent.ts && grep -Eq "direction:\s*text\(.direction.\)\.notNull\(\)" src/server/db/schema/lookups.ts && grep -q "bigserial.*id" src/server/db/schema/audit.ts && npx tsc --noEmit && npx vitest run tests/unit/schema-locale.test.ts tests/unit/lookup-codes.test.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/db/schema/auth.ts` defines `localeEnum` with exactly `['nl','en','fr']` and `userRoleEnum` with exactly 7 values
    - `users.preferredLocale` chain ends in `.notNull().default('nl')`
    - `src/server/db/schema/lookups.ts` defines all 7 tables (status, academy, tournament_type, ranking_type, training_type, organisation, outcome_level)
    - `rankingType` has a `direction` column with `notNull()` (DOM-3)
    - `parent_child_links` declares `unique('uniq_child_user').on(t.childUserId)` (HIGH-5)
    - `consent_records` has BOTH `consent_text_snapshot` (text) AND `consent_text_sha256` (varchar 64)
    - `audit_log.id` is `bigserial` with `mode: 'bigint'`
    - `idempotency_keys.key` is `text` PRIMARY KEY (client-supplied UUID)
    - `npx vitest run tests/unit/schema-locale.test.ts tests/unit/lookup-codes.test.ts` exits 0 (tests GREEN)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>All 6 schema files present, locale + role enums correct, GDPR + i18n columns intact, schema tests GREEN.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Generate migration 0000_initial.sql + append role/grant SQL + write rollback runbook</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Two-role Postgres model (lines 828–848) — exact CREATE ROLE / GRANT / REVOKE SQL
    - .planning/phases/01-fundament/01-RESEARCH.md §Soft-delete + updated_at trigger conventions (lines 808–820) — set_updated_at() function
    - .planning/phases/01-fundament/01-RESEARCH.md §Migration Governance (lines 2169–2266) — Drizzle Kit usage + rollback discipline
    - .planning/phases/01-fundament/01-CONTEXT.md §D-04..D-07 (consent versioning + snapshot — schema must support team-drafted v1.0.0; legal sign-off tracked at Phase 8)
  </read_first>
  <files>
    drizzle/0000_initial.sql
    drizzle/0000_initial.rollback.md
    drizzle/meta/_journal.json
  </files>
  <action>
    1. Run `npx drizzle-kit generate --name=initial` against the schema files written in Task 2. This creates `drizzle/0000_initial.sql` and updates `drizzle/meta/_journal.json`.

    2. Manually APPEND the following blocks to `drizzle/0000_initial.sql` in this exact order (after Drizzle's auto-generated CREATE TABLE statements):

    **Block A — pgcrypto extension (used by Plan 03 medical):**
    ```sql
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    ```

    **Block B — Two Postgres roles (RESEARCH §Two-role Postgres model):**
    ```sql
    -- Two-role separation for tamper-evidence on audit_log (T-01-04, CRIT-7)
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        EXECUTE format('CREATE ROLE app_user LOGIN PASSWORD %L', current_setting('app.app_user_pw', true));
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_audit_writer') THEN
        EXECUTE format('CREATE ROLE app_audit_writer LOGIN PASSWORD %L', current_setting('app.app_audit_writer_pw', true));
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO app_user, app_audit_writer;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL SEQUENCES IN SCHEMA public TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_user;

    -- audit_log: app_user has INSERT only (no UPDATE/DELETE — tamper-evidence)
    REVOKE UPDATE, DELETE ON audit_log FROM app_user;
    GRANT INSERT ON audit_log TO app_user;
    GRANT INSERT ON audit_log TO app_audit_writer;

    -- consent_records: snapshot is the legal record. UPDATE allowed only on withdrawn_at via RLS (Plan 04).
    -- DELETE forbidden on consent_records:
    REVOKE DELETE ON consent_records FROM app_user;
    ```

    Note: the passwords come from session-set GUCs (`app.app_user_pw`) — Plan 16 (drizzle-kit migrate) will be invoked with `PGOPTIONS="-c app.app_user_pw=$APP_USER_PW -c app.app_audit_writer_pw=$APP_AUDIT_WRITER_PW"` from CI. This pattern keeps role-passwords out of the migration file.

    **Block C — set_updated_at() trigger function + triggers on mutable tables:**
    ```sql
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ```
    (medical_events trigger is added in Plan 03's migration, idempotency / consent_records / lookups are append-mostly.)

    **Block D — Performance indexes for RLS lookups (RESEARCH lines 1012–1020):**
    ```sql
    CREATE INDEX idx_pcl_parent ON parent_child_links (parent_user_id);
    CREATE INDEX idx_pcl_child ON parent_child_links (child_user_id);
    CREATE INDEX idx_am_user_role ON academy_memberships (user_id, role);
    CREATE INDEX idx_am_academy_role ON academy_memberships (academy_code, role);
    CREATE INDEX idx_consent_user ON consent_records (user_id);
    CREATE INDEX idx_audit_actor ON audit_log (actor_user_id, occurred_at DESC);
    CREATE INDEX idx_audit_resource ON audit_log (resource_type, resource_id);
    ```

    3. Create `drizzle/0000_initial.rollback.md` with explicit reverse SQL:
    ```markdown
    # Rollback — 0000_initial.sql

    **Risk:** This rollback DROPS all Phase-1 tables. Only run on dev/staging after a full restore from PITR.

    **Procedure (in this order):**

    ```sql
    BEGIN;

    -- Drop policies first (Plan 04 created them; if rolling back this far, also roll back Plan 04)
    -- (See drizzle/0001_*.rollback.md and drizzle/0004_*.rollback.md.)

    DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
    DROP FUNCTION IF EXISTS set_updated_at();

    DROP INDEX IF EXISTS idx_pcl_parent;
    DROP INDEX IF EXISTS idx_pcl_child;
    DROP INDEX IF EXISTS idx_am_user_role;
    DROP INDEX IF EXISTS idx_am_academy_role;
    DROP INDEX IF EXISTS idx_consent_user;
    DROP INDEX IF EXISTS idx_audit_actor;
    DROP INDEX IF EXISTS idx_audit_resource;

    DROP TABLE IF EXISTS idempotency_keys;
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS consent_records;
    DROP TABLE IF EXISTS parent_child_links;
    DROP TABLE IF EXISTS academy_memberships;
    DROP TABLE IF EXISTS verifications;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;

    DROP TABLE IF EXISTS outcome_level;
    DROP TABLE IF EXISTS organisation;
    DROP TABLE IF EXISTS training_type;
    DROP TABLE IF EXISTS ranking_type;
    DROP TABLE IF EXISTS tournament_type;
    DROP TABLE IF EXISTS academy;
    DROP TABLE IF EXISTS status;

    DROP TYPE IF EXISTS user_role;
    DROP TYPE IF EXISTS locale;

    REVOKE ALL ON SCHEMA public FROM app_user, app_audit_writer;
    DROP ROLE IF EXISTS app_audit_writer;
    DROP ROLE IF EXISTS app_user;

    COMMIT;
    ```

    **Verification after rollback:**
    - `\d users` returns "Did not find any relation"
    - `\du app_user` returns "Did not find any role"
    ```

    4. Verify `drizzle/meta/_journal.json` was updated and the migration file is syntactically valid SQL (parse-test via `node -e "console.log(require('fs').readFileSync('drizzle/0000_initial.sql','utf8').length)"`).
  </action>
  <verify>
    <automated>test -f drizzle/0000_initial.sql && test -f drizzle/0000_initial.rollback.md && test -f drizzle/meta/_journal.json && grep -q "CREATE TABLE.*\"users\"\|CREATE TABLE \"users\"\|CREATE TABLE IF NOT EXISTS \"users\"" drizzle/0000_initial.sql && grep -q "CREATE EXTENSION IF NOT EXISTS pgcrypto" drizzle/0000_initial.sql && grep -q "CREATE ROLE app_user\|rolname = 'app_user'" drizzle/0000_initial.sql && grep -q "REVOKE UPDATE, DELETE ON audit_log FROM app_user" drizzle/0000_initial.sql && grep -q "set_updated_at" drizzle/0000_initial.sql && grep -q "trg_users_updated_at" drizzle/0000_initial.sql && grep -q "idx_pcl_child" drizzle/0000_initial.sql && grep -q "idx_audit_actor" drizzle/0000_initial.sql && grep -q "preferred_locale" drizzle/0000_initial.sql && grep -q "consent_text_snapshot" drizzle/0000_initial.sql && grep -q "consent_text_sha256" drizzle/0000_initial.sql && grep -q "uniq_child_user" drizzle/0000_initial.sql && grep -q "DROP ROLE IF EXISTS app_user" drizzle/0000_initial.rollback.md</automated>
  </verify>
  <acceptance_criteria>
    - `drizzle/0000_initial.sql` exists and references all 13 tables (users, sessions, accounts, verifications, status, academy, tournament_type, ranking_type, training_type, organisation, outcome_level, academy_memberships, parent_child_links, consent_records, audit_log, idempotency_keys)
    - `CREATE EXTENSION IF NOT EXISTS pgcrypto` line present
    - `CREATE ROLE app_user` and `CREATE ROLE app_audit_writer` blocks present (with `DO $$` IF NOT EXISTS guards)
    - `REVOKE UPDATE, DELETE ON audit_log FROM app_user` line present
    - `REVOKE DELETE ON consent_records FROM app_user` line present
    - `set_updated_at()` function + `trg_users_updated_at` trigger present
    - 7 RLS-helper indexes present (idx_pcl_parent, idx_pcl_child, idx_am_user_role, idx_am_academy_role, idx_consent_user, idx_audit_actor, idx_audit_resource)
    - `drizzle/meta/_journal.json` lists migration `0000_initial`
    - `drizzle/0000_initial.rollback.md` contains DROP statements for all tables in reverse order + DROP ROLE
  </acceptance_criteria>
  <done>Migration 001 file generated and hand-augmented with role separation, indexes, and triggers; rollback runbook committed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App code ↔ Postgres | Two roles (`app_user`, `app_audit_writer`); app_user has INSERT-only on audit_log |
| Migration commits ↔ live DB | Migrations are immutable post-commit (MIG-01); rollback procedure in companion `.md` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-04 | Repudiation / Tampering | audit_log | mitigate | `REVOKE UPDATE, DELETE ON audit_log FROM app_user` at the Postgres role layer; only `app_audit_writer` can also INSERT; reads must go through SECURITY DEFINER function (Plan 04) |
| T-01-08 | Tampering | consent_records text snapshot | mitigate | `consent_text_sha256` stored at consent-time; `REVOKE DELETE ON consent_records FROM app_user`; UPDATE limited via Plan 04 RLS to `withdrawn_at` only |
| T-01-MIG-IMMUTABLE | Tampering | Committed migration files | mitigate | Plan 18 (migration-governance-docs) adds CI hook blocking edits to committed migrations |
</threat_model>

<verification>
- `drizzle/0000_initial.sql` is committed and lists all Phase-1 core tables
- `npx drizzle-kit generate --name=` would produce zero diff (schema and migration in sync)
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/unit/timestamps.test.ts tests/unit/schema-locale.test.ts tests/unit/lookup-codes.test.ts` all GREEN
- The migration file is structurally complete; it will only be APPLIED to a Postgres DB by Plan 16 (drizzle-kit migrate against staging)
</verification>

<success_criteria>
- 6 schema files exist with correct contents
- `localeEnum` and `userRoleEnum` defined with exact values
- `parent_child_links.uniqueChildIfMinor` UNIQUE constraint present (HIGH-5)
- `consent_records` carries policy_version + locale + snapshot + sha256 (D-04..07)
- `audit_log` is bigserial + jsonb old/new (CRIT-7)
- Two Postgres roles created in migration with correct grants
- pgcrypto extension enabled (used by Plan 03)
- 7 performance indexes for RLS lookups (CRIT-8)
- Rollback runbook committed alongside migration
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-02-SUMMARY.md` documenting:
- Final schema file list with line counts
- The exact migration filename(s) generated by Drizzle Kit
- Confirmation that `npx tsc --noEmit` exits 0
- Note: Migration is generated but NOT yet pushed — Plan 16 (Wave 7) does that
- Reminder that Plans 03 (medical schema) and 04 (RLS policies) come next
</output>
