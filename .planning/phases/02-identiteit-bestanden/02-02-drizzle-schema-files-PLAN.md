---
phase: 02-identiteit-bestanden
plan_id: 02-02-drizzle-schema-files
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/db/schema/files.ts
  - src/server/db/schema/players.ts
  - src/server/db/schema/trainers.ts
  - src/server/db/schema/lookups.ts
  - src/server/db/schema/index.ts
autonomous: true
requirements:
  - PLAYER-01
  - PLAYER-02
  - PLAYER-03
  - PLAYER-04
  - PLAYER-06
  - TRAINER-01
  - TRAINER-02
  - DOM-CAT-01

must_haves:
  truths:
    - "Drizzle TS schema modules `players.ts`, `trainers.ts`, `files.ts` exist and compile"
    - "`players.userId` is the PRIMARY KEY referencing users.id (D-26 — collapses player.id to user.id)"
    - "`trainers.userId` is the PRIMARY KEY referencing users.id"
    - "`players` has CHECK constraint `players_minor_emergency_contact` (D-28, PLAYER-06)"
    - "`age_category_history` has UNIQUE(player_id, effective_from) + composite index for lookup (D-33, D-34)"
    - "`uploaded_files.scanStatus` is CHECK IN ('pending','clean','infected') (D-30)"
    - "`uploaded_files.sha256` is nullable TEXT with CHECK `~ '^[a-f0-9]{64}$'` — set by worker via mark_scan_result()"
    - "`uploaded_files.updated_at` TIMESTAMPTZ NOT NULL DEFAULT now() — touched by mark_scan_result() and tRPC mutations"
    - "`lookups.ts` exports new `ageCategories` and `trainerDiploma` tables"
    - "`schema/index.ts` re-exports all new entities for typed Drizzle queries"
  artifacts:
    - path: "src/server/db/schema/players.ts"
      provides: "Drizzle pgTable definitions for `players` and `age_category_history`"
      contains: "players_minor_emergency_contact"
      min_lines: 80
    - path: "src/server/db/schema/trainers.ts"
      provides: "Drizzle pgTable definition for `trainers`"
      contains: "hasPedagogicalQualification"
      min_lines: 40
    - path: "src/server/db/schema/files.ts"
      provides: "Drizzle pgTable definition for `uploaded_files`"
      contains: "scan_status"
      min_lines: 30
    - path: "src/server/db/schema/lookups.ts"
      provides: "ageCategories + trainerDiploma lookups appended"
      contains: "ageCategories"
    - path: "src/server/db/schema/index.ts"
      provides: "barrel exports for new schemas"
      contains: "players"
  key_links:
    - from: "src/server/db/schema/players.ts"
      to: "src/server/db/schema/auth.ts (users)"
      via: "FK players.user_id → users.id ON DELETE CASCADE"
      pattern: "references\\(\\(\\) => users\\.id"
    - from: "src/server/db/schema/players.ts (ageCategoryHistory)"
      to: "src/server/db/schema/players.ts (players)"
      via: "FK player_id → players.user_id ON DELETE CASCADE"
      pattern: "references\\(\\(\\) => players\\.userId"
    - from: "src/server/db/schema/players.ts (profilePhotoFileId)"
      to: "src/server/db/schema/files.ts (uploadedFiles)"
      via: "FK profile_photo_file_id → uploaded_files.id ON DELETE SET NULL"
      pattern: "references\\(\\(\\) => uploadedFiles\\.id"
---

<objective>
Define Drizzle TypeScript schema modules for every new Phase 2 table — `players`, `trainers`, `uploaded_files`, `age_category_history` — plus the new lookup tables `age_categories` and `trainer_diploma`. These types feed Drizzle Kit's `generate` command (Plan 02-03 writes the SQL migration); for Plan 02-04+ they are the typed handles imported by tRPC routers.

This plan is **schema-only** — no SQL migration file, no RLS, no router. The migration file (02-03) and RLS policies (02-05) are sequenced after this so the SQL Drizzle generates matches the locked TS definitions.

Purpose: lock the column shape, FK direction, CHECK constraints, and indexes so downstream plans build against a stable contract. Per D-26..D-30, D-33..D-34.

Output: 4 schema TS files (3 new, 1 modified), 1 barrel-export update.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@CLAUDE.md

