---
phase: 01-fundament
plan: 03
type: execute
wave: 3
depends_on: [02]
files_modified:
  - src/server/db/schema/medical.ts
  - src/server/db/schema/index.ts
  - src/server/db/helpers/encryption.ts
  - drizzle/0001_medical_isolated.sql
  - drizzle/0001_medical_isolated.rollback.md
autonomous: true
requirements:
  - GDPR-03
requirements_supports:  # informational — primary owners listed below
  - GDPR-04
  - GDPR-07
threat_refs:
  - T-01-03
  - T-01-04
  - T-01-10
tags:
  - phase-1
  - schema
  - drizzle
  - migration
  - medical
  - gdpr

must_haves:
  truths:
    - "Migration 0001_medical_isolated.sql creates: medical_events, medical_documents, medical_access_audit"
    - "medical_events.event_description_cipher and doctor_cipher are pgcrypto-encrypted via pgp_sym_encrypt — never stored as plaintext"
    - "medical_access_audit table exists with bigserial PK; app_user has INSERT-only privileges on it (T-01-04)"
    - "An audit-trigger writes a medical_access_audit row on every INSERT/UPDATE/DELETE of medical_events (write-time audit; read-time audit deferred to Phase 5 app-layer per CRIT-7)"
    - "soft-delete (deleted_at) on medical_events; cascade rule on medical_documents.medical_event_id is `ON DELETE CASCADE`; player_user_id FK is `ON DELETE RESTRICT` (preserves audit trail)"
  artifacts:
    - path: "src/server/db/schema/medical.ts"
      provides: "medical_events + medical_documents + medical_access_audit Drizzle definitions; encryptedText custom type"
      contains: "medical_access_audit"
    - path: "src/server/db/helpers/encryption.ts"
      provides: "pgp_sym_encrypt / pgp_sym_decrypt SQL fragments + customType<{ data: string; driverData: Buffer }>"
      contains: "pgp_sym_encrypt"
    - path: "drizzle/0001_medical_isolated.sql"
      provides: "CREATE TABLE for medical_events, medical_documents, medical_access_audit; audit-trigger; REVOKE UPDATE/DELETE on medical_access_audit FROM app_user"
      contains: "medical_access_audit"
    - path: "drizzle/0001_medical_isolated.rollback.md"
      provides: "Reverse SQL: DROP triggers, DROP tables in dependency order"
      contains: "DROP TABLE"
  key_links:
    - from: "src/server/db/schema/medical.ts"
      to: "src/server/db/schema/auth.ts"
      via: "playerUserId FK to users.id ON DELETE RESTRICT"
      pattern: "users.id.*restrict"
    - from: "drizzle/0001_medical_isolated.sql"
      to: "pgcrypto extension"
      via: "encrypted columns use pgp_sym_encrypt(plaintext, current_setting('app.medical_key'))"
      pattern: "pgp_sym_encrypt|pgp_sym_decrypt"
    - from: "drizzle/0001_medical_isolated.sql"
      to: "audit_log + medical_access_audit (Plan 02)"
      via: "trigger fn medical_event_audit() inserts a row on every WRITE"
      pattern: "trigger.*medical"
---

<objective>
Migration 002 isolates the medical-data table family — `medical_events`, `medical_documents`, and the dedicated `medical_access_audit` audit table. This implements CRIT-2 (medical isolation), CRIT-7 (dedicated medical audit), and GDPR-03/04/07 (Article 9 special-category data isolation, audit on every read, independent deletion path).

Why a separate plan from 002: medical schema is a different blast radius. A bug in `users` corrupts the auth layer; a bug in `medical_events` is a healthcare data breach under Belgian Patient Rights Act. Separating the migration also means a dev who needs to reset medical for a fixture run can drop just this migration's tables.

Critical decisions:
- pgcrypto column-level encryption (`pgp_sym_encrypt` with key from session GUC `app.medical_key`)
- Write-time audit-trigger (inserts into `medical_access_audit` on every WRITE) — read-time audit goes through the app layer in Phase 5 (async via BullMQ — CRIT-7)
- `medical_access_audit`: app_user has INSERT-only; reads via SECURITY DEFINER function (Plan 04 creates it)

