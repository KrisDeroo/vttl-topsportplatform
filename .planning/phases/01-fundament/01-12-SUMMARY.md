---
phase: 01-fundament
plan: 12
subsystem: gdpr-consent
tags:
  - phase-1
  - gdpr
  - consent
  - registration
  - minor
  - belgian-art-8
dependency_graph:
  requires:
    - 01-02 # users + consent_records + parent_child_links schema
    - 01-03 # medical schema for Wave-0 audit/delete tests
    - 01-04 # RLS policies (read_own + insert_own_or_minor)
    - 01-05 # Better Auth users.is_minor needs DOB column
    - 01-06 # sendEmailLocalized for auth-reset wave-0 wiring
    - 01-07 # public/locales/consent-*.html (9 files)
    - 01-10 # consentNotifyQueue (BullMQ) for _enqueueVersionBump
    - 01-11 # tRPC core + protectedProcedure + writeAudit + requireCurrentConsent
  provides:
    - 'src/lib/consent.ts — CURRENT_POLICY + getConsentText + recordConsent (D-06 SHA-256 snapshot)'
    - 'src/server/auth/activate.ts — canActivate(userId) Belgian Art. 8 minor-gate (GDPR-02)'
    - 'src/server/trpc/routers/consent.ts — consent.give / withdraw / status / listForUser / listMyParentLinks / _enqueueVersionBump'
    - 'src/components/consent/consent-step.tsx — per-category collapsible UI'
    - 'src/components/consent/re-consent-banner.tsx — D-07 full-screen blocking banner'
    - 'src/app/api/consent-text/route.ts — anonymous-readable consent HTML (whitelist on inputs)'
    - 'drizzle/0003_users_is_minor.sql — STORED generated column'
  affects:
    - 'src/server/trpc/routers/_app.ts — appRouter.consent attached'
    - 'src/server/db/schema/auth.ts — users.isMinor column'
tech_stack:
  added: []
  patterns:
    - 'Drizzle 0.45 generatedAlwaysAs (single-arg) — Postgres STORED enforced via migration SQL'
    - 'sha256(text) tamper-evidence over consent_text_snapshot (T-01-08)'
    - "exactOptionalPropertyTypes-safe `db` parameter via conditional spread (`...(ctxDb ? { db: ctxDb } : {})`)"
    - 'Drizzle handle without schema generic in freshDb helper → use `select().from(t)` not `db.query.t.findMany`'
key_files:
  created:
    - 'src/server/auth/activate.ts'
    - 'src/server/trpc/routers/consent.ts'
    - 'src/components/consent/consent-step.tsx'
    - 'src/components/consent/re-consent-banner.tsx'
    - 'src/components/auth/register-form.tsx'
    - 'src/app/api/consent-text/route.ts'
    - 'src/app/[locale]/(auth)/register/page.tsx'
    - 'src/app/[locale]/(auth)/consent/page.tsx'
    - 'drizzle/0003_users_is_minor.sql'
    - 'drizzle/0003_users_is_minor.rollback.md'
    - 'tests/integration/minor-flow.test.ts'
    - 'tests/integration/medical-audit.test.ts'
    - 'tests/integration/medical-delete.test.ts'
    - 'tests/integration/parent-child.test.ts'
    - 'tests/integration/trainer-academy.test.ts'
    - 'tests/integration/auth-reset.test.ts'
  modified:
    - 'src/lib/consent.ts'
    - 'src/server/db/schema/auth.ts'
    - 'src/server/trpc/routers/_app.ts'
    - 'tests/integration/consent.test.ts'
    - 'drizzle/meta/_journal.json'