<interfaces>
<!-- Phase 1 schema primitives that this plan extends. From src/server/db/schema/*.ts -->

```typescript
// src/server/db/schema/auth.ts (existing — DO NOT modify)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('player'),
  preferredLocale: localeEnum('preferred_locale').notNull().default('nl'),
  dateOfBirth: date('date_of_birth'),
  active: boolean('active').notNull().default(false),
  // ...
});

// src/server/db/schema/lookups.ts (existing — APPEND to)
export const status = pgTable('status', {
  code: text('code').primaryKey(),  // 'status_a' | 'status_b' | 'status_c'
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});
export const academy = pgTable('academy', {
  code: text('code').primaryKey(),
  canonicalName: text('canonical_name').notNull(),  // proper noun (D-45)
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

// src/server/db/helpers/timestamps.ts (existing)
export function tstz(name: string, opts?: { defaultNow?: boolean }): /* TIMESTAMPTZ column */;
// ESLint rule forbids `timestamp({ withTimezone: false })`; always use tstz.

// src/server/db/schema/memberships.ts (existing)
// academy_memberships is the trainer↔academy junction (D-35); no new junction created here.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create src/server/db/schema/files.ts (uploaded_files table)</name>
  <read_first>
    - src/server/db/schema/auth.ts (users; FK target for owner_user_id)
    - src/server/db/schema/medical.ts (parallel "documents-with-RLS-and-scan-status" example — Phase 1 already shipped `medical_documents` though Phase 2 doesn't touch that bucket)
    - src/server/db/helpers/timestamps.ts (tstz helper signature)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-30 (column list)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 1 / §Pattern 2 (Drizzle check() and index() syntax)
  </read_first>
  <files>
    src/server/db/schema/files.ts
  </files>
  <action>
    Create the file with this exact shape (refine doc-comment wording but keep all columns + constraints):

    ```typescript
    /**
     * uploaded_files — single source of truth for every file managed by the
     * platform (D-30). Phase 2 uses the `profiles` bucket; Phase 4 will add
     * evaluation attachments under the same table with a different `bucket`
     * value; Phase 5 will add medical document rows.
     *
     * Lifecycle columns:
     *  - `scan_status`: 'pending' on INSERT; BullMQ MALWARE_SCAN job (Plan 02-06)
     *    flips it to 'clean' or 'infected'. CHECK constraint enforces the enum
     *    at DB level (Postgres has no native CHECK-on-text-enum without it).
     *  - `superseded_at`: soft-delete marker (D-29) for replaced photos. NULL =
     *    current. We never hard-delete uploaded_files rows; replacement writes
     *    `superseded_at = now()` on the old row and inserts a new one.
     *
     * No FK to players/trainers — uploaded_files is bucket-agnostic; binding
     * back to an owning entity is done via the *_file_id column on that entity
     * (e.g., `players.profile_photo_file_id`). Multiple entities can reference
     * the same file id (e.g., a player profile photo also used as evaluation
     * attachment — out-of-scope edge case, but the schema does not block it).
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-30
     *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §file.upload tRPC mutation skeleton
     */
    import { sql } from 'drizzle-orm';
    import { bigint, check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

    import { tstz } from '../helpers/timestamps';
    import { users } from './auth';

    export const uploadedFiles = pgTable(
      'uploaded_files',
      {
        id: uuid('id').primaryKey().defaultRandom(),
        ownerUserId: uuid('owner_user_id')
          .notNull()
          .references(() => users.id, { onDelete: 'cascade' }),
        bucket: text('bucket').notNull(),           // 'profiles' (Phase 2); 'evaluations'/'medical' later
        storageKey: text('storage_key').notNull(),  // full bucket-path: 'profiles/{user_id}/{uuid}.{ext}'
        originalFilename: text('original_filename').notNull(),
        mimeType: text('mime_type').notNull(),
        sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
        scanStatus: text('scan_status').notNull().default('pending'),
        scanCompletedAt: tstz('scan_completed_at'),
        // sha256 hex digest — set by the malware-scan worker via
        // mark_scan_result(). NULL while scan_status='pending'. Used for
        // tamper detection + future dedup. 64 hex chars, no UNIQUE
        // (different uploads may legitimately share content).
        sha256: text('sha256'),
        supersededAt: tstz('superseded_at'),
        uploadedAt: tstz('uploaded_at', { defaultNow: true }).notNull(),
        updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
      },
      (t) => [
        unique('uniq_uploaded_files_storage_key').on(t.storageKey),
        check(
          'uploaded_files_scan_status_enum',
          sql`${t.scanStatus} IN ('pending', 'clean', 'infected')`,
        ),
        check(
          'uploaded_files_sha256_format',
          sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[a-f0-9]{64}$'`,
        ),
        index('idx_uploaded_files_owner_scan').on(t.ownerUserId, t.scanStatus),
      ],
    );

    export type UploadedFile = typeof uploadedFiles.$inferSelect;
    export type NewUploadedFile = typeof uploadedFiles.$inferInsert;
    ```

    Do NOT add `deleted_at` (D-30: soft delete is `superseded_at`-only).
    Do NOT use `timestamp(...)` directly — must be `tstz` (ESLint rule will fail otherwise).
  </action>
  <verify>
    <automated>test -f src/server/db/schema/files.ts && grep -q "scan_status" src/server/db/schema/files.ts && grep -q "uploaded_files_scan_status_enum" src/server/db/schema/files.ts && grep -q "uniq_uploaded_files_storage_key" src/server/db/schema/files.ts && grep -q "idx_uploaded_files_owner_scan" src/server/db/schema/files.ts && ! grep -q "timestamp(" src/server/db/schema/files.ts && npx tsc --noEmit 2>&1 | grep -v "^$" | (! grep -i "error.*files\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - File exists; exports `uploadedFiles`, `UploadedFile`, `NewUploadedFile`
    - CHECK constraint name `uploaded_files_scan_status_enum` present with the 3-value enum
    - UNIQUE on `storage_key` declared (prevents duplicate paths under any race)
    - Composite index `idx_uploaded_files_owner_scan` on `(owner_user_id, scan_status)` for cron cleanup queries
    - No bare `timestamp(...)` usages (all timestamps go through `tstz`)
    - `npx tsc --noEmit` produces no errors mentioning `files.ts`
  </acceptance_criteria>
  <done>The Drizzle TS type for uploadedFiles compiles and can be imported anywhere downstream.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Append ageCategories + trainerDiploma to lookups.ts and re-export</name>
  <read_first>
    - src/server/db/schema/lookups.ts (entire file — append at the bottom)
    - src/server/db/schema/index.ts (current barrel exports)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-44 (lookup-label resolver plan)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Lookup-Tabel Data Seeding Strategy §NEW: age_categories (schema + boundary columns)
  </read_first>
  <files>
    src/server/db/schema/lookups.ts
  </files>
  <action>
    Append (do NOT modify existing exports) to `src/server/db/schema/lookups.ts`:

    ```typescript
    // ─── Phase 2 additions ──────────────────────────────────────────────────

    /**
     * age_categories — Belgian table tennis age cohorts (DOM-CAT-01).
     *
     * Birth-year boundaries are inclusive on both sides. Phase 2's seed migration
     * (02-08) inserts placeholder NULLs until the TD confirms the canonical
     * boundaries (RESEARCH §Open Questions point 4 — ASSUMED A2). Until set,
     * `deriveAgeCategory()` returns the special `'age_unknown'` code (helper in
     * 02-04). Once confirmed, an UPDATE migration in the same migration chain
     * fills the boundaries.
     */
    export const ageCategories = pgTable('age_categories', {
      code: text('code').primaryKey(),  // 'age_pre_minor' | 'age_minor' | 'age_cadet' | 'age_junior' | 'age_senior' | 'age_veteran' | 'age_unknown'
      sortOrder: integer('sort_order').notNull(),
      bornAfterOrEqual: integer('born_after_or_equal'),   // null = open lower bound
      bornBeforeOrEqual: integer('born_before_or_equal'), // null = open upper bound
      active: boolean('active').notNull().default(true),
    });

    /**
     * trainer_diploma — 5-code lookup per TRAINER-02 (verbatim from REQUIREMENTS).
     */
    export const trainerDiploma = pgTable('trainer_diploma', {
      code: text('code').primaryKey(),  // 'diploma_none' | 'diploma_a' | 'diploma_b' | 'diploma_a_in_training' | 'diploma_b_in_training'
      sortOrder: integer('sort_order').notNull(),
      active: boolean('active').notNull().default(true),
    });
    ```

    Do NOT add a `display_name_nl/en/fr` column on either table (D-45 + I18N-06 prohibit).
    Do NOT rename or restructure the existing `academy` / `status` exports — Phase 1 schema is frozen.

    Then update `src/server/db/schema/index.ts` to re-export the new tables. Append (if `index.ts` uses `export *`, that already covers it; if it lists explicit exports, add `ageCategories` and `trainerDiploma`).
  </action>
  <verify>
    <automated>grep -q "export const ageCategories = pgTable" src/server/db/schema/lookups.ts && grep -q "export const trainerDiploma = pgTable" src/server/db/schema/lookups.ts && grep -q "born_after_or_equal" src/server/db/schema/lookups.ts && grep -q "born_before_or_equal" src/server/db/schema/lookups.ts && ! grep -E "display_name_(nl|en|fr)" src/server/db/schema/lookups.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*lookups\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - Both new exports present with the exact column lists
    - No `display_name_*` per-locale columns appear anywhere in the file (I18N-06 / D-45 compliance)
    - `grep -c "^export const " src/server/db/schema/lookups.ts` increases by 2 vs. Phase 1
    - `src/server/db/schema/index.ts` allows `import { ageCategories } from '@/server/db/schema'` to resolve
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Lookup tables shape locked; seed migration (02-08) and tRPC schemas (02-09) can reference them.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Create src/server/db/schema/players.ts (players + age_category_history)</name>
  <read_first>
    - src/server/db/schema/files.ts (just created in Task 1 — FK target for profile_photo_file_id)
    - src/server/db/schema/auth.ts (FK target for user_id)
    - src/server/db/schema/lookups.ts (FK targets for status.code, academy.code, ageCategories.code)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-26, D-27, D-28, D-29, D-31, D-33, D-34
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 1 (CHECK syntax) §Pattern 2 (composite index syntax)
  </read_first>
  <files>
    src/server/db/schema/players.ts
  </files>
  <action>
    Create the file with this structure (full column list per D-26 + PLAYER-01..04):

    ```typescript
    /**
     * players + age_category_history (Phase 2).
     *
     * Design notes:
     *  - `players.user_id` IS the primary key (D-26): a player IS a user with
     *    extra fields; no separate surrogate id. RLS policies in 02-05 call
     *    `players_visible_to(caller_id, caller_role)` (Phase 1 SECURITY DEFINER,
     *    returns users.id) and the IN-clause works because user_id === users.id.
     *  - `is_minor` is denormalised from users.is_minor (Phase 1 helper
     *    `isMinorAt(dob, now)` recomputes it on player.create + player.update;
     *    see Pitfall 2 in 02-RESEARCH). The CHECK constraint references the
     *    local column so it can evaluate without joining users.
     *  - `profile_photo_file_id` → uploaded_files.id ON DELETE SET NULL (D-29):
     *    deleting a file row clears the reference, never blocks deletion.
     *  - `age_category` + `category_year` are explicit columns (PLAYER-04, D-31).
     *    Initial values are set by deriveAgeCategory() in player.create.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §B + §C
     *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 1
     */
    import { sql } from 'drizzle-orm';
    import {
      bigserial,
      boolean,
      check,
      date,
      index,
      integer,
      pgTable,
      text,
      unique,
      uuid,
    } from 'drizzle-orm/pg-core';

    import { tstz } from '../helpers/timestamps';
    import { users } from './auth';
    import { uploadedFiles } from './files';
    import { academy, ageCategories, status } from './lookups';

    export const players = pgTable(
      'players',
      {
        userId: uuid('user_id')
          .primaryKey()
          .references(() => users.id, { onDelete: 'cascade' }),
        firstName: text('first_name').notNull(),
        lastName: text('last_name').notNull(),
        dateOfBirth: date('date_of_birth').notNull(),
        gender: text('gender').notNull(),  // 'male' | 'female' | 'x' (Zod-validated at tRPC boundary)
        school: text('school'),
        // ─── Address (D-27, flat columns) ───
        street: text('street').notNull(),
        streetNumber: text('street_number'),
        postalCode: text('postal_code').notNull(),
        city: text('city').notNull(),
        province: text('province').notNull(),
        country: text('country').notNull().default('BE'),
        phone: text('phone'),
        email: text('email'),
        // ─── Sport (PLAYER-02) ───
        club: text('club'),                                     // free text (PLAYER-03)
        statusCode: text('status_code')
          .notNull()
          .references(() => status.code, { onDelete: 'restrict' }),
        academyCode: text('academy_code')
          .notNull()
          .references(() => academy.code, { onDelete: 'restrict' }),
        ageCategoryCode: text('age_category')
          .notNull()
          .references(() => ageCategories.code, { onDelete: 'restrict' }),
        categoryYear: integer('category_year').notNull(),
        // ─── Minor & emergency (D-28, PLAYER-06) ───
        isMinor: boolean('is_minor').notNull(),
        emergencyContactName: text('emergency_contact_name'),
        emergencyContactPhone: text('emergency_contact_phone'),
        emergencyContactRelation: text('emergency_contact_relation'),
        // ─── Photo (D-29) ───
        profilePhotoFileId: uuid('profile_photo_file_id').references(
          () => uploadedFiles.id,
          { onDelete: 'set null' },
        ),
        createdAt: tstz('created_at', { defaultNow: true }).notNull(),
        updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
      },
      (t) => [
        check(
          'players_minor_emergency_contact',
          sql`(NOT ${t.isMinor}) OR (${t.emergencyContactName} IS NOT NULL AND ${t.emergencyContactPhone} IS NOT NULL)`,
        ),
        index('idx_players_academy').on(t.academyCode),
        index('idx_players_status').on(t.statusCode),
      ],
    );

    export const ageCategoryHistory = pgTable(
      'age_category_history',
      {
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        playerId: uuid('player_id')
          .notNull()
          .references(() => players.userId, { onDelete: 'cascade' }),
        ageCategoryCode: text('age_category_code')
          .notNull()
          .references(() => ageCategories.code, { onDelete: 'restrict' }),
        categoryYear: integer('category_year').notNull(),
        effectiveFrom: date('effective_from').notNull(),
        effectiveTo: date('effective_to'),
        setBy: uuid('set_by').references(() => users.id),
        setAt: tstz('set_at', { defaultNow: true }).notNull(),
      },
      (t) => [
        unique('uniq_age_history_player_effective_from').on(t.playerId, t.effectiveFrom),
        check(
          'age_history_effective_to_after_from',
          sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
        ),
        index('idx_age_history_lookup').on(t.playerId, t.effectiveFrom.desc(), t.effectiveTo),
      ],
    );

    export type Player = typeof players.$inferSelect;
    export type NewPlayer = typeof players.$inferInsert;
    export type AgeCategoryHistoryRow = typeof ageCategoryHistory.$inferSelect;
    export type NewAgeCategoryHistoryRow = typeof ageCategoryHistory.$inferInsert;
    ```

    Do NOT add a separate `players.id uuid PK` (Pitfall 1 — keep `user_id` as PK).
    Do NOT set `dateOfBirth` to nullable (Phase 2 makes it required for players).
    Do NOT use `pgEnum` for gender (UI accepts radio group; backend Zod enum is enough; pgEnum is migration-fragile).
    The Drizzle `check()` API signature is `check('constraint_name', sql\`...\`)` — verified in RESEARCH §Pattern 1.
  </action>
  <verify>
    <automated>test -f src/server/db/schema/players.ts && grep -q "players_minor_emergency_contact" src/server/db/schema/players.ts && grep -q "userId: uuid('user_id')" src/server/db/schema/players.ts && grep -q "primaryKey()" src/server/db/schema/players.ts && grep -q "uniq_age_history_player_effective_from" src/server/db/schema/players.ts && grep -q "idx_age_history_lookup" src/server/db/schema/players.ts && grep -q "profilePhotoFileId" src/server/db/schema/players.ts && ! grep -q "timestamp(" src/server/db/schema/players.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*players\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - `players` and `ageCategoryHistory` exported
    - `players.userId` is `primaryKey().references(() => users.id, { onDelete: 'cascade' })`
    - All PLAYER-01..04 columns present: firstName, lastName, dateOfBirth, gender, school, street, streetNumber, postalCode, city, province, country, phone, email, club, statusCode, academyCode, ageCategoryCode, categoryYear
    - PLAYER-06: emergencyContactName, emergencyContactPhone, emergencyContactRelation present
    - CHECK constraint `players_minor_emergency_contact` references both `isMinor` and the two emergency columns
    - `ageCategoryHistory` has surrogate `id bigserial`, UNIQUE on `(player_id, effective_from)`, and composite index `(player_id, effective_from DESC, effective_to)`
    - No `timestamp(` usages
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Player schema locked in TS; migration in 02-03 will generate matching SQL.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Create src/server/db/schema/trainers.ts</name>
  <read_first>
    - src/server/db/schema/players.ts (Task 3 — mirror the address+photo column pattern)
    - src/server/db/schema/lookups.ts (trainerDiploma FK target)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-26, D-38 (trainer schema)
  </read_first>
  <files>
    src/server/db/schema/trainers.ts
  </files>
  <action>
    ```typescript
    /**
     * trainers (Phase 2).
     *
     * Same 1:0..1-to-users pattern as players (D-26). Trainer↔academy is N:N
     * via the existing `academy_memberships` junction with `role='trainer'`
     * (D-35) — no new junction table here. RLS in 02-05 calls
     * `players_visible_to()` for trainer-scoped player reads.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §B + §D
     */
    import {
      boolean,
      date,
      index,
      pgTable,
      text,
      uuid,
    } from 'drizzle-orm/pg-core';

    import { tstz } from '../helpers/timestamps';
    import { users } from './auth';
    import { uploadedFiles } from './files';
    import { trainerDiploma } from './lookups';

    export const trainers = pgTable(
      'trainers',
      {
        userId: uuid('user_id')
          .primaryKey()
          .references(() => users.id, { onDelete: 'cascade' }),
        firstName: text('first_name').notNull(),
        lastName: text('last_name').notNull(),
        dateOfBirth: date('date_of_birth').notNull(),
        gender: text('gender').notNull(),
        // ─── Address (D-27, flat columns) ───
        street: text('street').notNull(),
        streetNumber: text('street_number'),
        postalCode: text('postal_code').notNull(),
        city: text('city').notNull(),
        province: text('province').notNull(),
        country: text('country').notNull().default('BE'),
        phone: text('phone'),
        email: text('email'),
        // ─── Sport qualifications (TRAINER-02, D-38) ───
        diplomaCode: text('diploma_code')
          .notNull()
          .references(() => trainerDiploma.code, { onDelete: 'restrict' }),
        hasPedagogicalQualification: boolean('has_pedagogical_qualification')
          .notNull()
          .default(false),
        // ─── Photo (D-29) ───
        profilePhotoFileId: uuid('profile_photo_file_id').references(
          () => uploadedFiles.id,
          { onDelete: 'set null' },
        ),
        createdAt: tstz('created_at', { defaultNow: true }).notNull(),
        updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
      },
      (t) => [
        index('idx_trainers_diploma').on(t.diplomaCode),
      ],
    );

    export type Trainer = typeof trainers.$inferSelect;
    export type NewTrainer = typeof trainers.$inferInsert;
    ```

    Do NOT add an `academies` array column on `trainers` — N:N is via `academy_memberships` per D-35.
    Do NOT add `emergencyContact*` to `trainers` — TRAINER-01..02 does not require it (only PLAYER-06 does).
  </action>
  <verify>
    <automated>test -f src/server/db/schema/trainers.ts && grep -q "diplomaCode: text" src/server/db/schema/trainers.ts && grep -q "hasPedagogicalQualification" src/server/db/schema/trainers.ts && grep -q "userId: uuid('user_id')" src/server/db/schema/trainers.ts && grep -q "primaryKey()" src/server/db/schema/trainers.ts && ! grep -q "emergencyContact" src/server/db/schema/trainers.ts && ! grep -q "timestamp(" src/server/db/schema/trainers.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*trainers\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - File exists; exports `trainers`, `Trainer`, `NewTrainer`
    - All TRAINER-01 address+identity columns present
    - TRAINER-02 fields: diplomaCode + hasPedagogicalQualification
    - userId is PK referencing users.id with ON DELETE CASCADE
    - No emergency-contact columns (trainers don't carry these — that's a PLAYER-06 concern)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Trainer schema locked.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 5: Update src/server/db/schema/index.ts barrel exports</name>
  <read_first>
    - src/server/db/schema/index.ts (current shape)
  </read_first>
  <files>
    src/server/db/schema/index.ts
  </files>
  <action>
    If `index.ts` uses `export * from './X'`, ensure these lines exist:

    ```typescript
    export * from './players';
    export * from './trainers';
    export * from './files';
    ```

    If `index.ts` uses explicit named exports, add: `players`, `ageCategoryHistory`, `trainers`, `uploadedFiles`, `ageCategories`, `trainerDiploma`, plus the matching type exports (`Player`, `NewPlayer`, `Trainer`, `NewTrainer`, `UploadedFile`, `NewUploadedFile`, `AgeCategoryHistoryRow`, `NewAgeCategoryHistoryRow`).

    Do NOT remove any existing exports.
  </action>
  <verify>
    <automated>grep -qE "export \* from ['\"]\./players['\"]" src/server/db/schema/index.ts && grep -qE "export \* from ['\"]\./trainers['\"]" src/server/db/schema/index.ts && grep -qE "export \* from ['\"]\./files['\"]" src/server/db/schema/index.ts && grep -qE "export \* from ['\"]\./lookups['\"]" src/server/db/schema/index.ts && npx tsc --noEmit 2>&1 | (! grep -i "error TS.*schema") && cat > src/server/db/schema/__barrel_check.ts <<'EOF'
import * as schema from './index';
const need = ['players','trainers','uploadedFiles','ageCategoryHistory','ageCategories','trainerDiploma'] as const;
const missing = need.filter((k) => !(k in schema));
if (missing.length > 0) { console.error('MISSING from barrel:', missing); process.exit(1); }
console.log('barrel OK');
EOF
npx tsx src/server/db/schema/__barrel_check.ts && rm src/server/db/schema/__barrel_check.ts</automated>
  </verify>
  <acceptance_criteria>
    - All 6 new tables reachable through `@/server/db/schema` barrel
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Other Phase 2 plans can `import { players, trainers, uploadedFiles } from '@/server/db/schema'` without path-juggling.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Drizzle schema TS ↔ generated SQL | The migration (02-03) is derived from these TS files; mismatch = silent prod drift |
| FK declarations ↔ ON DELETE behavior | Choosing CASCADE vs SET NULL vs RESTRICT changes data-retention liability |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02-MINOR-DRIFT | Tampering / Repudiation | `players.is_minor` denormalised from `users.is_minor` (Pitfall 2) | mitigate | `players.is_minor` is reset in `player.create` and `player.updateAsTd` mutations (02-10) by calling Phase 1 `isMinorAt(dob, now)` helper. CHECK constraint enforces emergency-contact presence whenever the flag is true; defense in depth above the application path. Wave 0 RED test in 02-10 verifies a DOB update propagates correctly. |
| T-02-02-CHECK-BYPASS | Tampering | direct DB INSERT bypassing tRPC | mitigate | `players_minor_emergency_contact` is a DB-level CHECK, not a tRPC validator — it fires even on `psql` direct INSERT. Tested in 02-15 integration suite. |
| T-02-02-DISPLAY-NAME-PER-LOCALE | Information Disclosure (I18N-06) | future "convenient" per-locale columns | accept | Forbidden by D-45 + CLAUDE.md "Forbidden" list; planner verified absent in Task 2 grep |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0 across all Phase 2 schema files
- `grep -c "primaryKey()" src/server/db/schema/players.ts` returns ≥ 1 with `userId`
- `grep -c "primaryKey()" src/server/db/schema/trainers.ts` returns ≥ 1 with `userId`
- All FK targets resolve (no "Cannot find name" errors in `tsc` output)
- All CHECK + UNIQUE + INDEX constraints declared with explicit names (Drizzle Kit generates predictable SQL constraint names)
</verification>

<success_criteria>
- 3 new schema files (files.ts, players.ts, trainers.ts) + 2 new lookup exports
- 4 new tables modelled in Drizzle: `players`, `trainers`, `uploaded_files`, `age_category_history`
- 2 new lookup tables modelled: `age_categories`, `trainer_diploma`
- CHECK constraint on minor-emergency-contact compiles
- UNIQUE on age-category-history `(player_id, effective_from)` compiles
- Composite index for `getAgeCategoryAt` query path compiles
- All FK ON DELETE rules explicit (`cascade`, `restrict`, or `set null` — never implicit)
- `users.image` column from Phase 1 is left untouched — Phase 2 uses `players.profilePhotoFileId` not `users.image`
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-02-SUMMARY.md` listing every new table, its PK, and its FK relationships in a brief table.
</output>
