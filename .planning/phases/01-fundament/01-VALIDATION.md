---
phase: 1
slug: fundament
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth: `01-RESEARCH.md` §Validation Architecture (lines 2270–2330).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (unit + integration); Playwright 1.59 (e2e) |
| **Config file** | `vitest.config.ts`; `playwright.config.ts` — Wave 0 creates these |
| **Quick run command** | `npx vitest run --changed` |
| **Full suite command** | `npx vitest run && npx playwright test` |
| **Estimated runtime** | quick ~30s / full ~5–8min on CX31 |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --changed`
- **After every plan wave:** Run `npx vitest run && npx playwright test --grep="@phase1"`
- **Before `/gsd-verify-work`:** Full suite green; **35-test rol×resource matrix (D-11) MUST be 100% green**; RLS-direct medical-isolation test MUST be green
- **Max feedback latency:** 30 seconds (quick run)

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Login persists across browser restart | e2e | `npx playwright test tests/e2e/auth.spec.ts -g "session persists"` | ❌ W0 |
| AUTH-02 | Password reset via email link | integration + e2e | `npx vitest run tests/integration/auth-reset.test.ts` | ❌ W0 |
| AUTH-03 | Session has CallerContext | integration | `npx vitest run tests/integration/caller-context.test.ts` | ❌ W0 |
| AUTH-04 | TD CRUDs accounts | integration | `npx vitest run tests/integration/admin-user.test.ts` | ❌ W0 |
| AUTH-05 | TD assigns roles | integration | `npx vitest run tests/integration/admin-user.test.ts -t "assignRole"` | ❌ W0 |
| USER-01 | Parent-child link enforced in queries | integration | `npx vitest run tests/integration/parent-child.test.ts` | ❌ W0 |
| USER-02 | Trainer-academy link scoping | integration | `npx vitest run tests/integration/trainer-academy.test.ts` | ❌ W0 |
| USER-03 | Sparring partner-session link | integration | (deferred to Phase 5; schema check in Phase 1) | ❌ W0 |
| USER-04 | Per-role scope enforcement (matrix) | integration | `npx vitest run tests/integration/rbac-matrix.test.ts` | ❌ W0 — **D-11 35 tests** |
| USER-05 | RLS at DB layer (direct query) | integration (raw SQL) | `npx vitest run tests/rls/direct-query.test.ts` | ❌ W0 |
| GDPR-01 | Consent recorded with version + snapshot | integration | `npx vitest run tests/integration/consent.test.ts` | ❌ W0 |
| GDPR-02 | Minor cannot activate without parent consent | integration | `npx vitest run tests/integration/minor-flow.test.ts` | ❌ W0 |
| GDPR-03 | Medical isolated from player query | integration (raw SQL) | `npx vitest run tests/rls/medical-isolation.test.ts` | ❌ W0 |
| GDPR-04 | Medical read writes audit row | integration | `npx vitest run tests/integration/medical-audit.test.ts` | ❌ W0 (schema test only in P1; full enforcement in P5) |
| GDPR-07 | Medical delete path independent | integration | `npx vitest run tests/integration/medical-delete.test.ts` | ❌ W0 |
| GDPR-08 | All datetime UTC | unit | `npx vitest run tests/unit/timestamps.test.ts` | ❌ W0 |
| SEC-01 | Cookies httpOnly+Secure+SameSite=Lax | e2e (response inspect) | `npx playwright test tests/e2e/auth.spec.ts -g "cookie flags"` | ❌ W0 |
| SEC-02 | CSRF on state-changing mutations | integration | `npx vitest run tests/integration/csrf.test.ts` | ❌ W0 |
| SEC-03 | Re-auth required for sensitive | integration | `npx vitest run tests/integration/fresh-session.test.ts` | ❌ W0 |
| SEC-04 | Auth tokens never logged | unit | `npx vitest run tests/unit/log-redact.test.ts` | ❌ W0 |
| SEC-05 | Reset 1h, magic 15min, single-use | unit | `npx vitest run tests/unit/auth-config.test.ts` | ❌ W0 |
| SEC-06 | 5 failed/15min lockout | integration | `npx vitest run tests/integration/lockout.test.ts` | ❌ W0 |
| SEC-07/08/09 | Rate limit enforced (chaos) | integration | `npx vitest run tests/integration/ratelimit.test.ts` | ❌ W0 |
| OPS-01 | pino redacts sensitive paths | unit | `npx vitest run tests/unit/log-redact.test.ts` | ❌ W0 |
| OPS-04 | Drizzle interceptor emits timing | unit | `npx vitest run tests/unit/db-timing.test.ts` | ❌ W0 |
| OPS-05 | Slow-query log threshold 500ms | smoke | manual via `psql` | manual |
| OPS-06 | Health endpoint reachable | e2e | `npx playwright test tests/e2e/health.spec.ts` | ❌ W0 |
| MIG-01 | Drizzle migration files versioned | unit | `npx vitest run tests/unit/migration-format.test.ts` | ❌ W0 |
| MIG-03 | Backfill batched (1000 rows + 100ms) | unit | `npx vitest run tests/unit/backfill.test.ts` | ❌ W0 |
| MIG-05 | Rollback procedure documented | doc check | `grep "rollback" .planning/phases/01-fundament/*.md` | manual |
| I18N-01 | Locale switcher persists pref | e2e | `npx playwright test tests/e2e/locale-switcher.spec.ts` | ❌ W0 |
| I18N-02 | users.preferred_locale enum + NOT NULL | unit | `npx vitest run tests/unit/schema-locale.test.ts` | ❌ W0 |
| I18N-03 | Resolution chain (cookie → header → nl) | integration | `npx vitest run tests/integration/locale-resolve.test.ts` | ❌ W0 |
| I18N-04 | Verify-email per locale | integration | `npx vitest run tests/integration/email-locale.test.ts` | ❌ W0 |
| I18N-05 | Lookup codes neutral, labels in catalogs | unit | `npx vitest run tests/unit/lookup-codes.test.ts` | ❌ W0 |
| I18N-07 | Date/number format per locale | unit | `npx vitest run tests/unit/intl-format.test.ts` | ❌ W0 |
| I18N-09 | Consent stores text snapshot per locale | integration | `npx vitest run tests/integration/consent.test.ts -t "snapshot per locale"` | ❌ W0 |
| I18N-11 | Backend logs/source English | doc check | `grep -E "(message|label|tekst)" src/**/*.ts` should not match Dutch | manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` + `tests/setup.ts` — testcontainers Postgres bootstrap with migrations applied; ephemeral per-test DB
- [ ] `playwright.config.ts` — three projects (chromium, firefox, webkit); default locale `nl-BE`
- [ ] `tests/integration/rbac-matrix.test.ts` — **7 rollen × 5 resources = 35 tests minimum (D-11)**
  - Roles: `technical_director`, `academy_manager`, `trainer`, `player`, `parent`, `sparring_partner`, `medical_staff`
  - Resources: `users`, `consent_records`, `medical_events`, `audit_log`, `parent_child_links`
  - Each cell: `allowed | denied | not_applicable` with explicit 200/403 expectation