decisions:
  - 'D-06 implementation: SHA-256(textShown) hex digest stored on every recordConsent insert; tamper-evidence verified by rehashing the snapshot at audit time (drilled in consent.test.ts test 2).'
  - "Drizzle 0.45 `generatedAlwaysAs` accepts only one argument; the `{ mode: 'stored' }` second arg from newer Drizzle is omitted in the schema — Postgres enforces STORED via the migration SQL (0003) which is the source of truth."
  - 'CURRENT_POLICY bumped from `1.0.0-draft` (Plan 11 stub) to `1.0.0` (Plan 12). The on-disk files in public/locales/ are already named `consent-*-1.0.0.{nl,en,fr}.html` so no rename needed; the `released_at: 2026-05-01` field added per RESEARCH §Policy version registry.'
  - "ReConsentBanner posts to `/api/trpc/consent.give?batch=1` via raw fetch instead of importing the (not-yet-existing) `@/lib/trpc-client` from Plan 15. Phase 1 ships a functional banner without the typed client; Plan 15 will swap in `trpc.consent.give.useMutation()` when it lands."
  - 'For a minor with parent consent, `canActivate` does NOT additionally require a self-consent row from the minor — Belgian Art. 8 forbids them from providing it before age 16. The parent-consent row IS the activation consent.'
  - 'auth-reset.test.ts asserts the locale-routing contract directly via `sendEmailLocalized` instead of driving Better Auth `auth.api.requestPasswordReset` — the e2e test (`tests/e2e/auth.spec.ts`) already covers the HTTP path. The integration assertion locks the recipient-locale → subject-literal mapping.'
auto_decisions:
  - 'AUTO-APPROVED: Task 4 checkpoint:human-verify — auto-mode on (workflow.auto_advance). All 8 e2e walkthrough steps remain documented in the plan file for manual replay; nothing to verify in CI today since the dev server smoke is a Plan 15 dependency.'
metrics:
  duration_minutes: 14
  completed_date: 2026-05-02
  tasks_completed: 4
  files_created: 16
  files_modified: 5
threat_refs: [T-01-08, T-01-09]
---

# Phase 1 Plan 12: Consent flow + Belgian minor-consent gate Summary

GDPR-01/02/I18N-09 primitives implemented: SHA-256-stamped consent ledger across nl/en/fr, Belgian Art. 8 minor-gate (`canActivate`) with one-consenting-parent enforcement, full consent.* tRPC router, multi-step register skeleton, D-07 ReConsentBanner — Phase 1 succescriteria #5 + #6 are technically true.

## Tasks

### Task 1 — `lib/consent.ts` + `activate.ts` + Migration 0003 + tests

**Commit:** `40af555`

Replaced the Plan 11 RED throw-stubs in `src/lib/consent.ts` with the real implementation:

- **`CURRENT_POLICY`** — three categories (`operational`, `medical_processing`, `photo_video`) at version `1.0.0`, each with a `released_at` date so the D-07 re-consent banner can compare staleness against the user's last consent timestamp.
- **`getConsentText(category, version, locale)`** — reads `public/locales/consent-{category}-{version}.{locale}.html` from disk and returns the raw HTML. Deterministic.
- **`recordConsent({...})`** — INSERTs a `consent_records` row with `consent_text_snapshot` (the bytes the user saw) + `consent_text_sha256` (64 lowercase hex chars). Accepts an optional `db` argument so a tRPC `ctx.db` (RLS-bound transaction) honors `consent_records.insert_own_or_minor` (Plan 04).

Created `src/server/auth/activate.ts` with the four-state `canActivate(userId)` predicate. Decision tree:

| Outcome                                      | Reason                  |
| -------------------------------------------- | ----------------------- |
| user row missing                             | `not_found`             |
| minor (`is_minor === true`) + no parent link | `parent_link_missing`   |
| minor + link but no parent consent row       | `parent_consent_missing`|
| adult / NULL DOB + no own consent            | `consent_missing`       |
| all checks pass                              | `ok`                    |

Migration 0003 (`drizzle/0003_users_is_minor.sql` + `.rollback.md`) adds the `users.is_minor` STORED generated column (`CASE WHEN dob IS NULL THEN NULL WHEN (CURRENT_DATE - dob) < INTERVAL '16 years' THEN TRUE ELSE FALSE END`). Drizzle schema (`src/server/db/schema/auth.ts`) declares `isMinor: boolean('is_minor').generatedAlwaysAs(...)` (Drizzle 0.45 single-arg form).

`tests/integration/consent.test.ts` — replaced with the GREEN matrix:
- per-locale snapshot (nl/en/fr) asserts `consent_text_snapshot === text`, `consent_text_sha256 ~= /^[a-f0-9]{64}$/`, `policy_version === '1.0.0'`, `locale === locale`.
- tamper-evidence drill recomputes `sha256(snapshot)` and compares to the stored hash.

`tests/integration/minor-flow.test.ts` — new GREEN file with five assertions across the canActivate decision tree.

### Task 2 — consent.* tRPC router + UI components + register/consent pages

**Commit:** `302cb76`

`src/server/trpc/routers/consent.ts` exposes six endpoints:

| Endpoint              | Purpose                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `give`                | INSERT consent_records via recordConsent + writeAudit (resourceType=consent_record)      |
| `withdraw`            | UPDATE withdrawn_at on caller-owned row + writeAudit; replays return NOT_FOUND           |
| `status`              | Returns `{ hasConsent, row }` for caller's own active consent at CURRENT_POLICY[category]|
| `listForUser`         | Newest-first consent history; visibility RLS-enforced (user / consenting party / TD)     |
| `listMyParentLinks`   | CRIT-3 own-link visibility for parent/player roles via OR predicate                      |
| `_enqueueVersionBump` | Pushes onto consentNotifyQueue (D-15 Plan 10 BullMQ); future TD-only call site (Plan 15) |

`src/server/trpc/routers/_app.ts` attaches `consent: consentRouter` so the catch-all `/api/trpc/consent.*` route is live.

`src/app/api/consent-text/route.ts` — anonymous-readable HTML endpoint with input whitelist (3 categories, 3 locales, semver-shaped version). 400 on bad input, 404 on missing file, `Content-Type: text/html; charset=utf-8` on success.

UI primitives:

- **`src/components/consent/consent-step.tsx`** — client component, fetches text from `/api/consent-text` on mount, renders inside a scrollable `<article dangerouslySetInnerHTML>`. Accept button passes the EXACT fetched bytes back via `onAccept(textShown)` so the SHA-256 stored downstream matches what the user saw.
- **`src/components/consent/re-consent-banner.tsx`** — `fixed inset-0 z-50` blocking dialog (`role="dialog" aria-modal`). Posts `consent.give` via raw fetch (Plan 15 will swap for typed client). Wired to the operational category at `CURRENT_POLICY.operational.version`.
- **`src/app/[locale]/(auth)/register/page.tsx`** — multi-locale register shell with `auth.register.minorWarning` copy.
- **`src/app/[locale]/(auth)/consent/page.tsx`** — locale-prefixed landing chrome for the post-verification consent step.
- **`src/components/auth/register-form.tsx`** — credentials/consents/pending step state machine skeleton; Plan 15 fills the consents step with three `<ConsentStep>` instances.

### Task 3 — Wave-0 RED test wiring (5 files)

**Commit:** `c00afd3`

