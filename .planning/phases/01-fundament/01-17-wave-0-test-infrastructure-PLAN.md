---phase: 01-fundament
plan: 17
type: tdd
wave: 1
depends_on: []
files_modified:
  - vitest.config.ts
  - playwright.config.ts
  - tests/setup.ts
  - tests/helpers/db.ts
  - tests/helpers/seed.ts
  - tests/integration/rbac-matrix.test.ts
  - tests/rls/direct-query.test.ts
  - tests/rls/medical-isolation.test.ts
  - tests/integration/email-locale.test.ts
  - tests/integration/locale-resolve.test.ts
  - tests/integration/consent.test.ts
  - tests/integration/ratelimit.test.ts
  - tests/e2e/register-with-consent.spec.ts
  - tests/e2e/auth.spec.ts
  - tests/e2e/locale-switcher.spec.ts
  - tests/e2e/health.spec.ts
  - .github/workflows/ci.yml
autonomous: true
requirements:
requirements_supports:  # informational — primary owners listed below
  - SEC-08
  - SEC-09
threat_refs:
  - T-01-02
  - T-01-03
  - T-01-05
tags:
  - phase-1
  - tdd
  - validation
  - testing
  - wave-0

must_haves:
  truths:
    - "Vitest test runner boots a Postgres testcontainer per test file with all migrations applied"
    - "Playwright config defines chromium + firefox + webkit projects with `nl-BE` locale default"
    - "RBAC matrix test enumerates exactly 35 cases (7 roles × 5 resources) — D-11"
    - "medical_events probe in RBAC matrix uses raw SQL via rawPgAsAppUser (CRIT-2 — RLS verified at DB layer, no Phase-1 caller.medical router)"
    - "parent_child_links probe routes parent/player roles to consent.listMyParentLinks (Plan 12) and TD/medical_staff to admin.user.listParentLinks (Plan 15) — CRIT-3"
    - "RLS direct-query test connects as `app_user` Postgres role (NOT Drizzle) and proves `SELECT * FROM medical_events` returns 0 rows for non-owner"
    - "Wave-0 tests are RED on creation (no implementation yet); they turn GREEN as later plans land"
  artifacts:
    - path: "vitest.config.ts"
      provides: "Vitest runner with testcontainers Postgres bootstrap; per-test ephemeral DB"
      contains: "@testcontainers/postgresql"
    - path: "playwright.config.ts"
      provides: "Playwright runner: 3 browser projects, baseURL, locale=nl-BE"
      contains: "projects:"
    - path: "tests/integration/rbac-matrix.test.ts"
      provides: "D-11 35-test matrix (technical_director, academy_manager, trainer, player, parent, sparring_partner, medical_staff × users, consent_records, medical_events, audit_log, parent_child_links)"
      contains: "describe.each"
    - path: "tests/rls/direct-query.test.ts"
      provides: "Raw pg.Client as app_user role with SET LOCAL — proves RLS blocks non-owner reads"
      contains: "SET LOCAL app.user_role"
    - path: "tests/rls/medical-isolation.test.ts"
      provides: "Direct SQL test that medical_events returns 0 rows for trainer role"
      contains: "medical_events"
    - path: "tests/integration/email-locale.test.ts"
      provides: "Mocks Mailgun fetch; asserts subject + body match user's preferred_locale (nl/en/fr)"
      contains: "preferredLocale"
    - path: "tests/e2e/register-with-consent.spec.ts"
      provides: "Full e2e: register → verify email → 3 consents (operational/medical/photo_video) → login redirect"
      contains: "consent"
    - path: "tests/integration/ratelimit.test.ts"
      provides: "Chaos test: 110 requests in 60s → exactly 11 should be 429 with Retry-After"
      contains: "Retry-After"
    - path: ".github/workflows/ci.yml"
      provides: "CI runs vitest + playwright on every PR; blocks merge on RBAC matrix red"
      contains: "rbac-matrix"
  key_links:
    - from: "tests/setup.ts"
      to: "@testcontainers/postgresql"
      via: "global beforeAll boots container, applies drizzle migrations"
      pattern: "PostgreSqlContainer"
    - from: "tests/rls/direct-query.test.ts"
      to: "postgres (raw driver, NOT drizzle)"
      via: "pg.Client connecting as app_user with SET LOCAL"
      pattern: "Client.*app_user"
    - from: "tests/integration/rbac-matrix.test.ts"
      to: "tests/helpers/seed.ts"
      via: "seedRolesMatrix() creates 7 user fixtures + 5 resource fixtures"
      pattern: "seedRolesMatrix"
---

<objective>
Stand up the entire Wave-0 test infrastructure BEFORE any implementation begins. The tests are written RED (deliberately failing because production code does not exist yet) and become GREEN as Waves 2–6 implement the underlying features. This is the source of truth that all later plans verify against.

Critical: The 35-test rol×resource matrix (D-11) is a hard Phase-1 exit gate. The RLS-direct medical-isolation test (CRIT-2 + GDPR-03) is a hard exit gate. Without these tests existing on day one, executors cannot verify their work.

Purpose: Anti-shallow-execution. Every later task has a `<verify>` block referencing one of these test files. If a test is missing, the executor has nothing to run against — and quality silently degrades.

