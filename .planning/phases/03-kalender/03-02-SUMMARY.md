---
phase: 03-kalender
plan: 02
subsystem: calendar-schema
tags: [drizzle, postgres, rls, security-definer, polymorphism, calendar]
requires:
  - 03-01 (FullCalendar package install + shadcn UI components — base for downstream UI plans)
  - 0006_phase2_profiles_and_files.sql (trainers + players + lookups carry-forward)
  - 0007_phase2_rls_policies.sql (RLS pattern carry-forward)
  - 0002_rls_functions_and_policies.sql (current_user_id / current_user_role STABLE wrappers)
provides:
  - 4 hand-authored migrations: 0009 (base+lookup+junction+exceptions), 0010 (6 extension tables), 0011 (RLS + 2 SECURITY DEFINER fns), 0012 (event_type seed)
  - 4 rollback companions with Risk/Procedure/Verification per MIG-05
  - 10 Postgres tables (1 lookup, 1 base, 1 junction, 1 exceptions, 6 extensions)
  - 2 SECURITY DEFINER functions: calendar_events_visible_to + overlapping_events_for_users
  - 38 named per-action RLS policies (4 actions × 9 secured tables + 2 lookup policies on event_type)
  - Drizzle barrel src/server/db/schema/calendar.ts (9 pgTables, relations, 16 type exports)
  - eventType lookup added to src/server/db/schema/lookups.ts
  - Schema barrel re-exports calendar via src/server/db/schema/index.ts
affects:
  - Wave 2 tRPC routers (calendar.event.* and calendar.list) can now type-check + run RLS-bound queries
  - Wave 3 conflict-detection service can call overlapping_events_for_users via app_user GRANT EXECUTE
  - Phase 4 schema-handover contract reaffirmed (D-51): no Phase 4 changes to these 10 tables
tech-stack:
  added:
    - drizzle pgTable + relations + check + index + primaryKey + unique
    - Postgres tstzrange overlap operator (&&) for cross-scope conflict detection
  patterns:
    - Class-table inheritance polymorphism per D-49
    - Polymorphic participant junction with composite PK per D-50
    - Single-occurrence override table with UNIQUE (event_id, occurrence_date) per D-54
    - Cross-scope SECURITY DEFINER bypass with role-gated service-layer redaction per D-57
    - Hard-delete only (no deleted_at column) + audit-log JSONB snapshot for forensic recovery per D-58
    - ENABLE+FORCE RLS on all new tables per Phase 1 discipline (extended to event_type lookup per Rule 2 deviation)
key-files:
  created:
    - drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql
    - drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.rollback.md
    - drizzle/0010_phase3_calendar_extension_tables.sql
    - drizzle/0010_phase3_calendar_extension_tables.rollback.md
    - drizzle/0011_phase3_calendar_rls_policies.sql
    - drizzle/0011_phase3_calendar_rls_policies.rollback.md
    - drizzle/0012_phase3_event_type_seed.sql
    - drizzle/0012_phase3_event_type_seed.rollback.md
    - src/server/db/schema/calendar.ts
  modified:
    - src/server/db/schema/lookups.ts (append eventType pgTable)
    - src/server/db/schema/index.ts (append export * from './calendar')
decisions:
  - D-47: All 6 event types get full domain-specific extension columns in Phase 3 (TRAIN-01/TOURN-01/AGE-01/AGE-03/MED-EVENT)
  - D-49: Class-table inheritance — base calendar_events + 6 typed extension tables (1:1 FK CASCADE)
  - D-50: Polymorphic participant junction with composite PK (event_id, user_id); sparring_partner UNION branch NO-OP in Phase 3
  - D-51: Phase 4 schema-freeze contract — operational tables ONLY, no changes to these 10 schemas
  - D-54: calendar_event_exceptions with override_* columns + UNIQUE (event_id, occurrence_date)
  - D-57: overlapping_events_for_users SECURITY DEFINER bypasses RLS; service-layer applies role-gated redaction
  - D-58: Hard delete only on calendar_events (no deleted_at); audit-log JSONB snapshot is the forensic path