Five new integration tests (Plan 17 was meant to scaffold them as RED; that hadn't landed yet so this plan creates them outright with GREEN bodies):

| Test                            | Verifies                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `medical-audit.test.ts`         | Migration 0001 SECURITY DEFINER trigger writes one medical_access_audit row with action='write', subject=player.id, actor=app.user_id GUC (CRIT-7, GDPR-04) |
| `medical-delete.test.ts`        | DELETE on medical_events cascades to medical_documents; bystander player's rows + all users untouched (GDPR-07 cascade rules) |
| `parent-child.test.ts`          | parent + consent → canActivate(minor)=ok; HIGH-5 UNIQUE child_user_id rejects second parent; parent_link without parent_consent → parent_consent_missing |
| `trainer-academy.test.ts`       | trainer linked to two academies = two academy_memberships rows (composite PK); FK rejects unknown academy_code |
| `auth-reset.test.ts`            | sendEmailLocalized password-reset routes to recipient's locale; `vi.mock('resend')` asserts subject literal nl/en/fr; X-Entity-Ref-ID header (AUTH-02 + I18N-04) |

`admin-user.test.ts` is owned by Plan 15 (MAJOR-12 scope rule) and intentionally NOT created here.

### Task 4 — e2e walkthrough checkpoint

**Auto-approved** under `workflow.auto_advance=true` (auto-mode active). The 8-step e2e walkthrough remains documented in the plan file for manual replay against staging once Plan 15 ships the typed register flow. No CI smoke today because the e2e dev-server harness depends on Plan 15.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Drizzle 0.45 `generatedAlwaysAs` is single-arg**
- **Found during:** Task 1 typecheck
- **Issue:** Plan example used `generatedAlwaysAs(sql..., { mode: 'stored' })` which is a newer Drizzle API. 0.45 (the project's lock) only accepts `(as: SQL)`.
- **Fix:** Removed the second arg in `src/server/db/schema/auth.ts`. Postgres only supports STORED generated columns anyway, and the `STORED` keyword is emitted explicitly in the migration SQL (`drizzle/0003_users_is_minor.sql`) which is the source of truth. Documented the workaround in the column block-comment.
- **Files modified:** `src/server/db/schema/auth.ts`
- **Commit:** `40af555`

**2. [Rule 1 — Bug] `exactOptionalPropertyTypes: true` rejects `db: undefined`**
- **Found during:** Task 2 typecheck
- **Issue:** Passing `db: ctx.db as DbClient | undefined` to `recordConsent` violates `exactOptionalPropertyTypes` (the field is optional, so `undefined` cannot be passed explicitly).
- **Fix:** Conditional spread: `...(ctxDb ? { db: ctxDb } : {})`. Same pattern fits other optional-handle sites in the codebase.
- **Files modified:** `src/server/trpc/routers/consent.ts`
- **Commit:** `302cb76`

**3. [Rule 3 — Blocking] `freshDb()` drizzle handle has no schema generic**
- **Found during:** Task 3 typecheck of medical-audit / medical-delete / trainer-academy tests
- **Issue:** `tests/helpers/db.ts:7` does `drizzle(sql)` (no schema), so `db.query.tableName.findMany(...)` is unavailable; only the lower-level builder (`select().from(table).where(...)`) works. The plan's example used `db.query.X.findMany`.
- **Fix:** Switched test bodies to `h.db.select().from(table).where(eq(...))`. Behaviour identical; types are correct without modifying the shared helper.
- **Files modified:** `tests/integration/medical-audit.test.ts`, `tests/integration/medical-delete.test.ts`, `tests/integration/trainer-academy.test.ts`
- **Commit:** `c00afd3`

### Plan 15 dependency notes (intentional, not deviations)

- `<ReConsentBanner>` was specified to import `@/lib/trpc-client` (a Plan 15 module). That module does not exist yet; the banner uses raw fetch against `/api/trpc/consent.give?batch=1` instead. Same on-the-wire behaviour. Plan 15 will swap in the typed client.
- `<RegisterForm>` step 2 (consents) is a stub that advances to "pending" without rendering three `<ConsentStep>` instances. Plan 15 wires the consents step against the typed tRPC client; the primitive component (`<ConsentStep>`) is fully functional today and reachable via `<ReConsentBanner>` for re-consent.

## Threat Surface (per plan threat_refs)

| Flag        | Component                          | Mitigation in this plan                                                  |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------ |
| T-01-08 (T) | Consent record forgery             | sha256(consent_text_snapshot) stored at INSERT time; tamper-evidence drill in test 2 |
| T-01-09 (E) | Minor activation without parent    | canActivate() with hard `parent_consent_missing` failure; tested in minor-flow + parent-child tests |

No new threat surface introduced.

## Self-Check: PASSED

All claimed files exist and all claimed commits are in `git log`:

- `src/lib/consent.ts` — modified ✓
- `src/server/auth/activate.ts` — created ✓
- `src/server/trpc/routers/consent.ts` — created ✓
- `src/server/trpc/routers/_app.ts` — modified ✓ (consent attached)
- `src/app/api/consent-text/route.ts` — created ✓
- `src/components/consent/consent-step.tsx` — created ✓
- `src/components/consent/re-consent-banner.tsx` — created ✓
- `src/components/auth/register-form.tsx` — created ✓
- `src/app/[locale]/(auth)/register/page.tsx` — created ✓
- `src/app/[locale]/(auth)/consent/page.tsx` — created ✓
- `src/server/db/schema/auth.ts` — modified ✓ (isMinor column)
- `drizzle/0003_users_is_minor.sql` — created ✓
- `drizzle/0003_users_is_minor.rollback.md` — created ✓
- `drizzle/meta/_journal.json` — modified ✓ (entry idx 3)
- `tests/integration/consent.test.ts` — modified ✓ (GREEN bodies)
- `tests/integration/minor-flow.test.ts` — created ✓
- `tests/integration/medical-audit.test.ts` — created ✓
- `tests/integration/medical-delete.test.ts` — created ✓
- `tests/integration/parent-child.test.ts` — created ✓
- `tests/integration/trainer-academy.test.ts` — created ✓
- `tests/integration/auth-reset.test.ts` — created ✓
- Commit `40af555` (Task 1) in git log ✓
- Commit `302cb76` (Task 2) in git log ✓
- Commit `c00afd3` (Task 3) in git log ✓

`npx tsc --noEmit` exits 0.
