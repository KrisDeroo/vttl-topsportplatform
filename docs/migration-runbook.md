# Migration Runbook (MIG-01..05)

This runbook is the canonical reference for every Drizzle migration that touches a deployed environment (staging or production). It exists because the cost of a hot-fixed migration on `main` during a Phase-5 incident is far higher than the cost of reading this file before generating the migration.

> Drizzle Kit makes generating a migration trivial. Drizzle Kit does **not** stop you from silently rewriting one. Everything below — the CI guard, the rollback companion file, the expand-contract pattern — exists to plug that gap.

## Hard Rules

1. **Never edit a committed migration** — MIG-01.
   The CI guard `.github/workflows/protect-migrations.yml` blocks any PR that modifies a `drizzle/[0-9]*.sql` file that already exists on `main`. If you need to undo what a migration did, write a **new** migration that reverses it. Drizzle's migration ledger (`public.drizzle_migrations`) records SHA-256 hashes of every applied file; editing a file silently after deploy desynchronises every replica.

2. **Expand-contract for any breaking change** — MIG-02.
   A schema change that would break the running application (drop column, add NOT NULL, rename column, change type with narrower domain) MUST be split into separate deploys: expand → backfill → switch reads → contract. See the worked example below.

3. **Backfill in batches of 1000 with a 100ms sleep** — MIG-03.
   Use `src/lib/migrate/backfill.ts` (`backfillBatched`). Naive single-shot `UPDATE table SET col = ... WHERE col IS NULL` against a populated production table causes lock contention; on Supabase pgBouncer (port 6543) the symptom is worse because every retry holds an idle-in-transaction state. Cursor pagination (`AND id > $cursor`) is mandatory — `OFFSET` is forbidden because cost grows linearly with table size and doesn't survive concurrent writes.

4. **Test each migration on staging Supabase first** — MIG-04.
   Coolify staging deploy is the gate. The production deploy step refuses to run if the same migration didn't apply cleanly on staging within the last 24h. (Implemented in the Coolify pre-deploy hook — Plan 17.)

5. **Document rollback per migration** — MIG-05.
   Every `drizzle/<n>_<name>.sql` ships with a companion `drizzle/<n>_<name>.rollback.md` that explains the reverse SQL, the data loss risk, and a verification query. The CI guard fails the PR if the companion is missing. See `drizzle/0000_initial.rollback.md` (Plan 02) for the canonical example.

## Drizzle Kit cheat-sheet

```bash
# Generate from schema diff (the only command developers run locally for prod migrations)
npx drizzle-kit generate --name=<descriptive-name>

# Apply pending migrations (CI/CD; uses DIRECT_DATABASE_URL bypassing the pooler)
npx drizzle-kit migrate

# Inspect remote state — useful when reconciling after an incident
npx drizzle-kit introspect

# Local dev only. NEVER use against staging or production.
npx drizzle-kit push
```

`drizzle-kit push` skips the migration ledger and applies the schema diff in-place. That's fine for an ephemeral dev DB but catastrophic against any environment another developer or process can connect to. The drizzle config (`drizzle.config.ts`) intentionally points at `DIRECT_DATABASE_URL` (port 5432) because pgBouncer transaction-mode pools (port 6543) reject `CREATE INDEX CONCURRENTLY`, transactional DDL, and several `CREATE EXTENSION` operations.

## Expand-contract worked example

**Goal:** add `users.preferred_locale` as `NOT NULL`. This is the canonical case I18N-02 would use if locale support had been retrofitted post-launch instead of designed into Phase 1 from day one. We work it through here so a future similar change has a template.

### Step A — Expand (deploy 1)

```sql
-- drizzle/0010_users_preferred_locale_add.sql
ALTER TABLE users ADD COLUMN preferred_locale locale DEFAULT 'nl';
```

No application change yet. The new column is nullable. Existing rows get the default `'nl'` for new rows but `NULL` for already-inserted rows (Postgres does not backfill defaults retroactively for `ADD COLUMN` with a non-volatile default in 16.x — the optimisation only kicks in for non-volatile defaults under specific conditions; do not rely on it).

### Step B — Backfill (deploy 2)