metrics:
  duration_minutes: 11
  completed: 2026-05-14
  tasks_completed: 4
  files_created: 9
  files_modified: 2
  migrations_added: 4
  tables_added: 10
  rls_policies_added: 38
  security_definer_fns_added: 2
threat_refs:
  - V1 (input validation — type_code FK + Zod at tRPC boundary)
  - V4 (authentication / RLS — default-deny baseline + role-aware visibility fn)
  - V5 (authorization — per-action RLS policies, cep_update_self for RSVP forgery prevention)
  - V8 (logging — audit-log JSONB snapshot pre-DELETE per D-58c)
---

# Phase 3 Plan 02: Calendar Polymorphic Schema Summary

**One-liner:** Ships the 10-table calendar foundation — base `calendar_events` with class-table inheritance polymorphism into 6 typed extensions, polymorphic participant junction, single-occurrence exceptions, plus 2 SECURITY DEFINER functions powering RLS visibility and cross-scope conflict detection — with hand-authored Drizzle migrations + matching pgTable barrel, ready for Wave 2 tRPC routers and Wave 0 RLS tests.

## What Was Built

### Migration 0009 — Base + Lookup + Junction + Exceptions (Task 1, commit `19f79dd`)

`drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` creates 4 tables:

1. `event_type` — lookup (code text PK, sort_order, active). Same shape as Phase 1 `tournament_type` / `training_type`.
2. `calendar_events` — base table per D-49 with id (uuid), type_code FK, title, starts_at/ends_at (TIMESTAMPTZ), all_day, optional location/description/rrule, created_by FK, timestamps. CHECK `ends_at >= starts_at`. **No `deleted_at` column** (D-58 hard delete only).
3. `calendar_event_participants` — junction per D-50 with composite PK (event_id, user_id), role_in_event enum (organizer/participant/invitee), rsvp_status enum (pending/accepted/declined default pending). Index (user_id, event_id) for scope-driven queries.
4. `calendar_event_exceptions` — per D-54 with override_starts_at/ends_at/title/location/description, cancelled bool. UNIQUE (event_id, occurrence_date). CHECK ensures both override times present together with override_ends_at >= override_starts_at.

FK CASCADE on event_id (D-58 atomicity); RESTRICT on created_by (audit trail). 6 performance indexes per RESEARCH §Pattern 2.

### Migration 0010 — Six Typed Extension Tables (Task 2, commit `3759adb`)

`drizzle/0010_phase3_calendar_extension_tables.sql` creates 6 extension tables, each with `event_id uuid PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE` (D-49):

| Extension | Domain columns | REQ ref |
|---|---|---|
| `training_sessions` | duration_minutes (CHECK > 0), training_type_code, organisation_code, trainer_id | TRAIN-01 |
| `tournaments` | city, country (CHECK ISO2, default 'BE'), age_category_code, tournament_type_code | TOURN-01 |
| `meetings` | (none — base columns suffice) | D-47 base |
| `stages` | place, country (CHECK ISO2, default 'BE') | AGE-01 |
| `eval_conversations` | evaluator_user_id, player_user_id | AGE-03 |
| `medical_appointments` | is_injury, doctor (free text) | MED-EVENT (non-Article-9 only; no pgcrypto cipher columns) |

### Migration 0011 — RLS Policies + 2 SECURITY DEFINER Functions (Task 3, commit `b1863fb`)

`drizzle/0011_phase3_calendar_rls_policies.sql`:

- **Section 1:** ENABLE + FORCE RLS on all 10 new tables (Phase 1 discipline). Includes `event_type` lookup per Rule 2 deviation — matches Phase 1's lookup-RLS pattern (status, academy, tournament_type all have FORCE RLS in 0002). event_type carries 2 policies (FOR SELECT USING true + FOR ALL TO app_user TD-write).
- **Section 2:** `calendar_events_visible_to(caller_id, caller_role)` SECURITY DEFINER returns SETOF event_id via 5-branch UNION per D-50:
  1. TD / medical_staff → all events
  2. Creator → own events
  3. Participant → events they're in (main scope path)
  4. trainer / academy_manager → events of academy players via academy_memberships JOIN
  5. parent → events of linked children via parent_child_links JOIN
  6. (sparring_partner: NO-OP per D-50 — Phase 4 will add UNION branch with session_sparring_partners)
  - `SET search_path = pg_catalog, public` (T-03-09 injection mitigation).
  - REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO app_user.