- [ ] `tests/rls/direct-query.test.ts` — uses raw `pg` (NOT Drizzle) connecting as `app_user` role with `SET LOCAL app.user_id` / `SET LOCAL app.user_role` to prove `SELECT * FROM medical_events` returns 0 rows for non-owner
- [ ] `tests/integration/email-locale.test.ts` — mocks Mailgun fetch; asserts `subject` + body match user's `preferred_locale`
- [ ] `tests/e2e/register-with-consent.spec.ts` — full flow: register → verify email → consent (3 categories: operational/medical/photo-video) → login redirect
- [ ] `tests/integration/ratelimit.test.ts` — chaos: 110 requests in 60s → exactly 11 should be 429 with `Retry-After`
- [ ] `tests/integration/consent.test.ts` — version-bump scenario, snapshot stored, re-consent banner triggers
- [ ] `tests/integration/locale-resolve.test.ts` — covers all 4 chain steps: explicit pref → cookie → Accept-Language → fallback `nl`
- [ ] Framework install: `npm i -D vitest @playwright/test @testcontainers/postgresql vitest-mock-extended && npx playwright install`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OPS-05 slow-query log threshold | OPS-05 | Requires Supabase Dashboard / psql role with `pg_settings` access — not part of app runtime | Connect to staging Postgres → `SHOW log_min_duration_statement;` → expect `500ms`. Document in OPS runbook. |
| MIG-05 rollback procedure | MIG-05 | Procedural / documentation requirement | Manually verify a rollback runbook section exists for each migration in `migrations/*.md`; spot-check by simulating rollback on staging once. |
| I18N-11 logs/source English | I18N-11 | Convention check; static grep gives signal but human review final | After implementation: `grep -rnE "(speler|trainer|gebruiker|wachtwoord)" src/` → expect zero matches in code. UI strings in `messages/` are exempt. |
| Belgian DPA signed for processors | OPS-12 / I18N-09 | Legal procurement task | Confirm signed DPAs exist with: Supabase, Hetzner, Mailgun EU, Sentry EU, Cloudflare (if used). Track in DPIA doc (Phase 8). |
| Consent text legal sign-off (NL) | GDPR-01 / I18N-09 | Legal review by external counsel | NL brontekst v1.0 ondertekend door juridisch adviseur **vóór** migratie 001 wordt uitgevoerd. EN/FR sign-off uiterlijk in Phase 8 release-gate. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies declared
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references in the verification map
- [ ] No watch-mode flags in any test command
- [ ] Feedback latency < 30 seconds on quick run
- [ ] `nyquist_compliant: true` set in frontmatter (after planner approves)

**Approval:** pending
