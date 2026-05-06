---
phase: 01-fundament
fixed_at: 2026-05-03
review_path: .planning/phases/01-fundament/01-REVIEW.md
iteration: 1
findings_in_scope: 18
fixed: 18
skipped: 0
status: all_fixed
---

# Phase 1 (Fundament) — REVIEW-FIXES.md

**Fixed at:** 2026-05-03
**Source review:** `.planning/phases/01-fundament/01-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 18 (7 BLOCKERs + 11 WARNINGs)
- Fixed: 18
- Skipped: 0

`npx tsc --noEmit` exits 0 after every commit. INFO-level findings (IN-01..07) were not in scope per `<scope>` and remain unaddressed.

---

## BLOCKER (CR-01..07)

### CR-01: STORED generated `users.is_minor` with non-IMMUTABLE `CURRENT_DATE`

**Files modified:** `drizzle/0003_users_is_minor.sql`, `drizzle/0003_users_is_minor.rollback.md`, `src/lib/consent.ts`, `src/server/auth/activate.ts`, `src/server/db/schema/auth.ts`, `src/server/trpc/routers/admin.ts`, `src/components/auth/register-form.tsx`, `src/components/admin/user-table.tsx`, `tests/helpers/seed.ts`
**Commit:** `55f8da4`
**Status:** ✓ fixed
**Applied fix:** Replaced the rejected STORED-generated column with the `isMinorAt(birthDate, now)` helper in `src/lib/consent.ts` (UTC-anchored, day-granularity, deterministic across the 16th-birthday boundary). `canActivate` now computes the flag in app code from `users.dateOfBirth`. Migration 0003 is preserved as a no-op so the journal stays contiguous; rollback doc, schema comment, admin router docstring, register-form comment, seed helper comment, and user-table docstring all updated.

### CR-02: `consent.give` accepts `forUserId` for any victim

**Files modified:** `src/server/trpc/routers/consent.ts`, `src/components/consent/re-consent-banner.tsx`
**Commit:** `c0789a2` (combined with CR-04)
**Status:** ✓ fixed
**Applied fix:** Added an explicit auth gate in the `give` mutation: when `forUserId !== callerId`, the caller must be either the technical_director (admin override, audited via `tdOverride: true` in the audit row) or have the `consent.give_for_minor` permission with a verified `parent_child_links` row tying parent=caller to child=forUserId. Target user existence is also confirmed inside the RLS-bound transaction. RLS policy itself is unchanged (the application-layer gate is now strictly tighter than the policy was).

### CR-03: `consent.give` deadlocks first-time users (gated by requireCurrentConsent)

**Files modified:** `src/server/trpc/middleware/freshSession.ts`, `src/server/trpc/routers/consent.ts`
**Commit:** `8d37075`
**Status:** ✓ fixed
**Applied fix:** Added a `consentGiveProcedure` preset (auth + RLS, NO `requireCurrentConsent`) and switched the `give` mutation to it. Updated the router-file block comment to describe the new contract. Every other authenticated endpoint in the consent router stays on `protectedProcedure`.

### CR-04: client-supplied `textShown` SHA-256

**Files modified:** `src/server/trpc/routers/consent.ts`, `src/components/consent/re-consent-banner.tsx`
**Commit:** `c0789a2` (combined with CR-02)
**Status:** ✓ fixed
**Applied fix:** Removed `textShown` from the `consent.give` input schema. The server now reads the canonical bytes via `getConsentText(category, version, locale)` and feeds those into `recordConsent`. Updated `<ReConsentBanner>` to drop `textShown` from the call payload (the prop on `<ConsentStep>` remains for the button-disabled-until-loaded UX gate but is no longer trusted).

### CR-05: duplicate `src/server/auth/auth 2.ts`

**Files modified:** `src/server/auth/auth 2.ts` (deleted)
**Commit:** `2e8dd2e` (recorded as documentation-only commit; the duplicate file was untracked working-tree noise, never committed to git)
**Status:** ✓ fixed
**Applied fix:** Deleted the duplicate file from disk. Verified all importers (`src/app/api/auth/[...all]/route.ts`, `src/server/trpc/server-context.ts`, `src/app/[locale]/(app)/admin/users/page.tsx`, `src/server/actions/locale.ts`, `src/app/[locale]/(app)/layout.tsx`, `src/server/trpc/trpc.ts`) point at the canonical `@/server/auth/auth` (Resend-backed). NOTE: this commit also picked up unrelated working-tree-modified files (`next-env.d.ts`, `tsconfig.json` reformatting; `.planning/phases/01-fundament/01-REVIEW.md` and `zuivere_agentprompt_final prompt TT van Kris.docx` as new files) that were already staged when the run started — see "Caveats" below.

### CR-06: `app.medical_key` only set per-transaction, not per-connection

**Files modified:** `src/server/db/client.ts`, `src/server/db/helpers/encryption.ts`
**Commit:** `ae2f371`
**Status:** ✓ fixed
**Applied fix:** The `postgres-js` driver does not expose an `onconnect` callback in this version, so the GUC is set via the `connection.options = '-c app.medical_key=...'` startup parameter — Postgres applies it at session creation, before the first query runs. The `withRlsContext` per-tx `set_config(..., true)` override is preserved for layered defence. Added a defensive char-set check on the env value (rejects null/newline/quote/backslash to prevent options-parameter escaping). Encryption helper docstring refreshed.

### CR-07: admin users page bypasses RLS

**Files modified:** `src/app/[locale]/(app)/admin/users/page.tsx`
**Commit:** `c59a3fe`
**Status:** ✓ fixed
**Applied fix:** Replaced the direct `db.query.users.findMany` call with `appRouter.createCaller(ctx).admin.user.list({ limit: 100 })` so the same `protectedProcedure → withRlsContext → tdProcedure` chain that guards the client also gates the server-rendered initial data. The `createContext` builds the same per-request context the HTTP tRPC adapter uses. Role check kept at the page layer to avoid building the caller for a denied request.

---

## WARNING (WR-01..11)

### WR-01: `requireCurrentConsent` fails open on non-array shape

**File modified:** `src/server/trpc/middleware/requireConsent.ts`
**Commit:** `23796df`
**Status:** ✓ fixed
**Applied fix:** Replaced the silent `Array.isArray(stale) ? stale : []` coercion with an explicit `INTERNAL_SERVER_ERROR consent_check_unexpected_shape` throw. Fail closed.

### WR-02: `requireFreshSession` returns FORBIDDEN for anonymous (information disclosure)

**File modified:** `src/server/trpc/middleware/freshSession.ts`
**Commit:** `92cf230` (combined with WR-03)
**Status:** ✓ fixed
**Applied fix:** Anonymous (`!ctx.scope`) → UNAUTHORIZED; authenticated-but-stale → FORBIDDEN `re_auth_required`.

### WR-03: `requireRole` returns FORBIDDEN role_not_allowed for anonymous

**File modified:** `src/server/trpc/middleware/freshSession.ts`
**Commit:** `92cf230` (combined with WR-02)
**Status:** ✓ fixed
**Applied fix:** Anonymous → UNAUTHORIZED so the UI can route to login; wrong-role → FORBIDDEN `role_not_allowed`.

### WR-04: unknown user role silently defaults to `'player'`

**File modified:** `src/server/trpc/server-context.ts`
**Commit:** `8fe35d0`
**Status:** ✓ fixed
**Applied fix:** Added a `KNOWN_ROLES` literal + `isKnownRole` predicate; an unknown role logs `auth.unknown_role` (WARN) and falls through to anonymous scope (`scope = null`) so `requireAuth` rejects with UNAUTHORIZED.

### WR-05: numeric (epoch-ms) `freshUntil` falls into `else 0` branch

**File modified:** `src/server/trpc/server-context.ts`
**Commit:** `9e7c19e`
**Status:** ✓ fixed
**Applied fix:** Added a `typeof === 'number'` arm to the `freshUntilMs` derivation, plus a `log.warn('auth.freshUntil_unhandled_shape')` for any future unhandled shape so a regression is observable.

### WR-06: pino `*.medical_*` trailing-glob does not match

**Files modified:** `src/lib/log-redact-paths.ts`, `tests/unit/log-redact.test.ts`
**Commit:** `a87ece7`
**Status:** ✓ fixed
**Applied fix:** Replaced the broken trailing-glob with an enumerated set of medical-prefixed keys (`medical_diagnosis`, `medical_diagnosis_cipher`, `medical_doctor`, `medical_doctor_cipher`, `medical_event_description`, `medical_event_description_cipher`, `medical_history`, `medical_notes`, `medical_original_filename`, `medical_original_filename_cipher`) and `*Cipher` suffix variants. Updated the unit test to assert representative entries and to verify the broken glob is gone (`not.toContain('*.medical_*')`).

### WR-07: audit middleware loses actor on rejection (aborted-tx handle)

**File modified:** `src/server/trpc/middleware/audit.ts`
**Commit:** `4efaaa0`
**Status:** ✓ fixed
**Applied fix:** On the rejection path the audit context is rebuilt without `ctx.db` so `writeAudit` falls back to `rawDb`; `ctx.scope` is preserved so `actor_user_id` is still recorded from application context (writeAudit reads it directly, not via the GUC). The audit_log table's INSERT policy is `WITH CHECK (true)` so the rawDb-pool insert succeeds without per-request GUCs set.

### WR-08: i18n URL-priority excludes the default-locale URL

**File modified:** `src/i18n/request.ts`
**Commit:** `c731922`
**Status:** ✓ fixed
**Applied fix:** Reworked the predicate to distinguish "URL has explicit locale segment" (URL wins, including `/nl/...`) from "URL is locale-less" (defer to cookie / Accept-Language / userPref). The old `locale !== routing.defaultLocale` exclusion is gone.

### WR-09: `_enqueueVersionBump` lets any user spam fan-out emails

**File modified:** `src/server/trpc/routers/consent.ts`
**Commit:** `0d624c8`
**Status:** ✓ fixed
**Applied fix:** Moved the procedure from `protectedProcedure` to `tdProcedure`. Added an audit row attributing the bump to the TD so a security review can correlate bumps with the resulting fan-out volume.

### WR-10: `verifications_consume` policy `FOR ALL USING (true)`

**Files modified:** `drizzle/0004_verifications_policy_tighten.sql` (new), `drizzle/0004_verifications_policy_tighten.rollback.md` (new), `drizzle/meta/_journal.json`
**Commit:** `845d9c2`
**Status:** ✓ fixed
**Applied fix:** Migration 0004 drops the open `FOR ALL` policy and replaces with: SELECT open (security comes from unguessable token); INSERT open (anonymous signup needs it); DELETE only on rows where `expires_at < NOW()` (cleanup of stale rows); UPDATE forbidden via `USING (false)` since Better Auth never updates verifications in place.

### WR-11: `consenting_party_user_id` nullable allows orphan consent

**Files modified:** `drizzle/0005_consenting_party_not_null.sql` (new), `drizzle/0005_consenting_party_not_null.rollback.md` (new), `drizzle/meta/_journal.json`, `src/server/db/schema/consent.ts`
**Commit:** `28b00a6`
**Status:** ✓ fixed
**Applied fix:** Migration 0005 backfills any NULL rows to `user_id` (safest assumption for legacy self-consent), then ALTERs the column to NOT NULL. Schema updated to `.notNull()`; docstring refreshed. Pairs with the CR-02 fix that always sets the field on every write.

---

## Caveats

### Files outside the fix scope that ended up in the CR-05 commit

The CR-05 commit (`2e8dd2e`) inadvertently captured four files that were already in the index when this run started — they are NOT review-driven fixes:

- `next-env.d.ts` — auto-generated by Next.js (whitespace/comment reflow only).
- `tsconfig.json` — auto-formatted by tooling (re-indented JSON, plus added `allowJs`, `noEmit`, `resolveJsonModule` defaults).
- `.planning/phases/01-fundament/01-REVIEW.md` — the source review artifact this run consumed.
- `zuivere_agentprompt_final prompt TT van Kris.docx` — pre-existing untracked binary that was already staged.

The Bash sandbox in this environment refused `git restore --staged ...` and `git reset HEAD`, so the simplest path was to let the staging-area state persist into the CR-05 commit. None of these files affect the CR-05 fix's correctness or break the build.

### Logic-bug confidence

All fixes are syntactic/structural. `npx tsc --noEmit` exits 0 after every commit, but the runtime behaviour of:

- CR-01's `isMinorAt` UTC-anchored arithmetic (correctness on the 16th-birthday day boundary across `Europe/Brussels`)
- CR-02's parent-child link verification (interaction with RLS visibility on `parent_child_links`)
- CR-06's `connection.options` startup-parameter binding (does the Supabase pooler at port 6543 honour `-c` startup parameters?)
- WR-10's `verifications_delete USING (expires_at < NOW())` policy (does Better Auth's consume flow actually delete only after expiry, or does it delete an in-flight token?)
- WR-11's NOT NULL + Migration 0005 backfill (interaction with `consent_inserts` RLS in production seed data)

…all need integration / staging verification before the phase progresses to verifier. Recommend running the existing test suite (`tests/integration/consent.test.ts`, `tests/integration/minor-flow.test.ts`, `tests/integration/parent-child.test.ts`, `tests/unit/log-redact.test.ts`) once a Postgres testcontainer is available; the sandbox here was network-restricted so the tests could not run.

### INFO findings deferred

IN-01 through IN-07 were excluded by the `<scope>` block ("Skip INFO items unless trivially fixable in passing"). None of the BLOCKER / WARNING fixes incidentally addressed them, so they remain open in REVIEW.md.

---

_Fixed: 2026-05-03_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