- **Section 3:** `overlapping_events_for_users(p_user_ids uuid[], p_from timestamptz, p_to timestamptz)` SECURITY DEFINER bypasses RLS for cross-scope conflict detection per D-57. Returns minimum columns (event_id, user_id, type_code, title, starts_at, ends_at, location, created_by) — **never returns description** (T-03-04 existence-leak mitigation). Uses tstzrange half-open `[)` overlap (matches FullCalendar interval semantics). Same search_path + REVOKE/GRANT discipline.
- **Sections 4-7:** 36 per-action RLS policies (4 actions × 9 secured tables):
  - SELECT: every table uses `calendar_events_visible_to()` to scope reads.
  - INSERT: WITH CHECK created_by = current_user_id() on base; extension/junction/exceptions check EXISTS(parent event owned by caller-or-TD).
  - UPDATE: USING + WITH CHECK creator-or-TD on base; same on extensions/exceptions; **cep_update_self restricts row to user_id = current_user_id()** (T-03-06 RSVP forgery mitigation).
  - DELETE: creator-or-TD on all tables (D-58 hard delete authority).

### Migration 0012 — event_type Seed (Task 3, commit `b1863fb`)

`drizzle/0012_phase3_event_type_seed.sql` seeds 6 language-neutral codes per UI3-D11 + D-47:

```
event_type_training, event_type_tournament, event_type_meeting,
event_type_stage, event_type_eval_conversation, event_type_medical
```

ON CONFLICT DO NOTHING for idempotency.

### Drizzle Schema Barrel (Task 4, commit `bf500b3`)

- `src/server/db/schema/calendar.ts` — 9 pgTable definitions, calendarEventsRelations (one-to-one to each extension + many to participants/exceptions + creator FK), and 16 type exports (Select + Insert per table).
- `src/server/db/schema/lookups.ts` — append eventType pgTable.
- `src/server/db/schema/index.ts` — append `export * from './calendar'`.

Column names/types match migrations 0009 + 0010 byte-for-byte.

## Verification

- **`pnpm typecheck`:** Passes (no TypeScript errors against new calendar schema).
- **Migration file presence:** 4 SQL files + 4 rollback md files present in drizzle/ with correct numbering (0009..0012).
- **RLS policy count:** `grep -c "CREATE POLICY"` in 0011 returns 38 (>= 36 required).
- **SECURITY DEFINER count:** 2 functions with `SECURITY DEFINER SET search_path = pg_catalog, public`.
- **FORCE RLS count:** 10 (>=10 required after Rule 2 event_type addition).
- **No forbidden cipher columns** in `medical_appointments`: grep `(diagnosis|body|scan_data|cipher)` returns empty.
- **No `deleted_at` column** in calendar_events: only present in comments documenting D-58.
- **No stubs / TODOs / FIXMEs** in any new file.

### Deferred — `pnpm db:push`

The Task 4 step 4 (`pnpm db:push`) and the live-DB smoke checks could not be executed in the parallel worktree:

- No `.env` file present (only `.env.example`).
- `DIRECT_DATABASE_URL` environment variable is unset; `pnpm db:push` failed with "Either connection url or host, database are required".

This is an environment limitation of the parallel-executor worktree, not a code defect. The success_criteria explicitly qualifies this step as "(if DB available)". The migration files are byte-for-byte ready; the verifier or merge-back step is the natural place to apply them against the dev Supabase EU-Frankfurt instance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Critical] Added ENABLE+FORCE RLS on `event_type` lookup**