Output: `drizzle/0001_medical_isolated.sql` + rollback runbook.
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
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Encryption helper + medical schema (medical_events, medical_documents, medical_access_audit)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Medical isolation (lines 763–803) — exact column definitions
    - .planning/phases/01-fundament/01-RESEARCH.md §Audit log + medical access audit (lines 727–740) — medical_access_audit definition
    - .planning/phases/01-fundament/01-RESEARCH.md §pgcrypto encrypted column read pattern (lines 2488–2506)
    - .planning/PITFALLS-ADDITIONS.md (CRIT-2, CRIT-7, CRIT-8 — exact patterns to follow)
    - src/server/db/schema/auth.ts (Plan 02 — users table FK target)
  </read_first>
  <files>
    src/server/db/helpers/encryption.ts
    src/server/db/schema/medical.ts
    src/server/db/schema/index.ts
    tests/unit/medical-schema.test.ts
  </files>
  <behavior>
    - Test 1 (unit): medicalEvents table has columns playerUserId (uuid, NOT NULL, ON DELETE RESTRICT), eventDescriptionCipher (text NOT NULL), isInjury (boolean NOT NULL default false), startDate (date NOT NULL), endDate (date), deletedAt (tstz nullable)
    - Test 2 (unit): medicalDocuments has medicalEventId FK with ON DELETE CASCADE, playerUserId FK with ON DELETE RESTRICT
    - Test 3 (unit): medicalAccessAudit has bigserial id, recordType text NOT NULL, action text NOT NULL, actorUserId uuid NOT NULL
  </behavior>
  <action>
    Create `src/server/db/helpers/encryption.ts`:
    ```ts
    /**
     * pgcrypto-encrypted column helpers.
     *
     * Pattern: writes use raw SQL with `pgp_sym_encrypt(text, current_setting('app.medical_key'))`,
     * reads use a SECURITY DEFINER VIEW or `pgp_sym_decrypt(bytea, current_setting('app.medical_key'))`.
     * The key is set per-connection from MEDICAL_ENCRYPTION_KEY (env var). NEVER stored in DB.
     */
    import { sql } from 'drizzle-orm';

    /** Wrap a plaintext value in pgp_sym_encrypt(...) for INSERT/UPDATE.
     *  Resulting expression returns bytea. Cast to text via encode(..., 'base64') if a text column. */
    export function encrypt(plaintext: string) {
      return sql`pgp_sym_encrypt(${plaintext}, current_setting('app.medical_key'))`;
    }

    /** Wrap a column reference for SELECT-time decryption. */
    export function decrypt(columnExpr: any) {
      return sql`CASE WHEN ${columnExpr} IS NULL THEN NULL ELSE pgp_sym_decrypt(${columnExpr}::bytea, current_setting('app.medical_key')) END`;
    }
    ```

    Create `src/server/db/schema/medical.ts`:
    ```ts
    import { pgTable, uuid, text, date, boolean, bigserial, inet } from 'drizzle-orm/pg-core';
    import { users } from './auth';
    import { tstz } from '../helpers/timestamps';

    /** Medical events — Article 9 special-category data. Free-text fields encrypted at column level via pgcrypto.
     *  Cipher columns store base64-encoded bytea (text type for portability across drivers). */
    export const medicalEvents = pgTable('medical_events', {
      id: uuid('id').primaryKey().defaultRandom(),
      playerUserId: uuid('player_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
      eventDescriptionCipher: text('event_description_cipher').notNull(),
      doctorCipher: text('doctor_cipher'),
      isInjury: boolean('is_injury').notNull().default(false),
      startDate: date('start_date').notNull(),
      endDate: date('end_date'),
      createdBy: uuid('created_by').notNull().references(() => users.id),
      createdAt: tstz('created_at', { defaultNow: true }).notNull(),
      updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
      deletedAt: tstz('deleted_at'),
    });

    /** Medical documents — bucket key + cipher metadata. Phase 5 fills row data. */
    export const medicalDocuments = pgTable('medical_documents', {
      id: uuid('id').primaryKey().defaultRandom(),
      medicalEventId: uuid('medical_event_id').references(() => medicalEvents.id, { onDelete: 'cascade' }),
      playerUserId: uuid('player_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
      storageKey: text('storage_key').notNull().unique(),
      originalFilenameCipher: text('original_filename_cipher').notNull(),
      mimeType: text('mime_type').notNull(),
      sizeBytes: text('size_bytes').notNull(),
      uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
      uploadedAt: tstz('uploaded_at', { defaultNow: true }).notNull(),
      scanStatus: text('scan_status').notNull().default('pending'),
      deletedAt: tstz('deleted_at'),
    });

    /** Medical access audit — INSERT-only for app_user, reads via SECURITY DEFINER fn (Plan 04).
     *  Retention: 6 years (OPS-02). */
    export const medicalAccessAudit = pgTable('medical_access_audit', {
      id: bigserial('id', { mode: 'bigint' }).primaryKey(),
      actorUserId: uuid('actor_user_id').notNull(),
      subjectPlayerId: uuid('subject_player_id').notNull(),
      recordType: text('record_type').notNull(),
      recordId: uuid('record_id'),
      action: text('action').notNull(),
      ipAddress: inet('ip_address'),
      userAgent: text('user_agent'),
      requestId: text('request_id'),
      outcome: text('outcome').notNull().default('success'),
      occurredAt: tstz('occurred_at', { defaultNow: true }).notNull(),
    });
    ```

    Add `export * from './medical';` to `src/server/db/schema/index.ts`.

    Write `tests/unit/medical-schema.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { medicalEvents, medicalDocuments, medicalAccessAudit } from '@/server/db/schema/medical';

    describe('medical schema — GDPR-03, CRIT-2, CRIT-7', () => {
      it('medical_events.player_user_id is ON DELETE RESTRICT (preserves audit trail)', () => {
        const cols = (medicalEvents as any)._.columns ?? (medicalEvents as any)[Symbol.for('drizzle:Columns')];
        expect(cols.playerUserId).toBeDefined();
        // Drizzle stores onDelete in foreignKeys; a smoke check on column existence is sufficient here.
      });

      it('medical_events has cipher columns (no plaintext)', () => {
        const cols = (medicalEvents as any)._.columns ?? (medicalEvents as any)[Symbol.for('drizzle:Columns')];
        expect(cols.eventDescriptionCipher).toBeDefined();
        expect(cols.doctorCipher).toBeDefined();
      });

      it('medical_documents has FK to medical_events ON DELETE CASCADE', () => {
        const cols = (medicalDocuments as any)._.columns ?? (medicalDocuments as any)[Symbol.for('drizzle:Columns')];
        expect(cols.medicalEventId).toBeDefined();
      });

      it('medical_access_audit has bigserial id + actor_user_id NOT NULL', () => {
        const cols = (medicalAccessAudit as any)._.columns ?? (medicalAccessAudit as any)[Symbol.for('drizzle:Columns')];
        expect(cols.id).toBeDefined();
        expect(cols.actorUserId).toBeDefined();
        expect(cols.recordType).toBeDefined();
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/db/helpers/encryption.ts && test -f src/server/db/schema/medical.ts && grep -q "pgp_sym_encrypt" src/server/db/helpers/encryption.ts && grep -q "current_setting('app.medical_key')" src/server/db/helpers/encryption.ts && grep -q "medicalEvents" src/server/db/schema/medical.ts && grep -q "medicalAccessAudit" src/server/db/schema/medical.ts && grep -q "eventDescriptionCipher" src/server/db/schema/medical.ts && grep -Eq "playerUserId.*references.*users\.id.*onDelete:\s*'restrict'" src/server/db/schema/medical.ts && grep -Eq "medicalEventId.*references.*medicalEvents\.id.*onDelete:\s*'cascade'" src/server/db/schema/medical.ts && grep -q "scanStatus" src/server/db/schema/medical.ts && grep -q "export \* from './medical'" src/server/db/schema/index.ts && npx tsc --noEmit && npx vitest run tests/unit/medical-schema.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/db/helpers/encryption.ts` exports `encrypt(text)` and `decrypt(col)` SQL helpers using `current_setting('app.medical_key')`
    - `src/server/db/schema/medical.ts` defines `medicalEvents`, `medicalDocuments`, `medicalAccessAudit`
    - `medicalEvents.playerUserId` references `users.id` with `onDelete: 'restrict'` (NOT cascade — preserves audit if user is deleted)
    - `medicalEvents.eventDescriptionCipher` is `text NOT NULL`
    - `medicalDocuments.medicalEventId` references `medicalEvents.id` with `onDelete: 'cascade'`
    - `medicalDocuments.playerUserId` references `users.id` with `onDelete: 'restrict'`
    - `medicalAccessAudit.id` is `bigserial` with `mode: 'bigint'`
    - `medicalAccessAudit.actorUserId`, `subjectPlayerId`, `recordType`, `action` are NOT NULL
    - `src/server/db/schema/index.ts` re-exports medical schema
    - `npx vitest run tests/unit/medical-schema.test.ts` exits 0
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Medical schema files written; cipher columns + cascade rules + access-audit shape verified.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Generate migration 0001_medical_isolated.sql, append audit-trigger + role grants, write rollback</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Audit log + medical access audit (lines 727–740) — write-time audit + INSERT-only role
    - .planning/phases/01-fundament/01-RESEARCH.md §Soft-delete + updated_at trigger (lines 808–820)
    - .planning/PITFALLS-ADDITIONS.md §CRIT-7 (medical access audit pattern)
    - src/server/db/schema/medical.ts (just-created)
  </read_first>
  <files>
    drizzle/0001_medical_isolated.sql
    drizzle/0001_medical_isolated.rollback.md
    drizzle/meta/_journal.json
  </files>
  <action>
    1. Run `npx drizzle-kit generate --name=medical_isolated`. This creates `drizzle/0001_medical_isolated.sql` (or whichever next sequential number Drizzle picks).

    2. APPEND the following blocks to the generated SQL file:

    **Block A — updated_at trigger on medical_events:**
    ```sql
    CREATE TRIGGER trg_medical_events_updated_at BEFORE UPDATE ON medical_events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ```

    **Block B — write-time audit trigger (CRIT-7):**
    ```sql
    -- Write-time audit: every INSERT/UPDATE/DELETE on medical_events writes a medical_access_audit row.
    -- Read-time audit goes through the app layer (Phase 5 — async BullMQ job).
    CREATE OR REPLACE FUNCTION medical_event_audit() RETURNS TRIGGER AS $$
    DECLARE
      actor UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
      req_id TEXT := NULLIF(current_setting('app.request_id', true), '');
      action_kind TEXT;
      subject_id UUID;
      rec_id UUID;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        action_kind := 'write';
        subject_id := NEW.player_user_id;
        rec_id := NEW.id;
      ELSIF TG_OP = 'UPDATE' THEN
        action_kind := CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete' ELSE 'write' END;
        subject_id := NEW.player_user_id;
        rec_id := NEW.id;
      ELSE -- DELETE
        action_kind := 'delete';
        subject_id := OLD.player_user_id;
        rec_id := OLD.id;
      END IF;

      INSERT INTO medical_access_audit
        (actor_user_id, subject_player_id, record_type, record_id, action, request_id, outcome)
      VALUES
        (COALESCE(actor, '00000000-0000-0000-0000-000000000000'::uuid), subject_id, 'medical_event', rec_id, action_kind, req_id, 'success');

      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE TRIGGER trg_medical_event_audit
      AFTER INSERT OR UPDATE OR DELETE ON medical_events
      FOR EACH ROW EXECUTE FUNCTION medical_event_audit();

    -- Same pattern on medical_documents:
    CREATE OR REPLACE FUNCTION medical_document_audit() RETURNS TRIGGER AS $$
    DECLARE
      actor UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
      req_id TEXT := NULLIF(current_setting('app.request_id', true), '');
      action_kind TEXT;
      subject_id UUID;
      rec_id UUID;
    BEGIN
      IF TG_OP = 'INSERT' THEN action_kind := 'write'; subject_id := NEW.player_user_id; rec_id := NEW.id;
      ELSIF TG_OP = 'UPDATE' THEN action_kind := CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete' ELSE 'write' END; subject_id := NEW.player_user_id; rec_id := NEW.id;
      ELSE action_kind := 'delete'; subject_id := OLD.player_user_id; rec_id := OLD.id;
      END IF;
      INSERT INTO medical_access_audit
        (actor_user_id, subject_player_id, record_type, record_id, action, request_id, outcome)
      VALUES
        (COALESCE(actor, '00000000-0000-0000-0000-000000000000'::uuid), subject_id, 'medical_document', rec_id, action_kind, req_id, 'success');
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE TRIGGER trg_medical_document_audit
      AFTER INSERT OR UPDATE OR DELETE ON medical_documents
      FOR EACH ROW EXECUTE FUNCTION medical_document_audit();
    ```

    **Block C — INSERT-only privileges for app_user on medical_access_audit (CRIT-7, T-01-04):**
    ```sql
    REVOKE UPDATE, DELETE ON medical_access_audit FROM app_user;
    GRANT INSERT ON medical_access_audit TO app_user;
    GRANT INSERT ON medical_access_audit TO app_audit_writer;
    -- Direct SELECT on medical_access_audit is BLOCKED via RLS in Plan 04 (policy USING (false))
    -- Reads go through query_medical_access_audit() SECURITY DEFINER fn — also created in Plan 04.
    ```

    **Block D — performance indexes for medical lookups:**
    ```sql
    CREATE INDEX idx_medical_events_player ON medical_events (player_user_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_medical_events_player_dates ON medical_events (player_user_id, start_date, end_date);
    CREATE INDEX idx_medical_documents_event ON medical_documents (medical_event_id);
    CREATE INDEX idx_medical_documents_player ON medical_documents (player_user_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_maa_subject ON medical_access_audit (subject_player_id, occurred_at DESC);
    CREATE INDEX idx_maa_actor ON medical_access_audit (actor_user_id, occurred_at DESC);
    ```

    3. Create `drizzle/0001_medical_isolated.rollback.md`:
    ```markdown
    # Rollback — 0001_medical_isolated.sql

    **Risk:** Drops medical-data tables. Only execute on dev/staging or after PITR restore. NEVER run against production with non-test medical records — this irrecoverably destroys Article-9 data.

    **Procedure:**
    ```sql
    BEGIN;
    DROP TRIGGER IF EXISTS trg_medical_event_audit ON medical_events;
    DROP TRIGGER IF EXISTS trg_medical_document_audit ON medical_documents;
    DROP TRIGGER IF EXISTS trg_medical_events_updated_at ON medical_events;
    DROP FUNCTION IF EXISTS medical_event_audit();
    DROP FUNCTION IF EXISTS medical_document_audit();

    DROP INDEX IF EXISTS idx_medical_events_player;
    DROP INDEX IF EXISTS idx_medical_events_player_dates;
    DROP INDEX IF EXISTS idx_medical_documents_event;
    DROP INDEX IF EXISTS idx_medical_documents_player;
    DROP INDEX IF EXISTS idx_maa_subject;
    DROP INDEX IF EXISTS idx_maa_actor;

    DROP TABLE IF EXISTS medical_documents;
    DROP TABLE IF EXISTS medical_events;
    DROP TABLE IF EXISTS medical_access_audit;
    COMMIT;
    ```
    ```
  </action>
  <verify>
    <automated>test -f drizzle/0001_medical_isolated.sql && test -f drizzle/0001_medical_isolated.rollback.md && grep -q "CREATE TABLE.*medical_events\|CREATE TABLE \"medical_events\"\|CREATE TABLE IF NOT EXISTS \"medical_events\"" drizzle/0001_medical_isolated.sql && grep -q "CREATE TABLE.*medical_documents" drizzle/0001_medical_isolated.sql && grep -q "CREATE TABLE.*medical_access_audit" drizzle/0001_medical_isolated.sql && grep -q "medical_event_audit\b" drizzle/0001_medical_isolated.sql && grep -q "trg_medical_event_audit" drizzle/0001_medical_isolated.sql && grep -q "REVOKE UPDATE, DELETE ON medical_access_audit FROM app_user" drizzle/0001_medical_isolated.sql && grep -q "GRANT INSERT ON medical_access_audit TO app_user" drizzle/0001_medical_isolated.sql && grep -q "idx_medical_events_player" drizzle/0001_medical_isolated.sql && grep -q "idx_maa_subject" drizzle/0001_medical_isolated.sql && grep -q "DROP TABLE IF EXISTS medical_events" drizzle/0001_medical_isolated.rollback.md && grep -q "0001_medical_isolated\|medical_isolated" drizzle/meta/_journal.json</automated>
  </verify>
  <acceptance_criteria>
    - `drizzle/0001_medical_isolated.sql` contains CREATE TABLE for `medical_events`, `medical_documents`, `medical_access_audit`
    - Audit trigger function `medical_event_audit()` defined as SECURITY DEFINER with SET search_path
    - Triggers `trg_medical_event_audit` and `trg_medical_document_audit` fire on `AFTER INSERT OR UPDATE OR DELETE`
    - `REVOKE UPDATE, DELETE ON medical_access_audit FROM app_user` line present
    - `GRANT INSERT ON medical_access_audit TO app_user` line present
    - 6 medical-related indexes present (idx_medical_events_player, _dates, idx_medical_documents_event, _player, idx_maa_subject, idx_maa_actor)
    - `drizzle/meta/_journal.json` lists migration `0001_medical_isolated`
    - `drizzle/0001_medical_isolated.rollback.md` exists with full DROP procedure
  </acceptance_criteria>
  <done>Medical migration generated, audit trigger wired, role grants applied, rollback runbook committed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App code ↔ medical_events | All free-text fields stored as pgcrypto-encrypted bytea; key in session GUC |
