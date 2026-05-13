# Phase 3: Kalender — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** ~70 new + 3 modified
**Analogs found:** 65 / 70 (5 are net-new patterns — FullCalendar, RRULE, multi-table polymorphism — analog absent by design)

This map answers, per Phase 3 file: which existing Phase 1/2 file does the planner copy from, and which lines specifically. Where no analog exists (the FullCalendar Client-Component boundary, the `rrule` npm wrapper, the cross-scope SECURITY DEFINER overlap function), the entry points to the canonical doc in RESEARCH.md / UI-SPEC.md.

Every locked decision D-47..D-59 from `03-CONTEXT.md` and every Wave 0 test file from `03-VALIDATION.md` has a row in §File Classification or §No Analog Found.

---

## File Classification

### Migrations (drizzle/, 4 new SQL + 4 rollback companions)

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` | migration / additive DDL | one-shot transactional CREATE | `drizzle/0006_phase2_profiles_and_files.sql` | exact (same MIG-02 expand-contract, additive-only, separated by concern) |
| `drizzle/0009_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0006_phase2_profiles_and_files.rollback.md` | exact (Risk / Procedure / Verification headers required by `tests/unit/migration-format.test.ts`) |
| `drizzle/0010_phase3_calendar_extension_tables.sql` | migration / additive DDL | CREATE 6 extension tables | `drizzle/0006_phase2_profiles_and_files.sql` (sections 3+4) | role-match (same FK-CASCADE-to-base pattern as players↔age_category_history) |
| `drizzle/0010_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0006_phase2_profiles_and_files.rollback.md` | exact |
| `drizzle/0011_phase3_calendar_rls_policies.sql` | migration / DDL — RLS policies + SECURITY DEFINER fns | DDL — policy + function | `drizzle/0007_phase2_rls_policies.sql` + `drizzle/0002_rls_functions_and_policies.sql` (functions section) | exact (per-action policies, FORCE RLS, `players_visible_to`-style helper) |
| `drizzle/0011_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0007_phase2_rls_policies.rollback.md` | exact |
| `drizzle/0012_phase3_event_type_seed.sql` | migration / seed data | INSERT ON CONFLICT | `drizzle/0008_phase2_lookup_seed.sql` | exact |
| `drizzle/0012_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0008_phase2_lookup_seed.rollback.md` | exact |

### Drizzle schema files (src/server/db/schema/)

| New/Modified file | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/server/db/schema/calendar.ts` (NEW — all calendar pgTables in one file per UI-SPEC + RESEARCH structure) | schema / pgTable barrel | static schema declarations | `src/server/db/schema/players.ts` (multi-table file with related tables) | exact (same `tstz` helper, same `index()`/`check()`/`unique()` composite syntax) |
| `src/server/db/schema/index.ts` (MODIFIED — add `export * from './calendar'`) | schema barrel re-export | static | self (line 24-33) | exact (append one line) |
| `src/server/db/schema/lookups.ts` (MODIFIED — add `eventType` table) | schema / pgTable | static lookup | `lookups.ts` lines 42-46 (`tournamentType` block) + lines 88-94 (`ageCategories`) | exact |

### tRPC layer (src/server/trpc/)

| New/Modified file | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/server/trpc/routers/calendar.ts` (or `routers/calendar/{event.ts,filterOptions.ts}` — planner discretion per CONTEXT D-decision-on-split) | controller / tRPC router | request-response + CRUD | `src/server/trpc/routers/player.ts` | exact (procedure presets, audit pattern, transaction shape, NOT_FOUND-on-out-of-scope idiom from D-36) |
| `src/server/trpc/routers/_app.ts` (MODIFIED — register `calendar` sub-router) | router composition | n/a | self (lines 28-42) | exact (append import + property) |
| `src/server/trpc/schemas/calendar.ts` (NEW — discriminated-union Zod input schemas per event type) | schema-input / Zod validation | static validation | `src/server/trpc/schemas/player.ts` | role-match (multi-variant `.strict()` + i18n-key error messages); discriminated union shape is RESEARCH §Pattern 5 — no exact analog in repo |
| `src/server/trpc/middleware/calendarCreate.ts` (NEW — per-event-type role gate matrix per D-48) | middleware / RBAC | request gate | `src/server/trpc/middleware/freshSession.ts` (requireRole, procedure-preset composition) | role-match (same `middleware(({ ctx, next }) => …)` shape; per-type discriminator on input.type is net-new) |

### Domain helpers (src/lib/)

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/rrule.ts` — `parseRrule`, `expandRrule(rrule, startsAt, durationMs, from, to, exceptions[])`, `validateHorizon(rrule, createdAt)` | utility / pure functions | transform | `src/lib/consent.ts` (CURRENT_POLICY const, `isMinorAt`) for pure-function shape; `src/lib/i18n-format.ts` for locale-aware helper shape | role-match (pure transform helpers; the `rrule` npm wrapping is net-new — see RESEARCH §Pattern 3) |
| `src/lib/calendar/conflicts.ts` (optional — planner may inline into router) — conflict-detail redaction helper | utility / pure transform | transform | `src/lib/players.ts` `deriveAgeCategory` (lookup-driven mapping with DB read) | partial (a pure mapper from `OverlappingEvent + CallerScope → RedactedConflict`); RESEARCH §Example 3 is the canonical code |

