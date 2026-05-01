---phase: 01-fundament
plan: 18
type: execute
wave: 2
depends_on: [01]
files_modified:
  - docs/migration-runbook.md
  - docs/erasure-strategy.md
  - src/lib/migrate/backfill.ts
  - tests/unit/backfill.test.ts
  - tests/unit/migration-format.test.ts
  - .github/workflows/protect-migrations.yml
  - .eslintrc.json
autonomous: true
requirements:
  - MIG-01
  - MIG-02
  - MIG-03
  - MIG-05
  - GDPR-07
requirements_supports:  # informational — primary owners listed below
  - MIG-04
threat_refs:
  - T-01-MIG-IMMUTABLE
tags:
  - phase-1
  - governance
  - migration
  - mig-discipline

must_haves:
  truths:
    - "docs/migration-runbook.md documents the expand-contract pattern with a worked example (the canonical NOT-NULL preferred_locale add)"
    - "docs/erasure-strategy.md documents GDPR-07: medical = hard-delete; other tables = anonymize; preserves consent_records snapshots for legal proof"
    - "src/lib/migrate/backfill.ts implements batched UPDATE (batch=1000, delay=100ms) with cursor-based pagination — MIG-03"
    - "CI workflow `protect-migrations.yml` blocks any PR that modifies a previously-committed migration file (MIG-01)"
    - "ESLint custom rule blocks bare `timestamp(...)` calls outside src/server/db/helpers/timestamps.ts (forces TIMESTAMPTZ)"
  artifacts:
    - path: "docs/migration-runbook.md"
      provides: "Expand-contract pattern + worked example + per-migration rollback template + Drizzle Kit cheat-sheet"
      contains: "expand-contract"
    - path: "docs/erasure-strategy.md"
      provides: "GDPR-07 design — which tables hard-delete vs anonymize; consent_records preserved as legal proof"
      contains: "anonymize"
    - path: "src/lib/migrate/backfill.ts"
      provides: "backfillBatched({ selectSql, updateSql, batchSize=1000, delayMs=100 })"
      exports: ["backfillBatched"]
    - path: ".github/workflows/protect-migrations.yml"
      provides: "Blocks edits to drizzle/*.sql files that already exist on main branch"
      contains: "drizzle/"
  key_links:
    - from: "src/lib/migrate/backfill.ts"
      to: "src/server/db/client.ts"
      via: "imports `db` and uses cursor-pagination to avoid table locks"
      pattern: "@/server/db/client"
    - from: ".github/workflows/protect-migrations.yml"
      to: "drizzle/ folder"
      via: "git diff against main; fails if any drizzle/[0-9]*.sql file has changed lines"
      pattern: "drizzle/.*\\.sql"
---

<objective>
Establish migration discipline. Drizzle Kit makes it easy to generate migrations; this plan ensures we don't make it equally easy to silently rewrite committed migrations (MIG-01) or write naive backfills that lock tables (MIG-03). Also defines the GDPR-07 erasure strategy (which tables hard-delete vs anonymize) — a one-page design doc that downstream phases reference.

This plan is light on code (one utility + tests + docs + a CI guard) but heavy on prevention: the cost of a hot-fixed-on-main migration in Phase 5 is far higher than the cost of writing this plan now.