```ts
// scripts/backfill-preferred-locale.ts
import { backfillBatched } from '@/lib/migrate/backfill';
import { sql } from 'drizzle-orm';

await backfillBatched({
  selectSql: (cursor) => sql`
    SELECT id FROM users
    WHERE preferred_locale IS NULL
      ${cursor}
    ORDER BY id
    LIMIT 1000
  `,
  updateSql: (ids) => sql`
    UPDATE users
    SET preferred_locale = 'nl'
    WHERE id IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`,`,
    )})
  `,
});
```

Run: `npx tsx scripts/backfill-preferred-locale.ts`

The 100ms sleep between batches keeps the WAL replay rate well below the replica's apply throughput, so streaming replicas don't lag during the backfill. `id > $cursor` ordering means a row inserted concurrently with the backfill will either be picked up on the next batch (if its `id` happens to be greater than the cursor) or skipped (if its `id` is lower) — that's fine because new rows already have the `'nl'` default.

### Step C — Switch reads (deploy 3)

Application code now reads `users.preferred_locale` as `string` (no longer nullable in TypeScript types). Tests are updated to assume the column is populated. No migration in this deploy — it's a code-only deploy that consumes the now-fully-populated column.

### Step D — Contract (deploy 4)

```sql
-- drizzle/0011_users_preferred_locale_not_null.sql
ALTER TABLE users ALTER COLUMN preferred_locale SET NOT NULL;
```

This is fast (only the catalog changes — Postgres doesn't rescan the table because the constraint can be validated from the column statistics that say there are zero NULLs). If the staging-first rule (MIG-04) was followed, you already know the constraint passes.

The companion `drizzle/0011_users_preferred_locale_not_null.rollback.md`:

```markdown
# Rollback — 0011_users_preferred_locale_not_null.sql

**Risk:** None — this is a constraint relaxation. Drops the NOT NULL but the column remains populated. Application code reading the column unconditionally still works.

**Procedure:**
\`\`\`sql
BEGIN;
ALTER TABLE users ALTER COLUMN preferred_locale DROP NOT NULL;
COMMIT;
\`\`\`

**Verification:** `\d users` shows `preferred_locale` without `not null`.
```

## Per-migration rollback template

Each `drizzle/<n>_<name>.sql` MUST have a companion `drizzle/<n>_<name>.rollback.md`. The CI guard `.github/workflows/protect-migrations.yml` enforces this — a PR that adds a new SQL file without a `.rollback.md` companion fails with a `MIG-05 violation` annotation.

Use this template:

```markdown
# Rollback — <n>_<name>.sql

**Risk:** <what data is lost or what guarantees are weakened>

**Procedure:**
\`\`\`sql
BEGIN;
-- reverse statements here
COMMIT;
\`\`\`

**Verification:** <a query or psql command that confirms the rollback succeeded>
```

The reason rollbacks are markdown rather than SQL files: a real rollback is rarely a pure SQL inverse. It usually involves coordination (clear cache, restart workers, notify users) that doesn't fit in a single transaction. The `.rollback.md` is the runbook the on-call developer reads at 02:00; the SQL block is the bulk of it but not the whole story.

## When the rollback isn't possible

Some changes have no clean rollback:

- **Hard delete of a column** containing data — the data is gone. Document this explicitly: "Rollback recovers the column structure but the data is unrecoverable without a point-in-time restore from `<backup id>`."
- **Type narrowing** that truncates values — same.
- **Backfill that overwrites a previously-meaningful NULL** — the NULL semantics are lost.

In all these cases the rollback companion documents the recovery procedure (point-in-time restore, manual data correction) rather than pretending an inverse SQL exists.

## References

- `src/lib/migrate/backfill.ts` — the batched backfill helper (`backfillBatched`).
- `tests/unit/backfill.test.ts` — unit test asserting MIG-03 batch + sleep behaviour.
- `tests/unit/migration-format.test.ts` — asserts every committed migration has a `.rollback.md` companion and filenames are sequential.
- `.github/workflows/protect-migrations.yml` — CI guard for MIG-01 + MIG-05.
- `docs/erasure-strategy.md` — companion doc; informs which migrations need an erasure-impact note.
- `.planning/phases/01-fundament/01-RESEARCH.md` §Migration Governance — origin of this runbook.