### Server + Client components (src/app/, src/components/)

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/app/[locale]/(app)/calendar/page.tsx` (Server) | server-component / pre-fetch + render | request-response | `src/app/[locale]/(app)/players/page.tsx` | exact (same `createContext()` → `appRouter.createCaller(ctx)` → tRPC server-caller pattern; BLOCKER-03 canonical) |
| `src/app/[locale]/(app)/calendar/event/[id]/page.tsx` (Server — deep-link) | server-component / route param fetch | request-response | `src/app/[locale]/(app)/players/[id]/page.tsx` (same shape pattern) — read via Glob, same dir | exact (planner reads it as it exists; this PATTERNS.md does not re-extract) |
| `src/app/[locale]/(app)/calendar/loading.tsx` | server-component / Suspense fallback | n/a | (no `loading.tsx` in `(app)/players/` — planner uses `<CalendarSkeleton>` instead per UI-SPEC line 305); skeleton component analog is `src/components/ui/skeleton.tsx` | partial (Skeleton primitive exists; the `loading.tsx` convention is net-new in Phase 3) |
| `src/components/calendar/calendar-view.tsx` (Client — FullCalendar wrapper) | client-component / library wrapper | event-driven (calendar interactions) | **no analog** — first FullCalendar usage. Reference: RESEARCH §Pattern 1 (lines 399-470) | no analog — reference docs only |
| `src/components/calendar/calendar-toolbar.tsx` (Client — view switcher + date nav) | client-component / URL-state UI | url-state event | `src/components/i18n/locale-switcher.tsx` (URL-state Client Component with `useSearchParams`) | partial (URL-state pattern only — read on demand by planner; locale-switcher is the simplest in-repo Client URL-state Component) |
| `src/components/calendar/event-chip.tsx` (`eventContent` callback — not a real React component) | client-component / FullCalendar render hook | render (JSX-returning function) | **no direct analog** — bespoke FullCalendar API. Reference: UI-SPEC §Event Chip Contract (lines 341-394) | no analog — UI-SPEC contract is canonical |
| `src/components/calendar/event-detail-sheet.tsx` (Client — read-mode Sheet) | client-component / sheet read view | request-response | `src/components/players/age-category-change-dialog.tsx` (modal that reads + acts on selected entity) | role-match (Sheet vs Dialog primitive; both compose `<Form>` + tRPC mutation + `router.refresh()`) |
| `src/components/calendar/event-create-sheet.tsx` (Client — full RHF form in a Sheet) | client-component / form with multi-step Sheet | request-response | `src/components/players/player-create-form.tsx` | exact (RHF + Zod resolver + i18n + LookupSelect + multi-mutation chain composition) |
| `src/components/calendar/event-edit-sheet.tsx` (Client — RHF form pre-populated) | client-component / form | request-response | `src/components/players/player-edit-form.tsx` (sibling to player-create-form) | exact (same shape as create-sheet, pre-populated initial values) |
| `src/components/calendar/event-delete-dialog.tsx` (Client — shadcn `AlertDialog` confirmation) | client-component / destructive confirmation | request-response | `src/components/admin/role-assign-dialog.tsx` + the existing `src/components/ui/alert-dialog.tsx` primitive | role-match (AlertDialog destructive confirmation pattern; the medical-style "do you accept consequences" copy from UI-SPEC §Delete confirmation lines 660-668 with D-58b override) |
| `src/components/calendar/event-filter-bar.tsx` (Client — chips + 4 combos, mobile bottom sheet) | client-component / URL-state filter UI | url-state event | `src/components/admin/user-table.tsx` filter pattern (Glob shows it exists at this path) | partial (filter UI present in admin user-table; the desktop+mobile breakpoint switching is net-new — UI-SPEC §Filter Bar Contract is canonical) |
| `src/components/calendar/filter-combobox.tsx` (Client — typeahead with `<Command>` + scope-filtered tRPC) | client-component / typeahead | request-response | `src/components/admin/parent-link-dialog.tsx` (server-side scope-filtered query) | partial (parent-link uses a Combobox/Command for selecting a parent in scope — closest analog for "scope-filtered typeahead via tRPC"; planner reads the file via Glob on demand) |
| `src/components/calendar/conflict-warning.tsx` (Server-safe — `<Alert>`) | client-component / pure presentation | render | `src/components/consent/re-consent-banner.tsx` (Alert-style banner with localized body) | role-match (simple presentation Alert; D-57b copy override applies) |
| `src/components/calendar/conflict-banner.tsx` (Client — auto-dismiss top-page slot) | client-component / transient banner with timer | event-driven | `src/components/consent/re-consent-banner.tsx` | role-match (same Alert primitive; the auto-dismiss timer is net-new) |
| `src/components/calendar/calendar-skeleton.tsx` (Server — Suspense fallback) | server-component / static skeleton | n/a | `src/components/common/empty-state.tsx` (Card-only Server Component pattern) + the existing `src/components/ui/skeleton.tsx` primitive | partial (Server-side primitive composition; the grid skeleton is net-new) |
| `src/components/calendar/empty-hint-strip.tsx` (Client — below-grid strip) | client-component / conditional hint | render | `src/components/common/empty-state.tsx` | role-match (different visual treatment — strip, not Card — but same "localized title + body + optional CTA" shape) |
| `src/components/common/date-time-picker.tsx` (Client — Popover + shadcn Calendar + 2× `<Input type="time">`) | client-component / compound input | render | `src/components/players/player-create-form.tsx` lines 312-358 (`dateOfBirth` Popover+Calendar composition) | exact (same `<Popover>` + `<Calendar>` mount; the two `<Input type="time">` is additive) |
| `src/components/common/rrule-editor.tsx` (Client — frequency + interval + end-mode chooser) | client-component / sub-form | render | `src/components/players/age-category-change-dialog.tsx` (sub-form inside a dialog) | partial (multi-field sub-form pattern; the RFC-5545 ↔ form-state mapping is net-new — RESEARCH §Pattern 3 references `rrule` library API) |

### i18n catalogs (messages/)

| Modified file | Role | Data Flow | Closest Analog | Match |
|---------------|------|-----------|----------------|-------|
| `messages/nl.json` (MODIFY — add `calendar.*`, `lookup.eventType.*`, `errors.calendar.*` namespaces — with D-57b conflict-copy override + D-58b delete-copy override applied) | i18n-catalog | static | self (existing `lookups.*` + `errors.*` namespaces, observed at file head — `auth.*`, `consent.*`, `lookups.status.*`, `errors.field.*`) | exact (extend existing structure) |
| `messages/en.json` | i18n-catalog | static | self | exact |
| `messages/fr.json` | i18n-catalog | static | self | exact |

### Design tokens (CSS)

| Modified file | Role | Data Flow | Closest Analog | Match |
|---------------|------|-----------|----------------|-------|
| `src/app/[locale]/globals.css` (MODIFY — append the 6 event-type triples × light+dark = 36 declarations + FullCalendar `--fc-*` overrides per UI-SPEC §Event-type color tokens + §FullCalendar built-in CSS-variable overrides) | design-token | static | self (the existing `:root` / `.dark` blocks in `globals.css`) | exact (the file already exists with the Phase 1 token convention; Phase 3 appends below) |

### Test files (Wave 0 — per VALIDATION.md → RESEARCH lines 1336-1352)

| New test file | Role | Data Flow | Closest Analog | Match |
|---------------|------|-----------|----------------|-------|
| `tests/unit/rrule.test.ts` | unit-test / pure-function coverage | n/a | `tests/unit/players-derive-age-category.test.ts` (pure-function with date inputs) | role-match (same vitest `describe` / `it` shape; DST-edge case from RESEARCH §Validation Risks added) |
| `tests/unit/color-tokens.test.ts` | unit-test / CSS parse | n/a | `tests/unit/timestamps.test.ts` (static-file invariant) | partial (CSS-parse is net-new; planner reads `globals.css` and asserts token presence) |
| `tests/unit/calendar-schemas.test.ts` (Zod schemas + discriminated union) | unit-test / Zod | n/a | `tests/unit/player-schemas.test.ts` | exact (same `.safeParse` / `.success === false` / i18n-key assertion idiom) |
| `tests/integration/calendar-rls.test.ts` (30-case role × type matrix) | integration-test / RLS | request-response | `tests/integration/rbac-matrix.test.ts` | exact (same `freshDb` + `seedRolesMatrix` + `appCaller` + `rawPgAsAppUser` pattern; per-resource probe via tRPC list AND raw psql to prove RLS) |
| `tests/integration/calendar-rrule-horizon.test.ts` (D-55 write+read gates) | integration-test / business logic | request-response | `tests/integration/player-router.test.ts` (assertion on specific i18n-key TRPCError messages) | role-match (same `expect(...).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'errors.calendar.rruleHorizonExceeded' })` shape) |
| `tests/integration/calendar-exceptions.test.ts` (D-54 exception application) | integration-test / state-mutation | request-response | `tests/integration/age-category-history.test.ts` (sequence: INSERT → close-old-row → INSERT → assert series consistency) | role-match |
| `tests/integration/calendar-conflicts.test.ts` (D-56/D-57 detection + redaction) | integration-test / cross-scope query + role-based output | request-response | `tests/integration/medical-audit.test.ts` (role-discriminated outcomes against same DB state) | role-match (assertions on `detailMode === 'full'` vs `'redacted'` across 4 caller roles) |
| `tests/integration/calendar-audit.test.ts` (5 audit codes + JSONB snapshot) | integration-test / audit-trail | request-response | `tests/integration/medical-audit.test.ts` | exact (same `audit_log.findFirst({ where: eq(action, ...) })` + `expect(row.oldValues).toMatchObject(...)` shape) |
| `tests/integration/calendar-cascade.test.ts` (FK CASCADE on delete) | integration-test / DDL behavior | request-response | `tests/integration/medical-delete.test.ts` (assertion on row absence post-DELETE across joined tables) | role-match |
| `tests/integration/calendar-decline.test.ts` (RSVP decline vs delete) | integration-test / state-mutation | request-response | `tests/integration/consent.test.ts` (mutation that flips a status on the calling user's row) | role-match |
| `tests/integration/calendar-perf.test.ts` (RISK-POLYMORPH p95 < 200 ms) | integration-test / performance | request-response | (no direct analog — Phase 1/2 has no in-test perf budget); RESEARCH §Validation Risks "Server-side expansion performance at scale" is canonical | partial (use `Date.now()` around `caller.calendar.list(...)` over 200-event seed and assert p95) |
| `tests/integration/calendar-filter-options.test.ts` (scope-filtered type-ahead) | integration-test / RLS-via-tRPC | request-response | `tests/integration/admin-user.test.ts` (TD admin list with role-scoping) | role-match |
| `tests/rls/calendar-direct-query.test.ts` (direct psql RLS proof) | rls-test / direct-DB query | request-response | `tests/rls/players-direct-query.test.ts` | exact (same `rawPgAsAppUser({ userId, role })` + `await using cx = …` pattern; same GUC-bound vs unbound assertions) |
| `tests/fixtures/calendar-seed.ts` (TD + 2 trainers + 6 players + academy + 6 event types incl. recurring + exceptions + conflicts) | test-fixture / seed helper | n/a | `tests/helpers/seed.ts` `seedRolesMatrix` (lines 60-80) | exact (same `db.execute(sql\`INSERT … ON CONFLICT DO NOTHING\`)` shape; extend the existing 7-role seed with calendar fixtures) |
| `tests/e2e/calendar-week-view.spec.ts` (base week view + event click) | e2e-test / Playwright | request-response | `tests/e2e/photo-upload.spec.ts` (login → navigate → assert UI states) | role-match (same `loginAsTd` helper + `page.goto('/nl/calendar')` + `expect(page.getByText(...))` shape) |
| `tests/e2e/calendar-create-event.spec.ts` (drag-create + conflict + save) | e2e-test / Playwright | request-response | `tests/e2e/photo-upload.spec.ts` | role-match |
| `tests/e2e/calendar-mobile.spec.ts` (Pixel 5 viewport + swipe) | e2e-test / Playwright mobile | request-response | (no direct analog — first mobile-viewport e2e); RESEARCH lines 1300-1302 + UI-SPEC §Mobile Strategy (lines 484-510) canonical | partial (use `test.use({ viewport: { width: 360, height: 640 } })` + `page.touchscreen.swipe(...)`) |
| `tests/e2e/calendar-drag.spec.ts` (drag event + conflict revert) | e2e-test / Playwright | request-response | `tests/e2e/photo-upload.spec.ts` | role-match |