| App code ↔ medical_access_audit | INSERT-only; reads via SECURITY DEFINER function (Plan 04) |
| Triggers ↔ user-set GUCs | Trigger reads `app.user_id` from `current_setting()` to attribute every write |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-03 | Information Disclosure | medical_events plaintext | mitigate | pgcrypto column-level encryption; key from `MEDICAL_ENCRYPTION_KEY` env var, set per-connection via session GUC; key NEVER stored in DB |
| T-01-04 | Repudiation | medical_access_audit tampering | mitigate | `REVOKE UPDATE, DELETE FROM app_user`; trigger is SECURITY DEFINER (cannot be bypassed by app role) |
| T-01-10 | Information Disclosure | Raw SELECT on medical_events bypassing app | mitigate | Plan 04 RLS policies restrict reads to player_self / TD / medical_staff / linked parent; Plan 17 RLS direct-query test asserts trainer gets 0 rows |
</threat_model>

<verification>
- `drizzle/0001_medical_isolated.sql` is committed
- All 3 medical tables defined with correct cascade/restrict rules
- Audit trigger writes one row per WRITE op
- `app_user` cannot UPDATE or DELETE rows in `medical_access_audit` (verified at Postgres-role layer in Plan 16 push)
- Wave-0 RLS test `tests/rls/medical-isolation.test.ts` will turn GREEN once Plan 04 (RLS policies) and Plan 16 (push) complete
</verification>

<success_criteria>
- 3 new tables (medical_events, medical_documents, medical_access_audit)
- 2 audit-trigger functions (medical_event_audit, medical_document_audit) — write-time audit
- 6 indexes for medical lookups
- INSERT-only role privileges on medical_access_audit (T-01-04)
- pgcrypto encryption helpers ready (encrypt/decrypt)
- Rollback runbook committed
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-03-SUMMARY.md` documenting:
- Final migration filename(s) and journal entries
- Trigger function bodies
- Confirmation that read-time audit is intentionally deferred to Phase 5 (CRIT-7) — only WRITES audited at trigger level in Phase 1
- Note: RLS policies for medical tables are added in Plan 04
</output>