- **Found during:** Task 3 (Migration 0011 authoring).
- **Issue:** The plan's `must_haves.truths` claim "RLS is ENABLED + FORCED on every new table" but the inline SQL in Task 3 enumerated only 9 tables (skipping the `event_type` lookup). The verify check `grep -c "FORCE ROW LEVEL SECURITY" ... >= 10` would have failed; more importantly, omitting RLS on `event_type` would contradict the must_have claim and the Phase 1 pattern (status / academy / tournament_type all have FORCE RLS in `0002`).
- **Fix:** Added `ALTER TABLE event_type ENABLE/FORCE ROW LEVEL SECURITY` plus 2 policies:
  - `event_type_read FOR SELECT USING (true)` — every authenticated caller can read lookup codes.
  - `event_type_td_writes FOR ALL TO app_user` with USING + WITH CHECK `current_user_role() = 'technical_director'` — mirror Phase 1 academy pattern (Migration 0002 line 235-ish).
- **Files modified:** `drizzle/0011_phase3_calendar_rls_policies.sql` (Section 1), `drizzle/0011_phase3_calendar_rls_policies.rollback.md` (drop policies + disable RLS on event_type).
- **Commit:** `b1863fb`

### Other Notes

- **Phase 4 schema-handover contract (D-51) reaffirmed** inline in Migration 0009's header comment block: no Phase 4 changes are permitted to `calendar_events`, `calendar_event_participants`, `calendar_event_exceptions`, `training_sessions`, `tournaments`, `meetings`, `stages`, `eval_conversations`, `medical_appointments`. Phase 4 adds operational tables ONLY (session_participants, session_sparring_partners, tournament_results, match_results, ranking_entries).

- **`medical_appointments.doctor` free-text flagged for Phase 5 legal review** per CONTEXT integration-point. If review concludes Article-9 status, Phase 5 ships an additive migration to encrypt the column via pgcrypto. The base `medical_appointments` extension remains non-Article-9 metadata (`is_injury` bool + free-text doctor).

- **Plan verify check `! grep -q "deleted_at"` is overly literal** — the SQL file mentions `deleted_at` in two comment lines documenting the D-58 hard-delete decision. The file correctly contains no `deleted_at` column. Documenting here so a future agent reading the must_haves doesn't try to remove the comments.

## TDD Gate Compliance

Plan type is `execute`, not `tdd`. No RED/GREEN/REFACTOR gate sequence required. Wave 0 RLS tests (already scaffolded in `tests/integration/` per parallel_execution context) will remain RED until Wave 2 ships the tRPC routers — that is expected and is not a gate violation here.

## Known Stubs

None. No hardcoded empty UI state, no placeholder text, no TODOs in any new file.

## Threat Flags

None — all new surface (10 tables + 2 DEFINER fns + 38 policies) is fully covered by the plan's `<threat_model>` register (T-03-04 through T-03-10). No new threats discovered beyond those documented.

## Self-Check: PASSED

**Created files (all confirmed present):**

- FOUND: drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql
- FOUND: drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.rollback.md
- FOUND: drizzle/0010_phase3_calendar_extension_tables.sql
- FOUND: drizzle/0010_phase3_calendar_extension_tables.rollback.md
- FOUND: drizzle/0011_phase3_calendar_rls_policies.sql
- FOUND: drizzle/0011_phase3_calendar_rls_policies.rollback.md
- FOUND: drizzle/0012_phase3_event_type_seed.sql
- FOUND: drizzle/0012_phase3_event_type_seed.rollback.md
- FOUND: src/server/db/schema/calendar.ts

**Modified files (all confirmed present + change applied):**

- FOUND: src/server/db/schema/lookups.ts (eventType pgTable appended)
- FOUND: src/server/db/schema/index.ts (calendar barrel re-export appended)

**Commits (all confirmed in `git log`):**

- FOUND: 19f79dd — feat(03-02): add migration 0009 — calendar base, lookup, junction, exceptions
- FOUND: 3759adb — feat(03-02): add migration 0010 — six typed event extension tables
- FOUND: b1863fb — feat(03-02): add migrations 0011 (RLS + SECURITY DEFINER) and 0012 (event_type seed)
- FOUND: bf500b3 — feat(03-02): add Drizzle schema barrel for calendar polymorphic schema