---

## Pattern Assignments

### `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` (migration, additive DDL)

**Analog:** `drizzle/0006_phase2_profiles_and_files.sql`

**Header pattern** (lines 1-34) — MIG-02 expand-contract narrative, section table of contents, hand-authored disclaimer:
```sql
-- Migration 0009_phase3_calendar_base_lookup_participants_exceptions.sql — Phase 3 Wave 2.
-- ADDITIVE ONLY (MIG-02 expand-contract first phase):
--   * 4 new tables: calendar_events, event_type (lookup),
--     calendar_event_participants, calendar_event_exceptions
--   * 0 ALTER on Phase 1/2 tables
--   * 0 DROP
-- RLS policies are intentionally NOT in this file — they live in 0011 so this
-- migration can be applied independently and rolled back without bringing
-- down Phase 1+2 RLS coverage.
--
-- Lookup seed data is in 0012 (separated so schema + data have independent
-- rollback paths).
--
-- Hand-authored — same governance rule as Phase 1+2 migrations.
--
-- Sections:
--   1. CREATE TABLE event_type (lookup) — referenced by calendar_events FK.
--   2. CREATE TABLE calendar_events — base table per D-49.
--   3. CREATE TABLE calendar_event_participants — junction per D-50.
--   4. CREATE TABLE calendar_event_exceptions — per D-54.
--   5. ALTER TABLE ... ADD CONSTRAINT for FKs.
--   6. CREATE INDEX for performance indexes per RESEARCH §Pattern 2.
```

**Section-1 lookup pattern** (lines 40-54 of 0006 — `age_categories` block):
```sql
CREATE TABLE "event_type" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
```

**Section-2 base-table pattern** (lines 71-89 of 0006 — `uploaded_files` shape with CHECK constraints + inline UNIQUE + indexes-in-tail):
```sql
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_code" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"description" text,
	"rrule" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_ends_after_starts" CHECK ("calendar_events"."ends_at" >= "calendar_events"."starts_at")
);
--> statement-breakpoint
```

**Section-3 junction pattern** (PRIMARY KEY composite — RESEARCH §Pattern 2 example):
```sql
CREATE TABLE "calendar_event_participants" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_in_event" text NOT NULL,
	"rsvp_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_participants_pk" PRIMARY KEY ("event_id", "user_id"),
	CONSTRAINT "cep_role_enum" CHECK ("role_in_event" IN ('organizer','participant','invitee')),
	CONSTRAINT "cep_rsvp_enum" CHECK ("rsvp_status" IN ('pending','accepted','declined'))
);
--> statement-breakpoint
```

**Section-5 FK pattern** (lines 214-225 of 0006 — separate `ALTER TABLE ... ADD CONSTRAINT` per FK):
```sql
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_type_code_event_type_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."event_type"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "cep_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "cep_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
```

**Section-6 index pattern** (lines 243-247 of 0006):
```sql
CREATE INDEX "idx_calendar_events_starts_ends" ON "calendar_events" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_type" ON "calendar_events" USING btree ("type_code");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_creator" ON "calendar_events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_cep_user_event" ON "calendar_event_participants" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_calendar_event_exceptions_event_occurrence" ON "calendar_event_exceptions" USING btree ("event_id","occurrence_date");
```

> **`deleted_at` is intentionally absent per D-58** — hard delete only, audit-log snapshot is the forensic recovery path.

---

### `drizzle/0009_*.rollback.md` (migration, rollback companion)

**Analog:** `drizzle/0006_phase2_profiles_and_files.rollback.md`

**Required headers** (enforced by `tests/unit/migration-format.test.ts` lines 62-80):
```markdown
**Risk:** [Low/Medium/High] — narrative explaining what dropping these tables breaks.
**Procedure:** numbered steps to roll back, including dependency-order DROPs.
**Verification:** numbered `psql` commands confirming the tables are gone.
```

**Order-of-DROPs** (rolllback.md line 15-23 of 0006 — explicit dependency-unwound order, CASCADE as belt-and-braces):
```sql
BEGIN;
DROP TABLE IF EXISTS public.calendar_event_exceptions CASCADE;
DROP TABLE IF EXISTS public.calendar_event_participants CASCADE;
DROP TABLE IF EXISTS public.calendar_events CASCADE;
DROP TABLE IF EXISTS public.event_type CASCADE;
COMMIT;
```