Output: `docs/migration-runbook.md`, `docs/erasure-strategy.md`, `src/lib/migrate/backfill.ts`, CI guard, ESLint TIMESTAMPTZ rule.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backfill utility (MIG-03) + ESLint TIMESTAMPTZ rule</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Backfill utility (lines 2223–2253)
    - .planning/phases/01-fundament/01-RESEARCH.md §Migration Governance (lines 2169–2266)
    - .eslintrc.json (Plan 01) — extend with TIMESTAMPTZ rule
  </read_first>
  <files>
    src/lib/migrate/backfill.ts
    tests/unit/backfill.test.ts
    .eslintrc.json
  </files>
  <behavior>
    - Test 1 (unit): `backfillBatched` calls selectSql exactly N+1 times for N batches (last call returns 0 rows)
    - Test 2 (unit): Sleep timer is invoked between full batches but NOT after the final partial batch
    - Test 3 (unit): Default batchSize=1000, default delayMs=100 (MIG-03)
  </behavior>
  <action>
    Create `src/lib/migrate/backfill.ts`:
    ```ts
    import { db } from '@/server/db/client';
    import { sql, type SQL } from 'drizzle-orm';
    import { log } from '@/lib/log';

    export async function backfillBatched<T extends { id: string }>(args: {
      selectSql: (cursorClause: SQL) => SQL;
      updateSql: (ids: string[]) => SQL;
      batchSize?: number;
      delayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    }): Promise<{ total: number }> {
      const batch = args.batchSize ?? 1000;
      const delay = args.delayMs ?? 100;
      const sleep = args.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

      let cursor: string | null = null;
      let total = 0;

      for (;;) {
        const cursorClause = cursor ? sql`AND id > ${cursor}` : sql`AND TRUE`;
        const rows = (await db.execute<T>(args.selectSql(cursorClause))) as unknown as T[];
        if (rows.length === 0) break;
        await db.execute(args.updateSql(rows.map((r) => r.id)));
        cursor = rows[rows.length - 1]!.id;
        total += rows.length;
        log.info({ total, lastId: cursor, batch }, 'backfill.progress');
        if (rows.length === batch) await sleep(delay);
        else break;
      }
      log.info({ total }, 'backfill.done');
      return { total };
    }
    ```

    Note: `@/lib/log` is created in Plan 13 (Wave 3). Plan 18 is also Wave 2 — depends_on lists Plan 01 only because Plan 13 is the same wave; the import is forward-declared and the runtime import resolves once Plan 13 lands. Tests stub the log module.

    Write `tests/unit/backfill.test.ts`:
    ```ts
    import { describe, it, expect, vi } from 'vitest';

    vi.mock('@/lib/log', () => ({ log: { info: () => {} } }));

    let executeMock: ReturnType<typeof vi.fn>;
    vi.mock('@/server/db/client', () => {
      executeMock = vi.fn();
      return { db: { execute: executeMock } };
    });

    describe('backfillBatched — MIG-03', () => {
      it('processes 2 full + 1 partial batch with 2 sleeps in between', async () => {
        const { backfillBatched } = await import('@/lib/migrate/backfill');
        const batches = [
          Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })),
          [],  // UPDATE response
          Array.from({ length: 1000 }, (_, i) => ({ id: String(1000 + i) })),
          [],
          Array.from({ length: 250 }, (_, i) => ({ id: String(2000 + i) })),
          [],
        ];
        executeMock.mockImplementation(async () => batches.shift() ?? []);
        const sleep = vi.fn().mockResolvedValue(undefined);

        const r = await backfillBatched({
          selectSql: () => 'sel' as any,
          updateSql: () => 'upd' as any,
          sleep,
        });
        expect(r.total).toBe(2250);
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(100);
      });

      it('respects custom batchSize and delayMs', async () => {
        const { backfillBatched } = await import('@/lib/migrate/backfill');
        executeMock.mockImplementation(async () => []);
        const sleep = vi.fn().mockResolvedValue(undefined);
        await backfillBatched({
          selectSql: () => 'sel' as any,
          updateSql: () => 'upd' as any,
          batchSize: 500,
          delayMs: 50,
          sleep,
        });
        // Empty result → no sleeps
        expect(sleep).not.toHaveBeenCalled();
      });
    });
    ```

    Update `.eslintrc.json`. Within the existing `no-restricted-syntax` array (created in Plan 01), APPEND a new entry:
    ```json
    {
      "selector": "CallExpression[callee.name='timestamp'] ObjectExpression Property[key.name='withTimezone'][value.value=false]",
      "message": "TIMESTAMPTZ required (GDPR-08). Use tstz() from @/server/db/helpers/timestamps. Never set withTimezone:false."
    }
    ```

    Also add `src/server/db/helpers/timestamps.ts` to `overrides`:
    ```json
    {
      "files": ["src/server/db/helpers/timestamps.ts"],
      "rules": { "no-restricted-syntax": "off" }
    }
    ```
    (Plan 01 already has an `overrides` array; ADD this entry to it.)
  </action>
  <verify>
    <automated>test -f src/lib/migrate/backfill.ts && test -f tests/unit/backfill.test.ts && grep -q "backfillBatched" src/lib/migrate/backfill.ts && grep -q "batchSize ?? 1000" src/lib/migrate/backfill.ts && grep -q "delayMs ?? 100" src/lib/migrate/backfill.ts && grep -q "withTimezone" .eslintrc.json && grep -q "src/server/db/helpers/timestamps.ts" .eslintrc.json && npx vitest run tests/unit/backfill.test.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/migrate/backfill.ts` exports `backfillBatched` with default batchSize=1000, delayMs=100
    - The function uses cursor-pagination (`AND id > $cursor`) — NEVER OFFSET
    - `tests/unit/backfill.test.ts` passes (2 tests GREEN)
    - `.eslintrc.json` `no-restricted-syntax` array contains the `withTimezone:false` selector
    - `.eslintrc.json` `overrides` array includes `src/server/db/helpers/timestamps.ts` exception
    - `npm run lint` exits 0
  </acceptance_criteria>
  <done>Backfill utility implemented and tested; TIMESTAMPTZ ESLint rule active.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Migration runbook + erasure-strategy doc + migration-format unit test</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Migration Governance (lines 2169–2266) — full pattern + worked example
    - .planning/phases/01-fundament/01-CONTEXT.md (D-04..07 — consent_records is the legal record; informs erasure strategy)
    - .planning/phases/01-fundament/01-RESEARCH.md §Common Pitfalls → CRIT-5 (Erasure not designed) — lines 2391–2392
    - drizzle/0000_initial.rollback.md (Plan 02 — rollback template precedent)
  </read_first>
  <files>
    docs/migration-runbook.md
    docs/erasure-strategy.md
    tests/unit/migration-format.test.ts
  </files>
  <action>
    Create `docs/migration-runbook.md`:
    ```markdown
    # Migration Runbook (MIG-01..05)

    ## Hard Rules

    1. **Never edit a committed migration** (MIG-01). The CI guard `protect-migrations.yml` (Task 3) enforces this.
    2. **Expand-contract for any breaking change** (MIG-02). Each step = its own deploy.
    3. **Backfill in batches of 1000 + 100ms sleep** (MIG-03). Use `src/lib/migrate/backfill.ts`.
    4. **Test each migration on staging Supabase first** (MIG-04). Coolify staging deploy gate.
    5. **Document rollback per migration** (MIG-05). Companion `drizzle/<n>.rollback.md`.

    ## Drizzle Kit cheat-sheet

    ```bash
    # Generate from schema diff
    npx drizzle-kit generate --name=<descriptive-name>

    # Apply pending migrations (CI/CD; uses DIRECT_DATABASE_URL bypassing pooler)
    npx drizzle-kit migrate

    # Inspect remote state
    npx drizzle-kit introspect

    # NEVER use `push` against production. Push is for local dev only.
    npx drizzle-kit push       # local dev only
    ```

    ## Expand-contract worked example

    Goal: Add NOT NULL `users.preferred_locale`.

    ### Step A — Expand (deploy 1)
    ```sql
    -- 0010_users_preferred_locale_add.sql
    ALTER TABLE users ADD COLUMN preferred_locale locale DEFAULT 'nl';
    ```
    No application change yet.

    ### Step B — Backfill (deploy 2)
    ```ts
    // scripts/backfill-preferred-locale.ts
    import { backfillBatched } from '@/lib/migrate/backfill';
    import { sql } from 'drizzle-orm';

    await backfillBatched({
      selectSql: (cursor) => sql`SELECT id FROM users WHERE preferred_locale IS NULL ${cursor} ORDER BY id LIMIT 1000`,
      updateSql: (ids) => sql`UPDATE users SET preferred_locale='nl' WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`,`)})`,
    });
    ```
    Run: `npx tsx scripts/backfill-preferred-locale.ts`

    ### Step C — Switch reads (deploy 3)
    Application code now reads `users.preferred_locale` (not nullable in TypeScript types).

    ### Step D — Contract (deploy 4)
    ```sql
    -- 0011_users_preferred_locale_not_null.sql
    ALTER TABLE users ALTER COLUMN preferred_locale SET NOT NULL;
    ```

    ## Per-migration rollback template

    Each `drizzle/<n>_<name>.sql` MUST have a companion `drizzle/<n>_<name>.rollback.md`:

    ```markdown
    # Rollback — <n>_<name>.sql

    **Risk:** <what data is lost>
    **Procedure:**
    ```sql
    BEGIN;
    -- reverse statements here
    COMMIT;
    ```
    **Verification:** ...
    ```

    See `drizzle/0000_initial.rollback.md` for the canonical example.
    ```

    Create `docs/erasure-strategy.md`:
    ```markdown
    # GDPR Erasure Strategy (GDPR-06, GDPR-07, CRIT-5)

    Belgian Patient Rights Act + GDPR Articles 17 + 20 require both right-to-erasure AND lawful-processing proof. We resolve the tension by splitting tables into three classes.

    ## Class A — Hard delete on erasure (medical_*)

    Tables: `medical_events`, `medical_documents`, `medical_access_audit` rows referencing the user.

    Rationale: Article 9 special-category data has no aggregate-statistics value. Belgian law allows medical records to be deleted on patient request once the legal retention period has elapsed (or earlier with explicit consent).

    Implementation:
    ```sql
    DELETE FROM medical_documents WHERE player_user_id = $user;
    DELETE FROM medical_events WHERE player_user_id = $user;
    -- medical_access_audit rows referencing this user are anonymized (subject_player_id → NULL) but NOT deleted
    -- — the audit trail of who accessed what (and when) survives the data subject's erasure (legal hold).
    UPDATE medical_access_audit SET subject_player_id = NULL WHERE subject_player_id = $user;
    ```

    ## Class B — Anonymize (most personal data)

    Tables: `users`, `sessions`, `accounts`, `audit_log`, domain tables (Phase 2+).

    On erasure: replace PII with anonymized markers; preserve aggregate statistics (rankings, training counts).

    ```sql
    UPDATE users SET
      email = 'erased-' || id || '@vttl.invalid',
      name = 'Erased User',
      image = NULL,
      date_of_birth = NULL,
      active = false,
      deactivated_at = now(),
      preferred_locale = 'nl'  -- enum NOT NULL — keep default
    WHERE id = $user;
    DELETE FROM sessions WHERE user_id = $user;
    DELETE FROM accounts WHERE user_id = $user;
    -- audit_log: anonymize actor_user_id → NULL but keep the row; the action attribution is destroyed,
    -- the action record itself remains (legal/security requirement).
    UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id = $user;
    ```

    ## Class C — Preserve as legal record (consent_records)

    Tables: `consent_records`, `parent_child_links`.

    Rationale: GDPR Article 5(2) accountability principle requires we can demonstrate WHEN the user gave consent and to WHAT TEXT. Deleting consent records destroys our legal defense for actions taken in the past while consent was valid.

    On erasure:
    ```sql
    -- Mark consent as withdrawn — do NOT delete the row
    UPDATE consent_records SET withdrawn_at = now() WHERE user_id = $user AND withdrawn_at IS NULL;
    -- consent_text_snapshot, sha256, policy_version, locale, given_at all preserved (D-06)
    -- This complies with Article 7(3): "withdrawal of consent shall not affect the lawfulness of processing based on consent before its withdrawal."
    ```

    `parent_child_links` rows referencing the user can be deleted ONLY if both parent and child are erased; otherwise preserved (audit trail for the surviving party).

    ## Cascade rules summary

    | Table | FK | onDelete |
    |-------|-----|---------|
    | medical_events.player_user_id | users(id) | RESTRICT |
    | medical_documents.player_user_id | users(id) | RESTRICT |
    | medical_documents.medical_event_id | medical_events(id) | CASCADE |
    | parent_child_links.parent_user_id | users(id) | RESTRICT |
    | parent_child_links.child_user_id | users(id) | RESTRICT |
    | sessions.user_id | users(id) | CASCADE |
    | accounts.user_id | users(id) | CASCADE |
    | consent_records.user_id | users(id) | RESTRICT (legal record) |

    The RESTRICT rules force the erasure procedure to follow the explicit class-A → class-B → class-C order, surfacing any deviation as a Postgres error rather than silent data loss.

    ## Implementation timeline

    - Phase 1 (this phase): documents the strategy + cascade rules in schema; UI design pending.
    - Phase 7 (Synthese): `/mijn-gegevens` export UI (GDPR-05) + TD erasure UI (GDPR-06) implemented as multi-step server actions wrapping the SQL above.
    - Phase 8: DPIA + erasure runbook reviewed by external counsel.
    ```

    Create `tests/unit/migration-format.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { readdirSync, readFileSync } from 'node:fs';
    import path from 'node:path';

    describe('migration format — MIG-01, MIG-05', () => {
      const drizzleDir = path.resolve(process.cwd(), 'drizzle');

      const sqlFiles = (() => {
        try { return readdirSync(drizzleDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)); }
        catch { return []; }
      })();

      it.skipIf(sqlFiles.length === 0)('every migration file has a companion rollback.md', () => {
        for (const sql of sqlFiles) {
          const md = sql.replace(/\.sql$/, '.rollback.md');
          const exists = (() => {
            try { readFileSync(path.join(drizzleDir, md), 'utf-8'); return true; } catch { return false; }
          })();
          expect(exists, `${md} must exist`).toBe(true);
        }
      });

      it.skipIf(sqlFiles.length === 0)('migration filenames are sequential and zero-padded 4 digits', () => {
        const numbers = sqlFiles.map((f) => Number(f.slice(0, 4)));
        const sorted = [...numbers].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(sorted[i + 1] - sorted[i]).toBe(1);
        }
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f docs/migration-runbook.md && test -f docs/erasure-strategy.md && test -f tests/unit/migration-format.test.ts && grep -q "expand-contract" docs/migration-runbook.md && grep -q "backfillBatched" docs/migration-runbook.md && grep -q "Hard delete" docs/erasure-strategy.md && grep -q "Anonymize" docs/erasure-strategy.md && grep -q "consent_records" docs/erasure-strategy.md && grep -q "withdrawn_at = now" docs/erasure-strategy.md && grep -q "rollback.md" tests/unit/migration-format.test.ts && npx vitest run tests/unit/migration-format.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `docs/migration-runbook.md` documents the 5 hard rules (MIG-01..05) and includes the worked NOT-NULL example
    - `docs/migration-runbook.md` references `src/lib/migrate/backfill.ts`
    - `docs/erasure-strategy.md` defines 3 classes (Hard delete / Anonymize / Preserve as legal record)
    - `docs/erasure-strategy.md` cascade-rules table maps every Phase-1 FK to RESTRICT or CASCADE
    - `tests/unit/migration-format.test.ts` skips cleanly when no migrations exist; passes when migrations exist with companion rollback files
  </acceptance_criteria>
  <done>Migration discipline + erasure strategy committed as living docs.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: GitHub Actions CI guard — protect-migrations.yml</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Migration Governance — Rules (lines 2171–2175) — Rule 1: never edit committed migration
    - .github/workflows/ci.yml (Plan 17 — pattern reference)
  </read_first>
  <files>
    .github/workflows/protect-migrations.yml
  </files>
  <action>
    Create `.github/workflows/protect-migrations.yml`:
    ```yaml
    name: Protect Migrations
    on:
      pull_request:
        branches: [main]
        paths:
          - 'drizzle/**'

    jobs:
      ensure-no-edit:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
            with: { fetch-depth: 0 }
          - name: Detect modified migration files
            run: |
              set -e
              git fetch origin main
              # Files that exist in main AND are changed in this PR
              CHANGED=$(git diff --name-only origin/main...HEAD -- 'drizzle/[0-9]*.sql' 'drizzle/[0-9]*.rollback.md' || true)
              VIOLATIONS=""
              for f in $CHANGED; do
                if git cat-file -e origin/main:"$f" 2>/dev/null; then
                  VIOLATIONS="$VIOLATIONS $f"
                fi
              done
              if [ -n "$VIOLATIONS" ]; then
                echo "::error::MIG-01 violation — committed migrations may not be edited:$VIOLATIONS"
                echo "Add a NEW migration instead. See docs/migration-runbook.md."
                exit 1
              fi
              echo "OK — only new migrations or non-migration drizzle/ files changed."
          - name: Ensure rollback companion exists for each new migration
            run: |
              set -e
              git fetch origin main
              # New SQL files added in this PR
              NEW_SQL=$(git diff --name-only --diff-filter=A origin/main...HEAD -- 'drizzle/[0-9]*.sql' || true)
              for sql in $NEW_SQL; do
                md="${sql%.sql}.rollback.md"
                if [ ! -f "$md" ]; then
                  echo "::error::MIG-05 violation — $sql added without companion $md"
                  exit 1
                fi
              done
              echo "OK — rollback companions present."
    ```
  </action>
  <verify>
    <automated>test -f .github/workflows/protect-migrations.yml && grep -q "MIG-01 violation" .github/workflows/protect-migrations.yml && grep -q "rollback companion" .github/workflows/protect-migrations.yml && grep -q "drizzle/\[0-9\]\*\.sql" .github/workflows/protect-migrations.yml</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/protect-migrations.yml` triggers on `pull_request` to main with `paths: ['drizzle/**']`
    - Job `ensure-no-edit` fails when a previously-committed migration file is modified
    - Job validates that every new SQL file has a companion `.rollback.md`
    - Error messages reference MIG-01 and MIG-05 IDs
  </acceptance_criteria>
  <done>CI guard prevents the most common migration footgun (editing a shipped migration on a hotfix).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Developer ↔ committed migration history | CI guard blocks edits; MIG-01 enforced in code review at the workflow level |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-MIG-IMMUTABLE | Tampering | Migration history | mitigate | `protect-migrations.yml` blocks PRs that change committed `drizzle/[0-9]*.sql` files; rollback-companion check enforces MIG-05 |
| T-01-DOS-BACKFILL | Denial of Service | Naive backfill UPDATE on prod | mitigate | `backfillBatched` enforces 1000-row batches + 100ms sleep; cursor pagination avoids OFFSET cost; ESLint TIMESTAMPTZ rule prevents naive `timestamp()` calls |
</threat_model>

<verification>
- `docs/migration-runbook.md` and `docs/erasure-strategy.md` are committed
- `src/lib/migrate/backfill.ts` exports `backfillBatched`
- `npx vitest run tests/unit/backfill.test.ts tests/unit/migration-format.test.ts` exits 0
- `.github/workflows/protect-migrations.yml` syntactically valid YAML
- ESLint TIMESTAMPTZ rule extends Plan-01 ESLint config
</verification>

<success_criteria>
- Migration runbook with worked example committed
- Erasure-strategy doc with 3-class taxonomy committed
- Backfill utility implemented and unit-tested (1000/100ms defaults)
- CI guard blocks committed-migration edits + missing rollback files
- ESLint blocks bare `timestamp()` outside the helper file
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-18-SUMMARY.md` documenting:
- Final doc word counts
- Confirmation that `npm run lint` exits 0 with the new TIMESTAMPTZ rule
- Confirmation that `protect-migrations.yml` runs only on `paths: ['drizzle/**']` PR triggers
- Note: Plan 04 will reference `docs/erasure-strategy.md` when defining the consent_records UPDATE policy
</output>