Output: A complete test harness (vitest + playwright + testcontainers) and 8+ test files covering every Phase-1 success criterion. Tests are intentionally RED until later plans implement features.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@.planning/phases/01-fundament/01-VALIDATION.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Configure Vitest + Playwright + testcontainers Postgres bootstrap</name>
  <read_first>
    - .planning/phases/01-fundament/01-VALIDATION.md (full file — sampling rate, Wave 0 requirements list)
    - .planning/phases/01-fundament/01-RESEARCH.md §Validation Architecture (lines 2270–2330)
    - .planning/phases/01-fundament/01-CONTEXT.md §D-11 (35-test matrix mandate)
  </read_first>
  <files>
    vitest.config.ts
    playwright.config.ts
    tests/setup.ts
    tests/helpers/db.ts
    tests/helpers/seed.ts
  </files>
  <action>
    Create `vitest.config.ts`:
    ```ts
    import { defineConfig } from 'vitest/config';
    import path from 'node:path';

    export default defineConfig({
      test: {
        globalSetup: ['./tests/setup.ts'],
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/e2e/**', 'node_modules/**'],
        testTimeout: 30_000,           // testcontainers boot can take ~10s
        hookTimeout: 60_000,
        pool: 'forks',                 // separate Postgres container per worker; avoid shared state
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
    ```

    Create `playwright.config.ts`:
    ```ts
    import { defineConfig, devices } from '@playwright/test';

    export default defineConfig({
      testDir: './tests/e2e',
      fullyParallel: false,           // serialise — auth state shared
      forbidOnly: !!process.env.CI,
      retries: process.env.CI ? 2 : 0,
      workers: 1,
      reporter: process.env.CI ? 'github' : 'list',
      use: {
        baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
        locale: 'nl-BE',
        timezoneId: 'Europe/Brussels',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
      projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
      ],
      webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000/api/health/live',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
    });
    ```

    Create `tests/setup.ts` (testcontainers global setup):
    ```ts
    import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import postgres from 'postgres';
    import { migrate } from 'drizzle-orm/postgres-js/migrator';

    let container: StartedPostgreSqlContainer | null = null;

    export async function setup() {
      container = await new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('vttl_test')
        .withUsername('test')
        .withPassword('test')
        .withCommand([
          'postgres',
          '-c', 'log_min_duration_statement=0',
          '-c', 'shared_preload_libraries=pgcrypto',
        ])
        .start();

      const url = container.getConnectionUri();
      process.env.DATABASE_URL = url;
      process.env.DIRECT_DATABASE_URL = url;
      process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-must-be-32-bytes!!';

      // Apply Drizzle migrations (Plan 02-04 produce these)
      const sql = postgres(url, { max: 1 });
      const db = drizzle(sql);
      try {
        await migrate(db, { migrationsFolder: './drizzle' });
      } catch (e) {
        // OK on day one — drizzle/ folder may be empty until Plan 02 lands
        console.warn('[testcontainer] no migrations to apply yet:', (e as Error).message);
      }
      await sql.end();
    }

    export async function teardown() {
      if (container) await container.stop();
    }
    ```

    Create `tests/helpers/db.ts` (per-test ephemeral schema helper):
    ```ts
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { sql as drizzleSql } from 'drizzle-orm';

    export async function freshDb() {
      const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      const db = drizzle(sql);
      // Truncate all app tables — keep schema, wipe rows; faster than re-migrate per test
      await db.execute(drizzleSql`
        DO $$ DECLARE r RECORD; BEGIN
          FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('drizzle_migrations') LOOP
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
          END LOOP;
        END $$;
      `);
      return { db, sql, [Symbol.asyncDispose]: async () => { await sql.end(); } };
    }

    /**
     * rawPgAsAppUser — connects to Postgres as the `app_user` role (created in Plan 02
     * migration 001) so RLS policies (Plan 04) actually evaluate. The Drizzle client uses
     * the schema-owner role and bypasses RLS; this helper is the ONLY way to prove RLS
     * works at the DB layer (USER-05 + CRIT-2).
     *
     * Two call styles:
     *
     *  1. Long-lived session (RLS direct-query test):
     *       await using cx = await rawPgAsAppUser({ userId, role });
     *       const r = await cx.query('SELECT id FROM medical_events WHERE player_user_id = $1', [pid]);
     *
     *  2. One-shot query (RBAC matrix `rawPgAsAppUser` probe — CRIT-2):
     *       const rows = await rawPgAsAppUser({
     *         userId, role,
     *         sql: 'SELECT id FROM medical_events WHERE player_user_id = $1',
     *         params: [victimId],
     *       });
     *       // Returns the array of rows directly; connection auto-closed.
     *
     * Both styles set `app.user_id` / `app.user_role` GUCs via SELECT set_config(..., true)
     * inside a transaction so RLS policies see the caller identity.
     */
    export interface RawPgAsAppUserArgs {
      userId: string;
      role: string;
      sql?: string;
      params?: readonly unknown[];
    }

    export async function rawPgAsAppUser<TRow = Record<string, unknown>>(
      args: RawPgAsAppUserArgs,
    ): Promise<TRow[] | {
      client: import('pg').Client;
      query: <T = unknown>(text: string, params?: readonly unknown[]) => Promise<{ rows: T[] }>;
      [Symbol.asyncDispose]: () => Promise<void>;
    }> {
      const { Client } = await import('pg');
      const url = new URL(process.env.DATABASE_URL!);
      const client = new Client({
        host: url.hostname,
        port: Number(url.port),
        user: 'app_user',
        password: process.env.APP_USER_PASSWORD ?? 'app_user_pw',
        database: url.pathname.slice(1),
      });
      await client.connect();
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [args.userId]);
      await client.query(`SELECT set_config('app.user_role', $1, true)`, [args.role]);

      // One-shot: run the SQL, return rows, close.
      if (args.sql !== undefined) {
        try {
          const r = await client.query<TRow>(args.sql, args.params as unknown[] | undefined);
          return r.rows;
        } finally {
          await client.query('ROLLBACK');
          await client.end();
        }
      }

      // Long-lived: caller manages disposal via `await using`.
      return {
        client,
        async query<T = unknown>(text: string, params?: readonly unknown[]) {
          return client.query<T>(text, params as unknown[] | undefined);
        },
        [Symbol.asyncDispose]: async () => {
          await client.query('ROLLBACK');
          await client.end();
        },
      };
    }
    ```

    Create `tests/helpers/seed.ts`:
    ```ts
    import type { drizzle } from 'drizzle-orm/postgres-js';

    export const ROLES = [
      'technical_director','academy_manager','trainer','player','parent','sparring_partner','medical_staff',
    ] as const;

    export const RESOURCES = ['users','consent_records','medical_events','audit_log','parent_child_links'] as const;

    export type Role = typeof ROLES[number];
    export type Resource = typeof RESOURCES[number];

    /** Creates one user per role + a victim player whose data each role tries to access.
     * Returns the user IDs keyed by role + the victim's id. */
    export async function seedRolesMatrix(db: ReturnType<typeof drizzle>) {
      // Implementation: insert 7 users (one per role) + 1 victim player
      // + 1 medical_event for victim + 1 consent_record + 1 audit_log + 1 parent_child_link
      // Filled in once Plan 02 schema lands. Stub returns empty until then.
      return { users: {} as Record<Role, string>, victimId: '' };
    }

    /** Expected outcome matrix — single source of truth for D-11.
     *  expected[role][resource] = 'allowed' | 'denied' | 'not_applicable'
     *  - allowed:  expect 200 + non-empty result
     *  - denied:   expect 403 OR 0 rows under RLS
     *  - not_applicable: skip
     */
    /**
     * RBAC matrix — D-11.
     *
     * - `parent_child_links` for parent/player: ALLOWED via the consent.listMyParentLinks tRPC
     *   endpoint (Plan 12) — RLS policy `pcl_visible` (Plan 04) returns own links only.
     * - `parent_child_links` for medical_staff: DENIED in Phase 1 — medical staff treat the player
     *   directly; parent-link visibility is a separate Phase 5 grant tied to medical_documents
     *   uploaded by parents. If they need it earlier, the TD reads on their behalf.
     * - `medical_events` row is verified at the RAW SQL layer via rawPgAsAppUser (CRIT-2 — proves
     *   RLS works at the DB layer, not just the tRPC layer).
     */
    export const RBAC_EXPECTATIONS: Record<Role, Record<Resource, 'allowed' | 'denied' | 'not_applicable'>> = {
      technical_director: { users: 'allowed',  consent_records: 'allowed',  medical_events: 'allowed',  audit_log: 'allowed',  parent_child_links: 'allowed' },
      academy_manager:    { users: 'allowed',  consent_records: 'denied',   medical_events: 'denied',   audit_log: 'denied',   parent_child_links: 'denied'  },
      trainer:            { users: 'allowed',  consent_records: 'denied',   medical_events: 'denied',   audit_log: 'denied',   parent_child_links: 'denied'  },
      player:             { users: 'allowed',  consent_records: 'allowed',  medical_events: 'allowed',  audit_log: 'denied',   parent_child_links: 'allowed' },  // own links via consent.listMyParentLinks
      parent:             { users: 'allowed',  consent_records: 'allowed',  medical_events: 'allowed',  audit_log: 'denied',   parent_child_links: 'allowed' },  // own links via consent.listMyParentLinks
      sparring_partner:   { users: 'allowed',  consent_records: 'denied',   medical_events: 'denied',   audit_log: 'denied',   parent_child_links: 'denied'  },
      medical_staff:      { users: 'allowed',  consent_records: 'denied',   medical_events: 'allowed',  audit_log: 'denied',   parent_child_links: 'denied'  },  // Phase 1 scope; see comment above
    };
    ```
  </action>
  <verify>
    <automated>test -f vitest.config.ts && test -f playwright.config.ts && test -f tests/setup.ts && test -f tests/helpers/db.ts && test -f tests/helpers/seed.ts && grep -q "@testcontainers/postgresql" tests/setup.ts && grep -q "PostgreSqlContainer" tests/setup.ts && grep -q "nl-BE" playwright.config.ts && grep -q "chromium" playwright.config.ts && grep -q "firefox" playwright.config.ts && grep -q "webkit" playwright.config.ts && grep -q "rawPgAsAppUser" tests/helpers/db.ts && grep -q "RBAC_EXPECTATIONS" tests/helpers/seed.ts && grep -q "technical_director" tests/helpers/seed.ts && grep -q "medical_staff" tests/helpers/seed.ts && (grep -c "'allowed'\|'denied'\|'not_applicable'" tests/helpers/seed.ts | awk '{ exit ($1 < 35) ? 1 : 0 }')</automated>
  </verify>
  <acceptance_criteria>
    - `vitest.config.ts` references `./tests/setup.ts` as `globalSetup`
    - `playwright.config.ts` declares 3 projects: `chromium`, `firefox`, `webkit`
    - `playwright.config.ts` `use.locale === 'nl-BE'` and `use.timezoneId === 'Europe/Brussels'`
    - `tests/setup.ts` boots `PostgreSqlContainer('postgres:16-alpine')` and applies drizzle migrations
    - `tests/helpers/db.ts` exports `freshDb` (truncate-all helper) AND `rawPgAsAppUser` (raw `pg.Client` as `app_user` role)
    - `tests/helpers/seed.ts` exports `ROLES` array of length 7 and `RESOURCES` array of length 5
    - `tests/helpers/seed.ts` `RBAC_EXPECTATIONS` matrix has exactly 35 entries (verified by grep counting `'allowed'|'denied'|'not_applicable'` literals reaching ≥35)
  </acceptance_criteria>
  <done>Test harness boots Postgres testcontainer; RBAC matrix expectations encoded as data, not buried in test cases.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Write the 35-test RBAC matrix + RLS direct-query tests + ratelimit + email-locale + e2e specs</name>
  <read_first>
    - .planning/phases/01-fundament/01-VALIDATION.md (Wave 0 Requirements section)
    - .planning/phases/01-fundament/01-RESEARCH.md §Wave 0 Gaps (lines 2317–2329)
    - .planning/phases/01-fundament/01-RESEARCH.md §RLS performance + Concrete RLS policies (lines 904–1024)
    - .planning/phases/01-fundament/01-CONTEXT.md §D-11 (35 tests minimum)
    - tests/helpers/seed.ts (just-created — RBAC_EXPECTATIONS)
    - tests/helpers/db.ts (just-created — rawPgAsAppUser, freshDb)
  </read_first>
  <files>
    tests/integration/rbac-matrix.test.ts
    tests/rls/direct-query.test.ts
    tests/rls/medical-isolation.test.ts
    tests/integration/email-locale.test.ts
    tests/integration/locale-resolve.test.ts
    tests/integration/consent.test.ts
    tests/integration/ratelimit.test.ts
    tests/e2e/register-with-consent.spec.ts
    tests/e2e/auth.spec.ts
    tests/e2e/locale-switcher.spec.ts
    tests/e2e/health.spec.ts
  </files>
  <action>
    All tests below are written RED — they reference Plan 02–15 outputs that do not exist yet. They will turn GREEN incrementally as later plans land. Each test imports `@/server/...` paths that the executor will need to create later. This is intentional and documents the contract.

    **`tests/integration/rbac-matrix.test.ts`** — D-11 35-test matrix:
    ```ts
    import { describe, it, expect, beforeAll, afterAll } from 'vitest';
    import { freshDb, rawPgAsAppUser } from '../helpers/db';
    import { ROLES, RESOURCES, RBAC_EXPECTATIONS, seedRolesMatrix } from '../helpers/seed';
    // appCaller helper provided by Plan 11 (CallerContext + tRPC)
    import { appCaller } from '../helpers/trpc'; // RED until Plan 11

    describe('RBAC matrix (D-11) — 7 roles × 5 resources = 35 cells', () => {
      let dbHandle: Awaited<ReturnType<typeof freshDb>>;
      let users: Record<typeof ROLES[number], string>;
      let victimId: string;

      beforeAll(async () => {
        dbHandle = await freshDb();
        const seeded = await seedRolesMatrix(dbHandle.db);
        users = seeded.users; victimId = seeded.victimId;
      });

      afterAll(async () => { await dbHandle[Symbol.asyncDispose](); });

      describe.each(ROLES)('role: %s', (role) => {
        describe.each(RESOURCES)('resource: %s', (resource) => {
          const expected = () => RBAC_EXPECTATIONS[role][resource];

          it(`is ${RBAC_EXPECTATIONS[role][resource]}`, async () => {
            if (expected() === 'not_applicable') return;
            const caller = appCaller({ userId: users[role], role });
            // Resource probe — each resource has a list endpoint
            // CRIT-2: medical_events probe runs raw SQL as the app_user role so RLS (Plan 04)
            // actually evaluates. There is NO caller.medical.* router in Phase 1 — that lands in
            // Phase 5. Asserting at the DB layer is the correct level for the Phase 1 exit gate
            // (USER-05 "directe Postgres-query als niet-eigenaar op medical_events retourneert nul rijen").
            //
            // CRIT-3: parent_child_links probe splits by role:
            //   - parent / player → consent.listMyParentLinks (RLS pcl_visible — Plan 04 — returns own links)
            //   - technical_director / medical_staff → admin.user.listParentLinks (TD-only tdProcedure)
            //   - other roles → admin.user.listParentLinks (will throw FORBIDDEN)
            const probe = async () => {
              switch (resource) {
                case 'users':              return caller.admin.user.list({ limit: 5 });
                case 'consent_records':    return caller.consent.listForUser({ userId: victimId });
                case 'medical_events': {
                  const rows = await rawPgAsAppUser<{ id: string }>({
                    userId: users[role],
                    role,
                    sql: 'SELECT id FROM medical_events WHERE player_user_id = $1',
                    params: [victimId],
                  });
                  // For 'allowed' the seed guarantees a row exists; for 'denied' RLS returns [].
                  // The outer it(...) maps allowed/denied via expected().
                  if (RBAC_EXPECTATIONS[role][resource] === 'allowed') {
                    if (!Array.isArray(rows) || rows.length < 1) {
                      throw new Error(`medical_events expected >=1 row for role=${role}, got ${Array.isArray(rows) ? rows.length : '?'}`);
                    }
                    return rows;
                  }
                  // 'denied' path: must return zero rows (RLS hides them).
                  if (Array.isArray(rows) && rows.length === 0) return rows;
                  throw Object.assign(new Error('rls_did_not_hide_rows'), { code: 'FORBIDDEN' });
                }
                case 'audit_log':          return caller.admin.auditLog.recent({ limit: 5 });
                case 'parent_child_links':
                  if (role === 'parent' || role === 'player') {
                    return caller.consent.listMyParentLinks();
                  }
                  return caller.admin.user.listParentLinks({ userId: victimId });
              }
            };
            if (expected() === 'allowed') {
              await expect(probe()).resolves.toBeDefined();
            } else {
              await expect(probe()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
            }
          });
        });
      });

      it('test count equals 35', () => {
        const cells = ROLES.flatMap(r => RESOURCES.map(res => ({ r, res })))
          .filter(c => RBAC_EXPECTATIONS[c.r][c.res] !== 'not_applicable');
        expect(cells.length).toBeGreaterThanOrEqual(35);
      });
    });
    ```

    **`tests/rls/direct-query.test.ts`** — proves RLS at DB layer (USER-05):
    ```ts
    import { describe, it, expect, beforeAll, afterAll } from 'vitest';
    import { freshDb, rawPgAsAppUser } from '../helpers/db';

    describe('RLS direct-query — USER-05, CRIT-1', () => {
      let dbHandle: Awaited<ReturnType<typeof freshDb>>;
      let trainerId = '11111111-1111-1111-1111-111111111111';
      let foreignPlayerId = '22222222-2222-2222-2222-222222222222';

      beforeAll(async () => {
        dbHandle = await freshDb();
        // Seed: 1 trainer + 1 foreign player (no academy overlap) + 1 medical_event for the foreign player
        // Filled when Plan 02 schema lands.
      });
      afterAll(async () => { await dbHandle[Symbol.asyncDispose](); });

      it('trainer connecting via raw pg as app_user role cannot SELECT foreign player rows', async () => {
        await using cx = await rawPgAsAppUser({ userId: trainerId, role: 'trainer' });
        const r = await cx.query(`SELECT id FROM users WHERE id = $1`, [foreignPlayerId]);
        expect(r.rows.length).toBe(0);  // RLS hides the row
      });

      it('app_user role does NOT have UPDATE permission on audit_log', async () => {
        await using cx = await rawPgAsAppUser({ userId: trainerId, role: 'trainer' });
        await expect(cx.query(`UPDATE audit_log SET outcome = 'tampered' WHERE id = 1`))
          .rejects.toThrow(/permission denied/i);
      });
    });
    ```

    **`tests/rls/medical-isolation.test.ts`** — GDPR-03 (isolated medical):
    ```ts
    import { describe, it, expect, beforeAll, afterAll } from 'vitest';
    import { freshDb, rawPgAsAppUser } from '../helpers/db';

    describe('RLS medical isolation — GDPR-03, CRIT-2', () => {
      let dbHandle: Awaited<ReturnType<typeof freshDb>>;
      const trainerId = '11111111-1111-1111-1111-111111111111';
      const foreignPlayerId = '22222222-2222-2222-2222-222222222222';
      const tdId = '33333333-3333-3333-3333-333333333333';

      beforeAll(async () => { dbHandle = await freshDb(); });
      afterAll(async () => { await dbHandle[Symbol.asyncDispose](); });

      it('trainer SELECT on medical_events for foreign player returns 0 rows', async () => {
        await using cx = await rawPgAsAppUser({ userId: trainerId, role: 'trainer' });
        const r = await cx.query(`SELECT id FROM medical_events WHERE player_user_id = $1`, [foreignPlayerId]);
        expect(r.rows.length).toBe(0);
      });

      it('technical_director SELECT on medical_events returns the event', async () => {
        await using cx = await rawPgAsAppUser({ userId: tdId, role: 'technical_director' });
        const r = await cx.query(`SELECT id FROM medical_events WHERE player_user_id = $1`, [foreignPlayerId]);
        expect(r.rows.length).toBeGreaterThan(0);
      });

      it('app_user has NO direct SELECT on medical_access_audit (block-all policy)', async () => {
        await using cx = await rawPgAsAppUser({ userId: tdId, role: 'technical_director' });
        const r = await cx.query(`SELECT id FROM medical_access_audit LIMIT 1`);
        expect(r.rows.length).toBe(0); // policy USING (false) — no rows ever
      });
    });
    ```

    **`tests/integration/email-locale.test.ts`** — I18N-04:
    ```ts
    import { describe, it, expect, beforeEach, vi } from 'vitest';
    import { sendEmailLocalized } from '@/server/email/send'; // RED until Plan 06

    describe('email locale — I18N-04', () => {
      let fetchMock: ReturnType<typeof vi.fn>;
      beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal('fetch', fetchMock);
      });

      it.each(['nl','en','fr'] as const)('verify-email subject in %s', async (locale) => {
        await sendEmailLocalized({
          to: 'a@b.test', locale, template: 'verify-email', data: { verifyUrl: 'http://x' },
        });
        const body = new URLSearchParams(fetchMock.mock.calls[0]?.[1]?.body as any);
        const subject = body.get('subject') ?? '';
        const expected = { nl: 'Bevestig je e-mailadres', en: 'Verify your email', fr: 'Confirmez votre adresse e-mail' };
        expect(subject).toBe(expected[locale]);
      });
    });
    ```

    **`tests/integration/locale-resolve.test.ts`** — I18N-03 chain:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { resolveLocale } from '@/i18n/resolve'; // RED until Plan 07

    describe('locale resolution chain — I18N-03', () => {
      it('falls back to nl when no signal', async () => {
        expect(await resolveLocale({ acceptLanguage: undefined, cookie: undefined, userPref: undefined })).toBe('nl');
      });
      it('uses Accept-Language fr-BE → fr', async () => {
        expect(await resolveLocale({ acceptLanguage: 'fr-BE,fr;q=0.9', cookie: undefined, userPref: undefined })).toBe('fr');
      });
      it('cookie overrides Accept-Language', async () => {
        expect(await resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en', userPref: undefined })).toBe('en');
      });
      it('user pref overrides cookie', async () => {
        expect(await resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en', userPref: 'nl' })).toBe('nl');
      });
    });
    ```

    **`tests/integration/consent.test.ts`** — GDPR-01, I18N-09, D-04..07:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { freshDb } from '../helpers/db';
    import { recordConsent, getConsentText } from '@/lib/consent'; // RED until Plan 12

    describe('consent — GDPR-01, I18N-09, D-04..07', () => {
      it('snapshot per locale: stores exact text + sha256 + policy_version', async () => {
        await using h = await freshDb();
        const text = await getConsentText('operational', '1.0.0', 'nl');
        const row = await recordConsent({
          userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          category: 'operational', version: '1.0.0', locale: 'nl',
          textShown: text, ipAddress: '127.0.0.1', userAgent: 'vitest',
        });
        expect(row.consentTextSnapshot).toBe(text);
        expect(row.consentTextSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(row.policyVersion).toBe('1.0.0');
        expect(row.locale).toBe('nl');
      });

      it('version-bump scenario triggers re-consent', async () => {
        // Plan 12 implements the requireCurrentConsent middleware
      });
    });
    ```

    **`tests/integration/ratelimit.test.ts`** — SEC-07/08/09 chaos:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { rateLimitChaos } from '../helpers/ratelimit-chaos'; // RED until Plan 09

    describe('rate-limit chaos — SEC-07', () => {
      it('110 user requests in 60s → exactly 11 are 429 with Retry-After', async () => {
        const results = await rateLimitChaos({ count: 110, windowMs: 60_000, kind: 'user' });
        const denied = results.filter(r => r.status === 429);
        expect(denied.length).toBe(11);
        expect(denied[0]?.headers?.['retry-after']).toBeDefined();
      }, 90_000);
    });
    ```

    **`tests/e2e/register-with-consent.spec.ts`** — full minor-flow:
    ```ts
    import { test, expect } from '@playwright/test';

    test('register → verify email → consent (3 categories) → login redirect', async ({ page }) => {
      await page.goto('/nl/register');
      await page.fill('[name=email]', `t-${Date.now()}@vttl.test`);
      await page.fill('[name=password]', 'CorrectHorseBattery!');
      await page.fill('[name=name]', 'Test User');
      await page.fill('[name=dateOfBirth]', '1990-01-01');
      await page.click('button[type=submit]');
      // Mailgun mock (Plan 06 + tests/e2e/setup) intercepts and exposes the verify URL
      // For now this test is RED.
    });

    test('@phase1 minor < 16 cannot activate without parent consent', async ({ page }) => {
      // Plan 12: GDPR-02 enforcement
    });
    ```

    **`tests/e2e/auth.spec.ts`**:
    ```ts
    import { test, expect } from '@playwright/test';

    test('@phase1 session persists across browser restart (AUTH-01)', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('/nl/login');
      // login flow … assert session cookie has 30d expiry
      const cookies = await context.cookies();
      const auth = cookies.find(c => c.name.includes('session'));
      expect(auth?.expires).toBeGreaterThan(Date.now()/1000 + 60*60*24*29);
    });

    test('@phase1 cookie flags httpOnly + Secure + SameSite=Lax (SEC-01)', async ({ context, request }) => {
      // POST /api/auth/sign-in/email → inspect Set-Cookie headers
    });
    ```

    **`tests/e2e/locale-switcher.spec.ts`**:
    ```ts
    import { test, expect } from '@playwright/test';

    test('@phase1 locale switcher persists pref after login (I18N-01)', async ({ page }) => {
      await page.goto('/nl');
      await page.click('[aria-label=Language]');
      await page.click('text=EN');
      await expect(page).toHaveURL(/\/en/);
      // After login, users.preferred_locale must update — Plan 08 server action
    });
    ```

    **`tests/e2e/health.spec.ts`** — OPS-06:
    ```ts
    import { test, expect } from '@playwright/test';

    test('@phase1 /api/health/live returns 200 always', async ({ request }) => {
      const r = await request.get('/api/health/live');
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(body.status).toBe('ok');
    });

    test('@phase1 /api/health/ready returns 200 when DB+Redis up', async ({ request }) => {
      const r = await request.get('/api/health/ready');
      expect([200, 503]).toContain(r.status());
      const body = await r.json();
      expect(body.components).toBeInstanceOf(Array);
    });
    ```

    Add `tests/helpers/trpc.ts`, `tests/helpers/ratelimit-chaos.ts` as RED stubs (single `export const X = (..a: any[]) => { throw new Error('Plan 11/09 not implemented yet'); }`) — they unblock import resolution while the real implementation lives in Plan 09 and Plan 11.
  </action>
  <verify>
    <automated>test -f tests/integration/rbac-matrix.test.ts && test -f tests/rls/direct-query.test.ts && test -f tests/rls/medical-isolation.test.ts && test -f tests/integration/email-locale.test.ts && test -f tests/integration/locale-resolve.test.ts && test -f tests/integration/consent.test.ts && test -f tests/integration/ratelimit.test.ts && test -f tests/e2e/register-with-consent.spec.ts && test -f tests/e2e/auth.spec.ts && test -f tests/e2e/locale-switcher.spec.ts && test -f tests/e2e/health.spec.ts && grep -q "describe.each(ROLES)" tests/integration/rbac-matrix.test.ts && grep -q "describe.each(RESOURCES)" tests/integration/rbac-matrix.test.ts && grep -q "rawPgAsAppUser" tests/rls/direct-query.test.ts && grep -q "rawPgAsAppUser" tests/rls/medical-isolation.test.ts && grep -q "rawPgAsAppUser" tests/integration/rbac-matrix.test.ts && grep -q "consent.listMyParentLinks" tests/integration/rbac-matrix.test.ts && grep -q "set_config" tests/helpers/db.ts && grep -q "Bevestig je e-mailadres" tests/integration/email-locale.test.ts && grep -q "Confirmez votre adresse" tests/integration/email-locale.test.ts && grep -q "fr-BE,fr" tests/integration/locale-resolve.test.ts && grep -q "consentTextSha256" tests/integration/consent.test.ts && grep -q "retry-after" tests/integration/ratelimit.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/integration/rbac-matrix.test.ts` uses `describe.each(ROLES)` and `describe.each(RESOURCES)` — produces 35 test cells
    - `tests/rls/direct-query.test.ts` uses `rawPgAsAppUser` (NOT Drizzle) and asserts `r.rows.length` === 0 for cross-academy reads
    - `tests/rls/medical-isolation.test.ts` asserts trainer reading foreign `medical_events` returns 0 rows (raw SQL test)
    - `tests/integration/rbac-matrix.test.ts` `medical_events` probe uses `rawPgAsAppUser({ ..., sql, params })` one-shot variant (CRIT-2 — RLS at DB layer, no `caller.medical.*` router in Phase 1)
    - `tests/integration/rbac-matrix.test.ts` `parent_child_links` probe routes parent/player to `caller.consent.listMyParentLinks()` (Plan 12) and TD/medical_staff to `caller.admin.user.listParentLinks(...)` (Plan 15) (CRIT-3)
    - `tests/integration/email-locale.test.ts` asserts subject strings: nl="Bevestig je e-mailadres", en="Verify your email", fr="Confirmez votre adresse e-mail"
    - `tests/integration/locale-resolve.test.ts` covers all 4 chain steps (no signal → nl, Accept-Language, cookie override, user pref override)
    - `tests/integration/consent.test.ts` asserts the row contains `consentTextSnapshot`, `consentTextSha256`, `policyVersion`, `locale`
    - `tests/integration/ratelimit.test.ts` asserts exactly 11 requests of 110 are `status===429` with `Retry-After` header
    - `tests/e2e/register-with-consent.spec.ts` uses `page.goto('/nl/register')` and fills form fields
    - `tests/e2e/auth.spec.ts` has `@phase1` tag and tests session 30d expiry + cookie flags
    - `tests/e2e/health.spec.ts` tests both `/api/health/live` and `/api/health/ready`
    - All test files use `import` from `@/...` path aliases (matches tsconfig paths)
    - Running `npx vitest run --reporter=verbose 2>&1 | grep "RED\|skipped\|FAIL\|cannot find module"` shows tests are RED but parseable (NOT a syntax error)
  </acceptance_criteria>
  <done>All Wave-0 tests written; the 35-cell matrix is enumerable; RLS tests use raw pg (not Drizzle); tests are RED awaiting Plans 02–15.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: GitHub Actions CI workflow gating on RBAC matrix + Wave-0 tests</name>
  <read_first>
    - .planning/phases/01-fundament/01-VALIDATION.md (Sampling Rate section — quick run after every commit, full run after every wave)
    - .planning/phases/01-fundament/01-CONTEXT.md §D-11 (failing tests block merge)
  </read_first>
  <files>
    .github/workflows/ci.yml
  </files>
  <action>
    Create `.github/workflows/ci.yml`:
    ```yaml
    name: CI
    on:
      push: { branches: [main] }
      pull_request: { branches: [main] }
    jobs:
      lint-typecheck:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: '22', cache: 'npm' }
          - run: npm ci
          - run: npm run lint
          - run: npm run typecheck
      unit-integration:
        runs-on: ubuntu-latest
        services:
          docker: { image: docker:dind }
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: '22', cache: 'npm' }
          - run: npm ci
          - name: Vitest (unit + integration)
            run: npx vitest run --reporter=verbose
            env:
              MEDICAL_ENCRYPTION_KEY: ci-medical-key-must-be-32-bytes!!
      rbac-matrix-gate:
        runs-on: ubuntu-latest
        needs: [unit-integration]
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: '22', cache: 'npm' }
          - run: npm ci
          - name: D-11 35-test rol×resource matrix MUST be 100% green
            run: npx vitest run tests/integration/rbac-matrix.test.ts --reporter=verbose
          - name: RLS direct-query medical-isolation MUST be green
            run: npx vitest run tests/rls/medical-isolation.test.ts --reporter=verbose
      e2e:
        runs-on: ubuntu-latest
        needs: [lint-typecheck]
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: '22', cache: 'npm' }
          - run: npm ci
          - run: npx playwright install --with-deps
          - run: npx playwright test --grep="@phase1"
            env:
              BASE_URL: http://localhost:3000
    ```
  </action>
  <verify>
    <automated>test -f .github/workflows/ci.yml && grep -q "rbac-matrix-gate" .github/workflows/ci.yml && grep -q "rbac-matrix.test.ts" .github/workflows/ci.yml && grep -q "medical-isolation.test.ts" .github/workflows/ci.yml && grep -q "@phase1" .github/workflows/ci.yml</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/ci.yml` defines a `rbac-matrix-gate` job that runs `tests/integration/rbac-matrix.test.ts`
    - The job depends on `unit-integration`
    - A separate `e2e` job runs `npx playwright test --grep="@phase1"`
    - All jobs use Node 22 LTS
  </acceptance_criteria>
  <done>CI blocks merges that fail the 35-test RBAC matrix or the RLS-direct medical-isolation test.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test runner ↔ ephemeral Postgres | Testcontainers boots clean Postgres per run; no shared state with dev DB |
| Test code ↔ production code | Tests written RED before implementation; impossible to "fix the test to match the bug" — tests precede code |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02 | Information Disclosure | Cross-academy data read | mitigate | RBAC matrix test asserts trainer cannot read other-academy users; RLS direct-query test bypasses tRPC layer entirely |
| T-01-03 | Information Disclosure | Medical data leak | mitigate | `tests/rls/medical-isolation.test.ts` asserts raw SQL `SELECT * FROM medical_events` returns 0 rows for trainer role |
| T-01-05 | Denial of Service | Rate-limit bypass | mitigate | `tests/integration/ratelimit.test.ts` chaos test asserts exactly 11 of 110 requests are 429; CI gate prevents regressions |
</threat_model>

<verification>
- `npx vitest --version` prints version >= 3.x
- `npx playwright --version` prints version >= 1.59
- `npx vitest list 2>&1 | grep -c "^ tests/"` shows >= 8 test files registered
- `grep -c "describe.each\|it.each\|test.each" tests/integration/rbac-matrix.test.ts` >= 2 (matrix expansion)
- Running `npx vitest run` produces failures (RED) but no "cannot find module" syntax-level errors that crash collection
- CI workflow file syntactically valid (`yamllint` or `act --list`)
</verification>

<success_criteria>
- 11 test files exist (8 integration/unit + 3 e2e specs minimum)
- RBAC matrix produces ≥35 test cases (D-11)
- RLS direct-query test uses raw `pg.Client` (not Drizzle) — proven by `grep "from 'pg'"` matching
- Email locale test asserts all 3 locale subjects literal-match
- CI workflow has dedicated `rbac-matrix-gate` job
- `tests/helpers/seed.ts` `RBAC_EXPECTATIONS` is the single source of truth for the matrix (no duplication)
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-17-SUMMARY.md` documenting:
- Vitest + Playwright + testcontainers versions actually installed
- Total test count enumerated by `npx vitest list`
- Confirmation that the 35-cell matrix is generated from data (count cells programmatically)
- A note that all tests are RED on day one and turn GREEN incrementally as Plans 02–15 land
</output>