**Cross-reference** to 0010, 0011, 0012 rollback dependencies (analog: lines 9-11 of 0006's rollback): "If migration 0010 (extension tables) has been applied, run its rollback FIRST".

---

### `drizzle/0010_phase3_calendar_extension_tables.sql` (migration, additive DDL — 6 extension tables)

**Analog:** `drizzle/0006_phase2_profiles_and_files.sql` sections 3+4 (`players` + `trainers` — independent typed tables that FK into a parent identity)

**Per-extension-table pattern** (mirrors lines 113-141 `players` block, then a sibling for each of the 6 types):
```sql
CREATE TABLE "training_sessions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"training_type_code" text NOT NULL,
	"organisation_code" text NOT NULL,
	"trainer_id" uuid NOT NULL,
	-- additional TRAIN-01 columns per REQUIREMENTS
);
--> statement-breakpoint
```

Each of the 6 (`training_sessions`, `tournaments`, `meetings`, `stages`, `eval_conversations`, `medical_appointments`) follows the same shape: `event_id uuid PK REFERENCES calendar_events(id) ON DELETE CASCADE` + typed domain columns + (per type) FKs to existing lookups/`players`/`trainers`.

**`medical_appointments` REQUIRES a NO-pgcrypto-column rule (D-58 + CONTEXT integration-point):**
> The Phase 3 `medical_appointments` extension MUST NOT contain `pgcrypto` cipher columns. Those live exclusively in Phase 1's `medical_events` table. Phase 3 fields are non-Article-9 metadata: `is_injury boolean`, `doctor text` (free-text borderline — flag for Phase 5 legal review per CONTEXT integration-point), `start_date date`, `end_date date`. Reference: `drizzle/0001_medical_isolated.sql` for the pgcrypto-protected sibling table.

---

### `drizzle/0011_phase3_calendar_rls_policies.sql` (migration, RLS DDL + SECURITY DEFINER functions)

**Analog:** `drizzle/0007_phase2_rls_policies.sql` + `drizzle/0002_rls_functions_and_policies.sql` (functions section, lines 38-120)

**Header + dependency declaration pattern** (0007 lines 1-40):
```sql
-- Migration 0011_phase3_calendar_rls_policies.sql — Phase 3 Wave 3.
-- RLS for the 4 base calendar tables + 6 extension tables + 2 SECURITY DEFINER
-- helpers (calendar_events_visible_to + overlapping_events_for_users) per D-50/D-57.
--
-- Depends on:
--   * 0002_rls_functions_and_policies.sql — current_user_id() / current_user_role() / players_visible_to() helpers.
--   * 0009_*.sql — the 4 base calendar tables.
--   * 0010_*.sql — the 6 extension tables.
```

**FORCE-RLS-on-every-new-table pattern** (lines 63-70 of 0007):
```sql
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- … one ALTER pair for every Phase 3 table.
```

**Per-action policy pattern** (lines 84-127 of 0007 — never `FOR ALL`, separate SELECT/INSERT/UPDATE/DELETE):
```sql
CREATE POLICY "calendar_events_select" ON "calendar_events" FOR SELECT
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

CREATE POLICY "calendar_events_insert" ON "calendar_events" FOR INSERT
  WITH CHECK (
    -- Per-type RBAC is also enforced at tRPC level via middleware/calendarCreate.ts;
    -- RLS is the defense-in-depth layer per D-48.
    created_by = current_user_id()
  );--> statement-breakpoint

CREATE POLICY "calendar_events_update" ON "calendar_events" FOR UPDATE
  USING (
    current_user_role() = 'technical_director'
    OR created_by = current_user_id()
  )
  WITH CHECK (
    current_user_role() = 'technical_director'
    OR created_by = current_user_id()
  );--> statement-breakpoint

CREATE POLICY "calendar_events_delete" ON "calendar_events" FOR DELETE
  USING (
    current_user_role() = 'technical_director'
    OR created_by = current_user_id()
  );--> statement-breakpoint
```

> **WITH CHECK is non-negotiable on UPDATE** — T-02-05-RLS-MISSING-WITHCHECK convention from 0007 line 95.

**SECURITY DEFINER `calendar_events_visible_to`** — analog: `players_visible_to` in `0002_rls_functions_and_policies.sql` lines 96-120:
```sql
CREATE OR REPLACE FUNCTION calendar_events_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(event_id UUID) AS $$
  -- TD / medical_staff see all
  SELECT id FROM calendar_events WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Creator sees own events
  SELECT id FROM calendar_events WHERE created_by = caller_id

  UNION

  -- Player / trainer: events where they are a participant
  SELECT event_id FROM calendar_event_participants
   WHERE user_id = caller_id

  UNION

  -- Academy_manager: events where a player in their academy is a participant
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN academy_memberships pa ON pa.user_id = cep.user_id AND pa.role = 'player'
    JOIN academy_memberships ca ON ca.academy_code = pa.academy_code AND ca.role = 'academy_manager'
   WHERE ca.user_id = caller_id AND caller_role = 'academy_manager'

  UNION

  -- Parent: events where their child is a participant
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN parent_child_links pcl ON pcl.child_user_id = cep.user_id
   WHERE pcl.parent_user_id = caller_id AND caller_role = 'parent'

  -- Sparring partner: Phase 3 NO-OP per CONTEXT integration-point + D-50.
  -- Phase 4 adds session_sparring_partners + extends this UNION.
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint
```

**SECURITY DEFINER `overlapping_events_for_users` (D-57 cross-scope)** — analog: same `players_visible_to` SECURITY DEFINER shape, but the body INTENTIONALLY bypasses RLS (it is the one Phase 3 function that does so):
```sql
CREATE OR REPLACE FUNCTION overlapping_events_for_users(
  p_user_ids UUID[],
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
) RETURNS TABLE(
  event_id UUID, user_id UUID, type_code TEXT, title TEXT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, location TEXT, created_by UUID
) AS $$
  SELECT ce.id, cep.user_id, ce.type_code, ce.title, ce.starts_at, ce.ends_at, ce.location, ce.created_by
    FROM calendar_events ce
    JOIN calendar_event_participants cep ON cep.event_id = ce.id
   WHERE cep.user_id = ANY(p_user_ids)
     AND ce.starts_at < p_ends_at
     AND ce.ends_at > p_starts_at;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;--> statement-breakpoint
```

> **Identical SET search_path / REVOKE FROM PUBLIC / GRANT TO app_user pattern as `mark_scan_result`** in `0007_phase2_rls_policies.sql` lines 320-355.

---

### `drizzle/0012_phase3_event_type_seed.sql` (migration, seed data)

**Analog:** `drizzle/0008_phase2_lookup_seed.sql`

**Idempotent INSERT pattern** (lines 16-25 of 0008):
```sql
-- Migration 0012_phase3_event_type_seed.sql — Phase 3 Wave 2.
-- Lookup reference data for the 6 event types per UI3-D11.

INSERT INTO "event_type" ("code", "sort_order", "active") VALUES
  ('event_type_training',          1, true),
  ('event_type_tournament',        2, true),
  ('event_type_meeting',           3, true),
  ('event_type_stage',             4, true),
  ('event_type_eval_conversation', 5, true),
  ('event_type_medical',           6, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
```

> Codes are language-neutral per I18N-05 (CONTEXT canonical_refs); labels live in `messages/{nl,en,fr}.json` under `lookup.eventType.*` per UI-SPEC §Lookup additions (lines 524-535).

---

### `src/server/db/schema/calendar.ts` (NEW — Drizzle pgTable barrel)

**Analog:** `src/server/db/schema/players.ts`

**Imports pattern** (lines 24-41 of players.ts):
```typescript
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { eventType, trainingType, organisation, tournamentType, ageCategories } from './lookups';
import { players } from './players';
import { trainers } from './trainers';
```

**Base-table pattern** (lines 43-96 of players.ts — uses `tstz`, table-level constraints via the `(t) => [...]` second arg):
```typescript
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    typeCode: text('type_code')
      .notNull()
      .references(() => eventType.code, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    description: text('description'),
    rrule: text('rrule'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    check(
      'calendar_events_ends_after_starts',
      sql`${t.endsAt} >= ${t.startsAt}`,
    ),
    index('idx_calendar_events_starts_ends').on(t.startsAt, t.endsAt),
    index('idx_calendar_events_type').on(t.typeCode),
    index('idx_calendar_events_creator').on(t.createdBy),
  ],
);
```

**Junction-table pattern** (`age_category_history` lines 98-122 of players.ts has the `primaryKey({ columns: [...] })` composite analog):
```typescript
export const calendarEventParticipants = pgTable(
  'calendar_event_participants',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleInEvent: text('role_in_event').notNull(),
    rsvpStatus: text('rsvp_status').notNull().default('pending'),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    check('cep_role_enum', sql`${t.roleInEvent} IN ('organizer','participant','invitee')`),
    check('cep_rsvp_enum', sql`${t.rsvpStatus} IN ('pending','accepted','declined')`),
    index('idx_cep_user_event').on(t.userId, t.eventId),
  ],
);
```

**Type-export pattern** (lines 124-127 of players.ts):
```typescript
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type CalendarEventParticipant = typeof calendarEventParticipants.$inferSelect;
// … one pair per extension table
```

**Index barrel-export** (modify `src/server/db/schema/index.ts` line 24-33 — append):
```typescript
export * from './calendar';
```

---

### `src/server/trpc/routers/calendar.ts` (NEW — tRPC router)

**Analog:** `src/server/trpc/routers/player.ts`

**Imports pattern** (lines 19-42 of player.ts):
```typescript
import { TRPCError } from '@trpc/server';
import { and, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { expandRrule, validateHorizon } from '@/lib/rrule';
import { db as rawDb, type DbClient } from '@/server/db/client';
import {
  calendarEvents,
  calendarEventExceptions,
  calendarEventParticipants,
  // … 6 extension tables
} from '@/server/db/schema/calendar';

import { writeAudit } from '../middleware/audit';
import { calendarCreateProcedureFor } from '../middleware/calendarCreate';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import {
  eventCreateInput,
  eventUpdateInput,
  eventDeleteInput,
  declineParticipationInput,
  detectConflictsInput,
  listInput,
  filterOptionsInput,
} from '../schemas/calendar';
import { router } from '../trpc';
```

**Per-procedure CRUD pattern with RLS-bound tx + audit** (lines 66-200 of player.ts — `create` mutation):
```typescript
export const calendarRouter = router({
  list: protectedProcedure
    .input(listInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      // 2-year read-time horizon clamp per D-55. See RESEARCH §Example 1 lines 1007-1011.
      // RLS does scope filtering automatically (current_user_id GUC bound by withRlsContext middleware).
      // … expand RRULE rows server-side via expandRrule(...). RESEARCH §Example 1 lines 1038-1056 is canonical.
    }),

  event: router({
    create: protectedProcedure  // wrapped via calendarCreateProcedureFor(input.type) for per-type RBAC
      .input(eventCreateInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

        // Write-time horizon validation per D-55.
        if (input.rrule) validateHorizon(input.rrule, new Date());

        const created = await dbHandle.transaction(async (tx) => {
          // 1. INSERT into calendar_events (base).
          // 2. INSERT into the type-specific extension table.
          // 3. INSERT into calendar_event_participants for every supplied participant.
          // Return the assembled row.
        });

        await writeAudit(ctx, {
          action: 'calendar_event_created',
          resourceType: 'calendar_event',
          resourceId: created.id,
          newValues: { typeCode: created.typeCode, startsAt: created.startsAt },
        });

        return created;
      }),

    delete: protectedProcedure
      .input(eventDeleteInput)
      .mutation(async ({ ctx, input }) => {
        // RESEARCH §Example 2 lines 1072-1116 is canonical. Pattern:
        //   1. SELECT base + extension + participants + exceptions FOR UPDATE
        //   2. writeAudit BEFORE the delete with full JSONB snapshot (D-58c)
        //   3. DELETE FROM calendar_events — FK CASCADE drops the rest
      }),

    // … event.update, event.declineParticipation, event.detectConflicts, event.get
  }),

  filterOptions: router({
    list: protectedProcedure
      .input(filterOptionsInput)
      .query(/* scope-filtered typeahead — RLS does the work */),
  }),
});
```

**NOT_FOUND-on-out-of-scope pattern** (D-36 enumeration prevention — lines 208-217 of player.ts `get` procedure):
```typescript
get: protectedProcedure
  .input(eventGetInput)
  .query(async ({ ctx, input }) => {
    const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
    const row = await dbHandle.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, input.eventId),
    });
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });  // RLS already scoped; surface NOT_FOUND not FORBIDDEN
    return row;
  }),
```

**Audit-on-mutation pattern** (lines 183-197 of player.ts):
```typescript
await writeAudit(ctx, {
  action: 'calendar_event_created' | 'calendar_event_updated'
        | 'calendar_event_deleted' | 'calendar_event_declined'
        | 'calendar_event_conflict_override' | 'calendar_event_exception_created',
  resourceType: 'calendar_event',
  resourceId: row.id,
  oldValues: /* JSONB snapshot for delete per D-58c */,
  newValues: /* sanitized — never include PII like full title in body */,
});
```

> The 6 audit codes above are the canonical list for VALIDATION Wave-0 `tests/integration/calendar-audit.test.ts`.

---

### `src/server/trpc/schemas/calendar.ts` (NEW — Zod discriminated-union inputs)

**Analog:** `src/server/trpc/schemas/player.ts`

**Imports + shared field groups pattern** (lines 31-67 of player.ts):
```typescript
import { z } from 'zod';

// Shared field groups
const eventCommonFields = {
  title: z.string().min(1, { message: 'errors.field.required' }).max(200),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  rrule: z.string().optional(),  // validated separately via validateHorizon in router
  participants: z.array(z.object({
    userId: z.string().uuid(),
    roleInEvent: z.enum(['organizer', 'participant', 'invitee']),
  })).default([]),
};
```

**Discriminated-union pattern** (net-new — RESEARCH §Pattern 5 lines 790-851 canonical):
```typescript
const trainingExt = z.object({
  type: z.literal('event_type_training'),
  trainingTypeCode: z.string(),
  organisationCode: z.string(),
  trainerId: z.string().uuid(),
});

const tournamentExt = z.object({
  type: z.literal('event_type_tournament'),
  tournamentTypeCode: z.string(),
  city: z.string(),
  country: z.string().length(2),
  ageCategoryCode: z.string(),
});

// … meeting, stage, evalConversation, medicalAppointment

export const eventCreateInput = z
  .intersection(
    z.object(eventCommonFields).strict(),
    z.discriminatedUnion('type', [
      trainingExt, tournamentExt, meetingExt, stageExt, evalConvExt, medicalApptExt,
    ]),
  );
```

**Error-message-as-i18n-key convention** (lines 36-38 of player.ts) — applied to every Phase 3 error string:
```typescript
const errorKeys = [
  'errors.calendar.endBeforeStart',
  'errors.calendar.rruleHorizonExceeded',
  'errors.calendar.rangeTooLarge',
  'errors.calendar.participantNotInScope',
  'errors.calendar.untitledEvent',
] as const;
```

> **`.strict()` is mandatory on every Phase 3 schema** — same VALID-06 convention as Phase 2 D-37 self-update whitelist. Field-smuggling unit test (`tests/unit/calendar-schemas.test.ts`) is the proof.

---

### `src/server/trpc/middleware/calendarCreate.ts` (NEW — per-event-type RBAC gate per D-48)

**Analog:** `src/server/trpc/middleware/freshSession.ts` (`requireRole` factory + procedure-preset composition lines 76-152)

**Middleware factory pattern** (lines 76-88 of freshSession.ts):
```typescript
import { TRPCError } from '@trpc/server';
import { middleware } from '../trpc';
import { requireRole } from './freshSession';

/**
 * Per-event-type RBAC matrix per D-48:
 *   - training: TD or trainer
 *   - tournament: TD only
 *   - meeting: any authenticated (no further gate)
 *   - stage / eval_conversation / medical: TD only
 *
 * Composed at procedure level OR enforced inside the mutation by branching on input.type.
 * Choice (planner discretion): if the input type is a discriminated-union literal, the
 * static composition is preferred; if a single mutation must dispatch on input.type,
 * the runtime check below is the alternative.
 */
export const requireRoleForEventType = (typeCode: string) =>
  middleware(({ ctx, next }) => {
    if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const role = ctx.scope.role;
    const allowed = {
      event_type_training:          ['technical_director', 'trainer'],
      event_type_tournament:        ['technical_director'],
      event_type_meeting:           ['technical_director', 'trainer', 'player', 'academy_manager', 'medical_staff'],
      event_type_stage:             ['technical_director'],
      event_type_eval_conversation: ['technical_director'],
      event_type_medical:           ['technical_director'],
    } as const;
    if (!(allowed[typeCode] ?? []).includes(role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'role_not_allowed' });
    }
    return next({ ctx });
  });
```

> **Anonymous vs wrong-role distinction** (D-48 + WR-03 fix lines 76-88 of freshSession.ts): `scope === null → UNAUTHORIZED`; authenticated wrong role → `FORBIDDEN role_not_allowed`. The UI uses UNAUTHORIZED to route to login, FORBIDDEN to surface "your role does not permit this".

---

### `src/lib/rrule.ts` (NEW — pure-function wrapper around `rrule` npm package)

**Analog:** none in repo. Closest helper-shape: `src/lib/consent.ts` (CURRENT_POLICY const + `isMinorAt`/`recordConsent`).

**Reference:** RESEARCH §Pattern 3 lines 574-660 (server-side expansion) + §Pitfall 3 lines 906-916 (timezone drift) + D-55 (2-year horizon).

**Public API to expose:**
```typescript
import { RRule, RRuleSet, rrulestr } from 'rrule';

/** Parse RFC-5545 string. Throws if invalid. */
export function parseRrule(s: string): RRule | RRuleSet;

/** Expand to concrete occurrence instances inside [from, to], applying exceptions. */
export function expandRrule(
  rrule: string,
  baseStartsAt: Date,
  durationMs: number,
  from: Date,
  to: Date,
  exceptions: ReadonlyArray<{ occurrenceDate: string; cancelled: boolean; overrideStartsAt: Date | null; overrideEndsAt: Date | null; overrideTitle: string | null; overrideLocation: string | null; overrideDescription: string | null }>,
): Array<{ startsAt: Date; endsAt: Date; isException: boolean; cancelled: boolean }>;

/** Validate that UNTIL exists and is within createdAt + 2 years. Throws TRPCError BAD_REQUEST with i18n key. */
export function validateHorizon(rrule: string, createdAt: Date): void;

/** Auto-inject UNTIL when user picks "Eindigt: Nooit" in UI3-D12 RruleEditor. */
export function ensureHorizon(rrule: string, createdAt: Date): string;
```

> The DST-edge case is mandatory test coverage per RESEARCH §Validation Risks: "weekly Tuesday 10:00 Europe/Brussels event spanning Oct 25 DST end stays at 10:00 local time post-transition".

---

### `src/app/[locale]/(app)/calendar/page.tsx` (Server Component)

**Analog:** `src/app/[locale]/(app)/players/page.tsx`

**Imports + Server-Component shape** (lines 21-46 of players page):
```typescript
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CalendarView } from '@/components/calendar/calendar-view';
import { CalendarToolbar } from '@/components/calendar/calendar-toolbar';
import { CalendarSkeleton } from '@/components/calendar/calendar-skeleton';
import { Suspense } from 'react';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; date?: string; filter?: string }>;
}

export default async function CalendarPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations('calendar');

  const ctx = await createContext();
  if (!ctx.scope) redirect(`/${locale}/login`);

  // Parse view/date/filter from URL state per UI-SPEC §Page Surfaces lines 264-265.
  const view = sp.view ?? 'week';
  const date = sp.date ?? new Date().toISOString().slice(0, 10);
  const filter = sp.filter ? JSON.parse(Buffer.from(sp.filter, 'base64').toString()) : {};

  const caller = appRouter.createCaller(ctx);
  const { from, to } = computeRangeFor(view, new Date(date));
  const initialEvents = await caller.calendar.list({ from, to, filters: filter });

  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">
      <CalendarToolbar locale={locale} />
      {/* FilterBar Client Component */}
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarView
          initialEvents={initialEvents}
          initialView={view}
          initialDate={new Date(date)}
          locale={locale}
        />
      </Suspense>
    </main>
  );
}
```

> The `createContext()` → `appRouter.createCaller(ctx)` pattern is BLOCKER-03 canonical (line 16-17 of players page). Phase 3 does NOT introduce a different server-caller path.

---

### `src/components/calendar/calendar-view.tsx` (Client Component — `'use client'` boundary)

**Analog:** No analog — first FullCalendar usage in repo. **Reference: RESEARCH §Pattern 1 lines 399-470 (FullCalendar in Next.js 15 App Router).**

**Boundary pattern** (RESEARCH lines 405-422 — dynamic locale import + ref handle):
```typescript
'use client';

import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import multiMonthPlugin from '@fullcalendar/multimonth';
import { useRef, useEffect, useState } from 'react';
import type { CalendarApi, EventInput, LocaleInput } from '@fullcalendar/core';
import { useLocale } from 'next-intl';
import type { Locale } from '@/i18n/routing';

const localeLoaders: Record<Locale, () => Promise<LocaleInput>> = {
  nl: () => import('@fullcalendar/core/locales/nl').then(m => m.default),
  en: () => import('@fullcalendar/core/locales/en-gb').then(m => m.default),
  fr: () => import('@fullcalendar/core/locales/fr').then(m => m.default),
};
// … wait-for-locale before mounting; pattern lines 425-446 of RESEARCH
```

> **Pitfalls applicable here:** RESEARCH §Pitfall 1 (FullCalendar SSR hydration mismatch — wrap in `Suspense`), §Pitfall 2 (locale file must load before mount), §Pitfall 7 (mobile swipe vs internal scroll). All three pitfalls have mitigations called out in RESEARCH lines 886-958.

---

### `src/components/calendar/event-create-sheet.tsx` (Client — multi-step RHF form in a Sheet)

**Analog:** `src/components/players/player-create-form.tsx`

**Imports pattern** (lines 39-69 of player-create-form.tsx):
```typescript
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { LookupSelect } from '@/components/lookup/lookup-select';
import { ConflictWarning } from '@/components/calendar/conflict-warning';
import { DateTimePicker } from '@/components/common/date-time-picker';
import { RruleEditor } from '@/components/common/rrule-editor';
import { FilterCombobox } from '@/components/calendar/filter-combobox';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useZodErrorMessage } from '@/lib/forms/zod-i18n';
import { trpc } from '@/lib/trpc-client';
import { eventCreateInput } from '@/server/trpc/schemas/calendar';
```

**Form-setup pattern** (lines 133-160 of player-create-form.tsx):
```typescript
const form = useForm<FormValues>({
  resolver: zodResolver(formSchema),
  defaultValues: {
    title: '',
    type: defaultType ?? 'event_type_training',
    startsAt: clickedSlotStart ?? new Date(),
    endsAt: clickedSlotEnd ?? addMinutes(new Date(), 60),
    allDay: false,
    location: '',
    description: '',
    rrule: undefined,
    participants: [],
  },
});

const createEvent = trpc.calendar.event.create.useMutation();
const detectConflicts = trpc.calendar.event.detectConflicts.useMutation();
```

**Conflict-warning + Toch-opslaan pattern** (UI-SPEC §Surface 1 lines 436-444 — net-new shape but composes existing pieces):
```typescript
async function onSubmit(values: FormValues): Promise<void> {
  // Always check conflicts first (D-57 — server is authoritative).
  const conflictsResp = await detectConflicts.mutateAsync({
    participants: values.participants,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
  });
  if (conflictsResp.conflicts.length > 0 && !forceSave) {
    setConflicts(conflictsResp.conflicts);
    return;  // render <ConflictWarning>; user clicks "Toch opslaan" → setForceSave(true) → resubmit
  }
  await createEvent.mutateAsync({ ...values, force: forceSave });
  toast.success(t('event.create.toast.created'));
  onClose();
}
```

> **D-57b copy override applies** — `<ConflictWarning>` body uses key `calendar.conflict.body` with the participant-name-first localized template (CONTEXT D-57b).

---

### `src/components/calendar/event-delete-dialog.tsx` (Client — `AlertDialog` destructive confirmation)

**Analog:** `src/components/players/age-category-change-dialog.tsx` (Dialog modal with submit + tRPC mutation + router.refresh)

**`AlertDialog` primitive** already exists at `src/components/ui/alert-dialog.tsx` (verified via Glob). Compose pattern:
```typescript
'use client';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc-client';

export function EventDeleteDialog({ eventId, open, onOpenChange }: Props) {
  const t = useTranslations('calendar.event.delete');
  const deleteMutation = trpc.calendar.event.delete.useMutation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          {/* D-58b copy override — UI-SPEC's "omkeerbaar binnen 30 dagen" replaced */}
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              await deleteMutation.mutateAsync({ eventId });
              toast.success(t('toast.deleted'));
              onOpenChange(false);
            }}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

> **D-58b override applies** — body is "Deze afspraak wordt definitief verwijderd voor alle deelnemers." (nl), NOT the UI-SPEC's "omkeerbaar binnen 30 dagen" text. CONTEXT D-58b is canonical.

---

### `messages/{nl,en,fr}.json` (i18n catalogs — MODIFY)

**Analog:** self — extend existing namespaces.

**Existing structure** (lines 1-50 of `messages/nl.json` head):
```json
{
  "auth": { … },
  "consent": { … },
  "lookups": {
    "status": { "status_a": "A-status", … },
    …
  },
  "errors": {
    "field": { "required": "…", "belgianPostalCode": "…", … }
  }
}
```

**Phase 3 additions per UI-SPEC §Localization Contract (lines 512-535) + §Copywriting Contract (lines 558-700)**:
```json
{
  "calendar": {
    "title": "Kalender",
    "views": { "week": "Week", "day": "Dag", "month": "Maand", "year": "Jaar" },
    "actions": { "today": "Vandaag", "prev": "Vorige", "next": "Volgende",
                 "create": "Nieuwe afspraak", "filters": "Filters" },
    "filters": { "byType": "Type", "byPlayer": "Speler", "byTrainer": "Trainer",
                 "bySparring": "Sparring partner", "byAcademy": "Academie",
                 "searchPlaceholder": "Zoeken…", "empty": "Geen resultaten in jouw scope",
                 "clear": "Filters wissen", "apply": "Toepassen" },
    "emptyHint": "Geen afspraken in deze periode…",
    "emptyFiltered": "Geen afspraken bij deze filters…",
    "event": {
      "create": { "title": "Nieuwe afspraak", "submit": "Afspraak aanmaken" },
      "edit":   { "title": "Afspraak wijzigen", "submit": "Wijzigingen opslaan" },
      "delete": {
        "title": "Afspraak verwijderen",
        "body":  "Deze afspraak wordt definitief verwijderd voor alle deelnemers.",
        "confirm": "Verwijderen",
        "cancel":  "Annuleren"
      },
      "fields": { "title": "Titel", "type": "Type", "start": "Start", "end": "Einde", … },
      "recurrence": { "frequency": "Frequentie", "interval": "Elke {n} {unit}", … }
    },
    "conflict": {
      "title": "Conflicteert met bestaande afspraak",
      "body": "**{participant}** is al geboekt voor {detail} {start}–{end}. Toch opslaan?",
      "saveAnyway": "Toch opslaan",
      "adjustTime": "Tijden aanpassen"
    }
  },
  "lookup": {
    "eventType": {
      "event_type_training": "Training",
      "event_type_tournament": "Toernooi",
      "event_type_meeting": "Vergadering",
      "event_type_stage": "Stage",
      "event_type_eval_conversation": "Evaluatiegesprek",
      "event_type_medical": "Medische afspraak"
    }
  },
  "errors": {
    "calendar": {
      "endBeforeStart": "Einde moet na start liggen.",
      "rruleHorizonExceeded": "Herhalingen worden in v1 beperkt tot 2 jaar.",
      "rangeTooLarge": "Het bereik is te groot. Selecteer maximaal 2 jaar.",
      "participantNotInScope": "Eén of meer geselecteerde deelnemers vallen buiten je bereik.",
      "untitledEvent": "Voeg een titel toe."
    }
  }
}
```

> **D-57b override** locks the `calendar.conflict.body` participant-first template across nl/en/fr (per CONTEXT D-57b).
> **D-58b override** locks the `calendar.event.delete.body` no-restore text across nl/en/fr (per CONTEXT D-58b).
> UI-SPEC will be updated out-of-band in the next revision; Phase 3 ships the override copy directly.

---

### `src/app/[locale]/globals.css` (MODIFY — append design tokens)

**Analog:** self — append below existing `:root` / `.dark` blocks.

**Source-of-truth excerpt** — UI-SPEC §Event-type color tokens (lines 146-202) + §FullCalendar built-in CSS-variable overrides (lines 219-250). Copy verbatim with no design changes; UI-SPEC is locked.

> Mobile breakpoint variant for `--fc-event-min-height: 2.75rem` (44px tap target — WCAG 2.5.5) is mandatory per UI-SPEC lines 245-249.

---

### Tests — Wave 0

#### `tests/unit/rrule.test.ts`

**Analog:** `tests/unit/players-derive-age-category.test.ts` (pure-function unit test with date inputs).

**Shape:**
```typescript
import { describe, it, expect } from 'vitest';
import { expandRrule, validateHorizon, parseRrule } from '@/lib/rrule';

describe('expandRrule — RFC 5545 expansion', () => {
  it('DST boundary: weekly Tuesday 10:00 Europe/Brussels — Oct 25 stays at 10:00 local', () => { /* … */ });
  it('applies exceptions: cancelled occurrences are skipped', () => { /* … */ });
  it('applies overrides: overrideStartsAt+overrideEndsAt replace original', () => { /* … */ });
});

describe('validateHorizon — D-55 write-time gate', () => {
  it('rejects RRULE without UNTIL', () => { /* … */ });
  it('rejects UNTIL beyond createdAt + 2y', () => { /* … */ });
  it('accepts UNTIL within window', () => { /* … */ });
});
```

#### `tests/integration/calendar-rls.test.ts`

**Analog:** `tests/integration/rbac-matrix.test.ts`

**Shape** (RBAC matrix lines 23-152):
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, rawPgAsAppUser } from '../helpers/db';
import { seedCalendarFixtures } from '../fixtures/calendar-seed';
import { appCaller } from '../helpers/trpc';

describe.each(ROLES)('calendar RLS — role: %s', (role) => {
  describe.each(EVENT_TYPES)('event type: %s', (type) => {
    it(`is ${CALENDAR_RLS_EXPECTATIONS[role][type]} via tRPC list`, async () => { /* … */ });
    it(`is ${CALENDAR_RLS_EXPECTATIONS[role][type]} via direct psql as app_user`, async () => {
      const rows = await rawPgAsAppUser<{ id: string }>({
        userId: users[role], role,
        sql: 'SELECT id FROM calendar_events WHERE type_code = $1',
        params: [type],
      });
      /* … */
    });
  });
});

// SPARRING-PARTNER NO-OP assertion per CONTEXT integration-point + D-50:
// Phase 3 returns 0 rows for sparring_partner — Phase 4 will replace this.
```

#### `tests/integration/calendar-audit.test.ts`

**Analog:** `tests/integration/medical-audit.test.ts`

**Five audit codes to assert** (per Pattern Assignments §router section above):
1. `calendar_event_created`
2. `calendar_event_updated`
3. `calendar_event_deleted` — JSONB snapshot of base+extension+participants+exceptions per D-58c
4. `calendar_event_declined` — RSVP decline
5. `calendar_event_conflict_override` — when user clicks "Toch opslaan" with `force: true` (D-57)
6. `calendar_event_exception_created` — single-occurrence override write

(Note: 5 + exception = 6 codes total; the "5" in RESEARCH §Wave 0 Gaps line 1342 is a typo — planner ships 6.)

#### `tests/rls/calendar-direct-query.test.ts`

**Analog:** `tests/rls/players-direct-query.test.ts` (lines 1-129 — `rawPgAsAppUser` + GUC-bound vs unbound probes)

**Shape:** three probes per CONTEXT D-50:
1. Trainer participant → sees only events where they participate or created
2. Trainer non-participant → 0 rows
3. No GUC bound → 0 rows (default-deny baseline)

#### `tests/fixtures/calendar-seed.ts`

**Analog:** `tests/helpers/seed.ts` `seedRolesMatrix` (lines 60-200)

**Shape:**
```typescript
export async function seedCalendarFixtures(
  db: ReturnType<typeof drizzle>,
  seeded: SeededRolesMatrix,
): Promise<SeededCalendarFixtures> {
  // 1. Insert 6 events (one per type) with TD as creator
  // 2. Add participants drawn from seeded.users
  // 3. Insert one recurring event (weekly Tuesday 10:00, UNTIL +1y)
  // 4. Insert one exception (cancelled occurrence of the recurring)
  // 5. Insert one overlapping event for the conflict-detection test
  // All via dbHandle.db.execute(sql\`INSERT INTO … ON CONFLICT DO NOTHING\`)
}
```

#### `tests/e2e/calendar-mobile.spec.ts`

**Analog:** `tests/e2e/photo-upload.spec.ts` (login-then-navigate Playwright shape).

**Mobile-specific addition** (no direct analog — RESEARCH lines 1300-1302 canonical):
```typescript
test.use({ viewport: { width: 360, height: 640 } });

test('mobile single-day view + horizontal swipe navigates', async ({ page }) => {
  await loginAsTd(page);
  await page.goto('/nl/calendar');
  await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
  // Swipe via pointer events (vanilla, per UI-SPEC §Mobile Strategy line 484)
  const cal = page.locator('.fc');
  await cal.evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 400, pointerType: 'touch' }));
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: 80,  clientY: 400, pointerType: 'touch' }));
    el.dispatchEvent(new PointerEvent('pointerup',   { clientX: 80,  clientY: 400, pointerType: 'touch' }));
  });
  // Assert FC navigated forward — header date string shifted by 1 day
});
```

---

## Shared Patterns

### Authentication / scope-binding

**Source:** `src/server/trpc/middleware/freshSession.ts` (procedure presets) + `src/server/trpc/middleware/rls.ts` (RLS GUC binding)
**Apply to:** every Phase 3 tRPC procedure in `calendar.ts`

`protectedProcedure` is the right preset for `calendar.list`, `event.get`, `event.create`, `event.update`, `event.delete`, `event.declineParticipation`, `event.detectConflicts`, `filterOptions.list`. It chains:
1. `requireAuth` — `UNAUTHORIZED` if no session.
2. `withRlsContext` — opens RLS-bound Drizzle tx, binds `app.user_id` / `app.user_role` / `app.request_id` / `app.medical_key` GUCs.
3. `requireCurrentConsent` — D-07 re-consent gate.

**No new procedure preset for Phase 3.** The per-event-type RBAC matrix from D-48 is enforced inline inside `event.create` (run `requireRoleForEventType(input.type)` after Zod parse) — see `calendarCreate.ts` pattern above.

---

### Audit logging

**Source:** `src/server/trpc/middleware/audit.ts` — `writeAudit(ctx, entry)`
**Apply to:** every Phase 3 mutation (create/update/delete/decline/conflict-override/exception-create)

```typescript
await writeAudit(ctx, {
  action: 'calendar_event_<verb>',
  resourceType: 'calendar_event',
  resourceId: row.id,
  oldValues: /* pre-image — for delete, JSONB snapshot of full row-family per D-58c */,
  newValues: /* post-image — sanitized (no full title body for medical events) */,
});
```

**JSONB snapshot cap** (RESEARCH §Pitfall 9 lines 968-976): cap exceptions array at 1000 rows; include `exceptionsTotalCount` field if truncated. Test `tests/integration/calendar-audit.test.ts` asserts `audit_log.old_values` byte-size < 1MB.

---

### Error handling

**Source:** `src/server/trpc/routers/player.ts` (gap-closure SQLSTATE → TRPCError mapping lines 168-181)
**Apply to:** `calendar.event.create` and `calendar.event.update` for CHECK-constraint violations (`calendar_events_ends_after_starts`):

```typescript
} catch (err: unknown) {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23514' && e.constraint === 'calendar_events_ends_after_starts') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.endBeforeStart',
    });
  }
  throw err;
}
```

---

### Input validation

**Source:** `src/server/trpc/schemas/player.ts` (`.strict()` + i18n-key error messages)
**Apply to:** every schema in `src/server/trpc/schemas/calendar.ts`

- `.strict()` on every object (VALID-06 carry-forward).
- All error messages are i18n keys (D-46 + I18N-08) under `errors.calendar.*`.
- Form-level Zod resolver on the client uses `useZodErrorMessage` from `src/lib/forms/zod-i18n.ts` to resolve keys at render time.

---

### Date display

**Source:** `src/lib/i18n-format.ts` (`formatDate`, `formatNumber`, `WEEK_STARTS_ON_MONDAY`)
**Apply to:** every Phase 3 component that renders a date — `EventDetailSheet`, `RruleEditor` end-date summary, recurrence-summary toast, `EmptyHintStrip` date hints.

`dd/MM/yyyy` for date and `HH:mm` for time across all 3 locales (Belgian convention, 24h). Monday weekstart per I18N-07.

---

### Server / Client Component split

**Source:** `src/app/[locale]/(app)/players/page.tsx` (Server) + `src/components/players/player-list-table.tsx` (Client with `'use client'` boundary)
**Apply to:** `calendar/page.tsx` (Server) → `<CalendarView>` (Client). The `'use client'` boundary lives at `<CalendarView>` only; page, toolbar (URL-state-driven), filter-bar (URL-state-driven), skeletons stay Server-renderable or boundary themselves.

**Critical:** FullCalendar requires `window`, `document`, `ResizeObserver` — RESEARCH §Pitfall 1 SSR hydration mismatch lines 886-894 mandates the Client boundary at `<CalendarView>`.

---

### URL state

**Source:** `src/components/i18n/locale-switcher.tsx` (URL-state Client Component with `useSearchParams`)
**Apply to:** `CalendarToolbar` (view/date), `EventFilterBar` (filter base64 JSON)

Per UI-SPEC line 265 — `?view=week|day|month|year`, `?date=YYYY-MM-DD`, `?filter=<base64>`. Server reads `searchParams` in `page.tsx`; client mutates via `router.push(/calendar?view=...)`.

---

## No Analog Found

Files with no close match in the codebase — planner uses RESEARCH.md / UI-SPEC.md / external library docs:

| File | Role | Reason / Reference |
|------|------|--------------------|
| `src/components/calendar/calendar-view.tsx` | Client / FullCalendar wrapper | First FullCalendar usage. **Reference: RESEARCH §Pattern 1 (lines 399-470) + §Pitfalls 1, 2, 7, 8 (lines 886-958) + UI-SPEC §Mobile Strategy (lines 484-510)** |
| `src/components/calendar/event-chip.tsx` | FullCalendar `eventContent` callback | FullCalendar-specific render hook — NOT a real React component (no hooks, no context). **Reference: UI-SPEC §Event Chip Contract (lines 337-395)** |
| `src/lib/rrule.ts` | `rrule` npm wrapping | First RRULE usage. **Reference: RESEARCH §Pattern 3 (lines 574-660) + §Pitfall 3 (timezone drift, lines 906-916) + D-55 horizon defense-in-depth** |
| `src/components/common/rrule-editor.tsx` | RRULE form sub-component | First RRULE UI. **Reference: UI-SPEC §Form-field contract row "Recurring" (line 323) + CONTEXT D-12 (UI3-D12)** |
| `tests/integration/calendar-perf.test.ts` | Performance budget | No in-test perf budget exists in Phase 1/2. **Reference: RESEARCH §Validation Risks + RISK-POLYMORPH budget 200ms p95** |
| `tests/e2e/calendar-mobile.spec.ts` | Mobile-viewport e2e | No mobile-viewport Playwright test in Phase 1/2. **Reference: RESEARCH §Wave 0 Gaps + UI-SPEC §Mobile Strategy** |
| `overlapping_events_for_users` (in `0011_*.sql`) | Cross-scope SECURITY DEFINER | Single function in Phase 3 that intentionally bypasses RLS for scheduling-correctness (D-57). **Closest analog shape: `mark_scan_result` in `0007_phase2_rls_policies.sql` lines 320-355 — same REVOKE/GRANT discipline, different semantic role.** |

---

## Coverage Cross-Check

### Locked decisions D-47..D-59 — pattern coverage map

| Decision | Pattern entry |
|----------|---------------|
| D-47 (6 event types with full domain columns) | 0010 extension-tables migration, `calendar.ts` schema barrel |
| D-48 (per-type create permissions matrix) | `calendarCreate.ts` middleware |
| D-49 (class-table inheritance) | 0009 base + 0010 extensions; `calendar.ts` schema; RESEARCH §Pattern 2 |
| D-50 (participants junction + RLS UNION) | 0009 junction; 0011 `calendar_events_visible_to` SECURITY DEFINER |
| D-51 (Phase 4 handover) | Documented in Pattern Assignments §router section header; PLAN.md must include the hard "no schema changes in Phase 4" note |
| D-52 (`rrule` npm library) | `src/lib/rrule.ts` |
| D-53 (server-side expansion) | `calendar.ts` router list query; RESEARCH §Example 1 |
| D-54 (exceptions table — full single-occurrence override) | 0009 migration `calendar_event_exceptions`; `calendar.ts` schema |
| D-55 (2-year horizon defense in depth) | `validateHorizon` in `src/lib/rrule.ts`; `calendar.list` read-time clamp |
| D-56 (per-participant overlap) | 0011 `overlapping_events_for_users` SECURITY DEFINER |
| D-57 (soft warning + cross-scope + redaction) | `calendar.ts` `detectConflicts` procedure; RESEARCH §Example 3 |
| D-57b (copy override) | `messages/{nl,en,fr}.json` `calendar.conflict.body` key |
| D-58 (3 delete operations: hard / decline / cancel-occurrence) | `event.delete` mutation; `event.declineParticipation` mutation; exception-write inside `event.update` |
| D-58b (delete copy override) | `messages/{nl,en,fr}.json` `calendar.event.delete.body` key |
| D-58c (cascade order + audit-before-delete) | RESEARCH §Example 2 |
| D-59 (no soft-delete in conflict detection) | n/a — no extra code; documented as a non-decision |

### Wave 0 test files — pattern coverage map

| Wave 0 file (per VALIDATION → RESEARCH lines 1336-1352) | Pattern entry |
|----------------------------------------------------------|---------------|
| `tests/unit/rrule.test.ts` | ✅ entry above |
| `tests/unit/color-tokens.test.ts` | ✅ entry above |
| `tests/integration/calendar-rls.test.ts` | ✅ entry above |
| `tests/integration/calendar-rrule-horizon.test.ts` | ✅ via `player-router.test.ts` analog |
| `tests/integration/calendar-exceptions.test.ts` | ✅ via `age-category-history.test.ts` analog |
| `tests/integration/calendar-conflicts.test.ts` | ✅ via `medical-audit.test.ts` analog (role-discriminated outcomes) |
| `tests/integration/calendar-audit.test.ts` | ✅ entry above |
| `tests/integration/calendar-cascade.test.ts` | ✅ via `medical-delete.test.ts` analog |
| `tests/integration/calendar-decline.test.ts` | ✅ via `consent.test.ts` analog |
| `tests/integration/calendar-perf.test.ts` | ⚠ no analog — reference docs only |
| `tests/integration/calendar-filter-options.test.ts` | ✅ via `admin-user.test.ts` analog |
| `tests/rls/calendar-direct-query.test.ts` | ✅ entry above |
| `tests/e2e/calendar-week-view.spec.ts` | ✅ via `photo-upload.spec.ts` analog |
| `tests/e2e/calendar-create-event.spec.ts` | ✅ via `photo-upload.spec.ts` analog |
| `tests/e2e/calendar-mobile.spec.ts` | ⚠ partial — Playwright shape via `photo-upload.spec.ts`, viewport+swipe net-new |
| `tests/e2e/calendar-drag.spec.ts` | ✅ via `photo-upload.spec.ts` analog |
| `tests/fixtures/calendar-seed.ts` | ✅ entry above |
| `tests/unit/calendar-schemas.test.ts` | ✅ entry above |

---

## Metadata

**Analog search scope:** `drizzle/`, `src/server/db/schema/`, `src/server/trpc/`, `src/lib/`, `src/components/`, `src/app/[locale]/(app)/`, `tests/`, `messages/`
**Files scanned:** 28 files read directly + ~40 verified via Glob/Bash listings
**Phase 1+2 status:** ✅ complete — every analog file referenced is currently committed.
**Pattern extraction date:** 2026-05-14

---

## PATTERN MAPPING COMPLETE

**Phase:** 03 - Kalender
**Files classified:** ~70 new + 3 modified
**Analogs found:** 65 / 70

### Coverage
- Files with exact analog: 38
- Files with role-match analog: 22
- Files with partial analog (compose existing pieces with net-new logic): 5
- Files with no analog (reference docs only): 5 (FullCalendar wrapper, event-chip callback, rrule.ts, calendar-perf test, calendar-mobile e2e swipe)

### Key Patterns Identified
- **Migrations split by concern across 4 files** (schema base / extension tables / RLS policies / lookup seed) per Phase 2's 0006/0007/0008 split — each rollback-independent (MIG-02 expand-contract).
- **All Drizzle schemas use `tstz` helper + table-level constraints via `(t) => [...]` form** — `players.ts` is the canonical multi-table-in-one-file shape.
- **All tRPC procedures compose `protectedProcedure` + per-mutation `writeAudit`** — no new procedure preset in Phase 3; per-event-type RBAC enforced inline via `calendarCreate.ts` middleware factory.
- **All Zod schemas use `.strict()` + i18n-key error messages** — `errors.calendar.*` is the new namespace.
- **NOT_FOUND-on-out-of-scope (D-36) carry-forward** — every Phase 3 `get`/`update`/`delete` mutation must surface `NOT_FOUND` for RLS-filtered rows, never `FORBIDDEN`.
- **JSONB audit snapshot before delete (D-58c)** — RESEARCH §Example 2 lines 1072-1116 is the canonical implementation.
- **SECURITY DEFINER for cross-scope queries** — `overlapping_events_for_users` follows the same `SET search_path = pg_catalog, public` / `REVOKE FROM PUBLIC` / `GRANT TO app_user` discipline as Phase 2's `mark_scan_result`.
- **`'use client'` boundary lives at `<CalendarView>` only** — page, toolbar (URL-state-driven), filter-bar stay outside the boundary or are their own self-contained Client islands.

### File Created
`/Users/kris/Documents/Claude Code/VTTL Topsport/.planning/phases/03-kalender/03-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. `gsd-planner` can now reference analog patterns in PLAN.md files. Every locked decision D-47..D-59 and every Wave 0 test file from VALIDATION.md has a pattern entry; the 5 net-new patterns (FullCalendar, rrule, cross-scope SECURITY DEFINER, perf test, mobile swipe e2e) are explicitly flagged with the canonical reference doc.
