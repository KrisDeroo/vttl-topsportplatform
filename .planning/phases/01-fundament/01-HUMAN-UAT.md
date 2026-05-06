---
status: partial
phase: 01-fundament
source: [01-VERIFICATION.md]
started: 2026-05-03T11:00:00.000Z
updated: 2026-05-03T11:00:00.000Z
---

# Phase 1: Fundament — Human UAT Items

The verifier auto-verified 9/11 must-haves against the codebase and identified 2 governance gaps (now closed). The 6 items below require a live runtime, real credentials, or qualified human review and are deferred to UAT. Each maps directly to a Phase 1 success criterion.

## Open items

### 1. Boot the application against Supabase staging — succescriterium #1

- **Test:** `npm run dev` against the staging Supabase pooler URL + Upstash Redis credentials. Visit `http://localhost:3000/nl`, `/en`, `/fr`.
- **Expected:** Pages render. `/api/health/live` returns 200. `/api/health/ready` returns 200 with `components: [{component:'postgres',status:'ok'},{component:'redis',status:'ok'}]`.
- **Why human:** Requires real network endpoints + a Node runtime + valid Supabase + Upstash credentials.
- **Owner:** Platform engineer with staging access.

### 2. Direct Postgres query as `app_user` returns zero rows on `medical_events` — succescriterium #3

- **Test:** Run `npx vitest run tests/rls/medical-isolation.test.ts` against CI (Docker-in-Docker) **OR** against staging:
  ```bash
  psql "postgresql://app_user:..." \
    -c "SET LOCAL app.user_id='<random uuid>'; \
        SET LOCAL app.user_role='trainer'; \
        SELECT COUNT(*) FROM medical_events;"
  ```
- **Expected:** 0 rows. Trainer role is excluded from `medical_events_read` USING per MED-04.
- **Why human:** Needs a live Postgres with migrations applied + `app_user` role provisioned with the runtime password from `PGOPTIONS`.
- **Owner:** Platform engineer with CI/staging access.

### 3. End-to-end registration → consent → minor-flow → activation — succescriteria #4, #5, #6

- **Test:** Browser session OR `playwright test --grep="@phase1"` against running Next.js + Postgres + Redis + Resend dev environment.
- **Expected:**
  - Register with `dateOfBirth: '2015-01-01'` (under 16): cannot activate without parent consent (`admin.user.activate` throws `parent_link_missing` then `parent_consent_missing`).
  - Register with adult DOB in en/fr: confirmation email subject literal matches the locale (Resend sandbox or live capture).
  - After `consent.give`: `consent_records` row holds the snapshot HTML + sha256 + version + locale.
- **Why human:** Requires running app + DB + Redis + Resend (mocked or sandboxed). Code-level wiring is verified in 01-VERIFICATION.md.
- **Owner:** QA / platform engineer.

### 4. CI pipeline goes green on a fresh PR — succescriterium #2

- **Test:** Open a no-op PR. Watch GitHub Actions.
- **Expected:** All four jobs pass — `lint-typecheck`, `unit-integration`, `rbac-matrix-gate`, `e2e`.
- **Why human:** Requires GitHub Actions runner. Verifier cannot reach GH from sandbox. ESLint flat-config gap (Verifier Gap §1) was closed in commit `029a4b0`; this UAT confirms the fix lands green.
- **Owner:** Whoever opens the first feature PR after Phase 1.

### 5. Locale switcher visual + functional smoke — succescriterium #4

- **Test:** Open running app. Click the Globe icon. Pick EN, then FR, then back to NL.
- **Expected:** URL flips between `/en`, `/fr`, `/` without full reload (D-03). Cookie `locale` persists across page loads. When authenticated, `users.preferred_locale` updates in DB.
- **Why human:** Visual / UX behaviour cannot be verified without rendering.
- **Owner:** QA on the dev environment.

### 6. Belgian-jurisdiction legal review of consent text — RISK-I18N-LEGAL (release-gate Phase 8)

- **Test:** Read `public/locales/consent-{operational,medical_processing,photo_video}-1.0.0.{nl,en,fr}.html` (9 files) with a Belgian-jurisdiction lawyer.
- **Expected:** Wording is GDPR Art. 6/7/8 compliant in all three languages. Minor passages cover Belgian Art. 8 (parental consent for under-16). Bump `CURRENT_POLICY` versions if any wording changes.
- **Why human:** Legal review by qualified counsel. Officially gated to Phase 8 release-gate per ROADMAP.
- **Owner:** Legal / external counsel.

## Closure rule

This file's `status: partial` flips to `complete` only when all 6 items are signed off. Items can be checked off individually by editing this file and adding a `signed_off_at` line under each item. The frontmatter `updated` timestamp must be bumped on every edit.

The two governance gaps (Verifier Gap §1 — ESLint flat-config; Verifier Gap §2 — canonical rollback section markers) have been **closed** by code commits `029a4b0` and prior. They are not items in this UAT.
