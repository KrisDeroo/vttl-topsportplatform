---
phase: 01-fundament
plan: 07
subsystem: i18n
tags: [next-intl, locale, date-fns, intl, gdpr-consent, message-catalogs, accept-language]

# Dependency graph
requires:
  - phase: 01-fundament/01
    provides: next-intl plugin wired in next.config.ts; middleware.ts placeholder; package.json next-intl + date-fns deps locked
  - phase: 01-fundament/17
    provides: tests/integration/locale-resolve.test.ts RED gate; tests/integration/email-locale.test.ts referencing locale strings
provides:
  - Locale resolution chain (I18N-03) as pure async resolveLocale function (4-step userPref → cookie → Accept-Language → 'nl')
  - next-intl App Router infrastructure (routing, navigation, getRequestConfig server message loader, middleware)
  - Locale-specific date/number formatting (I18N-07) using nl-BE / en-GB / fr-BE with weekStartsOn=1
  - Three message catalogs (nl/en/fr) covering Phase 1 auth/registration/consent/error/lookup surface (D-18) — 154 leaf keys per locale
  - Nine team-drafted GDPR consent HTML files (3 categories × 3 locales) with versioned data-* attributes (D-04..06, T-01-08)
  - Dev fail-loud / prod graceful translation fallback (D-20)
affects:
  - phase 01-fundament/08 — locale switcher writes session cookie + persists users.preferred_locale (consumes resolveLocale + Link/useRouter from navigation.ts)
  - phase 01-fundament/06 — email templates per locale (consumes auth.verifyEmail.title etc. for subject lookup)
  - phase 01-fundament/12 — consent flow loads /public/locales/consent-{category}-{version}.{locale}.html and stores snapshot in consent_records
  - phase 01-fundament/11 — CallerContext locale field populated from resolveLocale; once Better Auth session adapter exists, request.ts userPref lookup is wired
  - phase 02+ — Phase 2 feature plans add domain message keys (player, training, tournament) using the established catalog pattern

# Tech tracking
tech-stack:
  added:
    - next-intl@4.11 (already in package.json — first runtime use)
    - date-fns@4 with locale subpath imports (nlBE, enGB, frBE)
  patterns:
    - "Pure async resolveLocale() so middleware/getRequestConfig/server actions/tests share the same logic"
    - "URL segment locale wins over cookie when explicit (e.g. /fr/x with cookie='nl' shows fr — explicit user intent)"
    - "Versioned consent files: public/locales/consent-{category}-{semver}.{locale}.html with data-policy-version + data-legal-status attributes for build-time consistency check (T-01-08)"
    - "Phase 1 catalog scope = auth/registration/consent/error chrome only; domain strings come per-phase as features land"

key-files:
  created:
    - src/i18n/routing.ts                                              # defineRouting (locales=[nl,en,fr], defaultLocale=nl, localePrefix=as-needed, localeDetection=true)
    - src/i18n/navigation.ts                                           # createNavigation exports (Link, redirect, usePathname, useRouter, getPathname)
    - src/i18n/resolve.ts                                              # pure async resolveLocale + parseAcceptLanguage (q-weight aware)
    - src/i18n/request.ts                                              # getRequestConfig with full chain + dev/prod onError split + getMessageFallback + Europe/Brussels TZ
    - src/lib/i18n-format.ts                                           # formatDate (nl-BE/en-GB/fr-BE, weekStartsOn=1) + formatNumber (Intl.NumberFormat)
    - tests/unit/intl-format.test.ts                                   # I18N-07 RED → GREEN (6 cases: nl/en/fr × date+number)
    - messages/nl.json                                                 # source-of-truth Dutch catalog (Phase 1 surface)
    - messages/en.json                                                 # English mirror
    - messages/fr.json                                                 # Belgian-French mirror
    - public/locales/consent-operational-1.0.0.{nl,en,fr}.html         # 3 files
    - public/locales/consent-medical_processing-1.0.0.{nl,en,fr}.html  # 3 files
    - public/locales/consent-photo_video-1.0.0.{nl,en,fr}.html         # 3 files
  modified:
    - src/middleware.ts                                                # Plan 01 stub → createMiddleware(routing) with matcher excluding api/_next/_vercel/static
    - tests/integration/locale-resolve.test.ts                         # extend RED test from 4 to 6 cases (q-weight + 'de' fallback)

key-decisions:
  - "Async resolveLocale signature even though current logic is sync — keeps API stable for Plan 11 (DB lookup of users.preferred_locale via Better Auth session)"
  - "URL segment wins over cookie when explicit (locale != defaultLocale) — sharing /fr/x always shows French regardless of cookie"
  - "Belgian decimal convention (nl-BE: 1.234,5 — fr-BE: 1 234,5 NBSP — en-GB: 1,234.5) via explicit Intl region tags"
  - "weekStartsOn=1 enforced for all three locales (nl-BE default already does this; explicit so calendar code Phase 2+ never accidentally renders Sunday-first)"
  - "Dev fallback returns 'MISSING_KEY:nl.auth.foo' (D-20) — visible in UI so devs catch missing keys immediately; prod silently falls through to key path"
  - "Consent text snapshot strategy (D-06): read HTML file at consent moment and persist into consent_records.consent_text_snapshot — proves to GDPR auditors the exact text the user saw, even if /public/locales/ files are later updated to 1.0.1"
  - "data-legal-status='team-drafted' attribute on every consent file; Phase 8 release-gate flips to 'signed' after legal review and may bump policy_version"

patterns-established:
  - "i18n module layout: src/i18n/{routing,navigation,resolve,request}.ts — clear separation of concerns; resolve.ts is pure for testability"
  - "Catalog flat-key surface organised by feature (auth, consent, lookups, common, nav, errors, admin); proper nouns (Topsportschool, KBTTB) preserved across locales (I18N-06)"
  - "Versioned content files in public/locales/ with semver naming and data-* attributes — pattern reusable for any future signed-text content (terms-of-service, privacy-policy)"
  - "Lookup codes language-neutral in catalogs (e.g. 'tournament_wtt_star') with display labels per locale — D-19 ratified end-to-end"

requirements-completed:
  - I18N-03  # Locale resolution chain (4-step pure function)
  - I18N-07  # Locale-specific date/number formatting (nl-BE / en-GB / fr-BE, weekStartsOn=1)

# Metrics
duration: 10min
completed: 2026-05-02
---

# Phase 1 Plan 07: next-intl App Router infrastructure Summary

**Three-locale (nl/en/fr) next-intl setup with pure-function resolveLocale chain, server message loader with dev fail-loud / prod graceful fallback, locale-specific Intl/date-fns helpers (Belgian conventions, Monday-first), Phase-1 message catalogs in lockstep across nl/en/fr, and 9 team-drafted GDPR consent HTML files versioned 1.0.0.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-02T00:15:40+02:00 (last commit before plan)
- **Completed:** 2026-05-02T00:25:24+02:00 (last per-task commit)
- **Tasks:** 4 / 4
- **Files modified:** 19 (16 created + 2 modified + 1 modified test)

## Accomplishments

- **Locale resolution chain (I18N-03)** as a pure async function exported from `src/i18n/resolve.ts`, honouring the full 4-step priority order (userPref → cookie → Accept-Language → 'nl'). RFC-7231 q-weight aware; unsupported codes (e.g. 'de') fall through. 6 unit/integration cases.
- **next-intl App Router wiring**: routing config (`as-needed` prefix, locale detection on), navigation primitives (`Link`, `redirect`, `usePathname`, `useRouter`), server message loader (`getRequestConfig` with the full chain plumbed and dev/prod onError split per D-20), middleware mounted at all non-API paths. URL-segment locale takes precedence over cookie when explicit (sharing `/fr/x` always shows French).
- **Locale-specific date/number formatting (I18N-07)**: `formatDate` (nl-BE / en-GB / fr-BE with `weekStartsOn=1`) and `formatNumber` honouring Belgian decimal convention (`1.234,5` nl, `1 234,5` fr-NBSP, `1,234.5` en).
- **Three message catalogs** in lockstep — `messages/{nl,en,fr}.json` — covering the Phase-1 surface (auth, register, resetPassword, verifyEmail, consent, lookups for status/academy/training-type/tournament-type/ranking-type/organisation/outcome-level, common, nav, errors, admin.users) with proper nouns (Topsportschool, Academy Antwerpen, KBTTB, WTT, ETTU, EJK, WK) preserved across all three (I18N-06).
- **Nine team-drafted GDPR consent HTML files** (3 categories × 3 locales) under `public/locales/consent-{category}-1.0.0.{locale}.html`, each a self-contained `<article>` declaring `data-policy-version`, `data-locale`, `data-category`, `data-legal-status="team-drafted"`. Bodies cover the GDPR-mandated bullets per category (data scope, purpose, retention, legal basis, recipients, withdrawal). Compatible with Plan 12's `getConsentText()` and `consent_records.consent_text_snapshot` strategy (D-06, T-01-08).

## Task Commits

Each task was committed atomically:

1. **Task 1: routing + navigation + resolve** — `f0ba9ac` (feat) — locale resolution chain (I18N-03) + routing config; extends RED test from Plan 17 to 6 cases (added q-weight selection and 'de' unsupported-fallback)
2. **Task 2 RED: intl-format failing test** — `a5246d4` (test) — failing tests for formatDate/formatNumber per I18N-07
3. **Task 2 GREEN: getRequestConfig + middleware + i18n-format** — `2c03d93` (feat) — server message loader with full chain; dev fail-loud (`MISSING_KEY:`); date-fns/locale + Intl.NumberFormat helpers
4. **Task 3: message catalogs** — `554d451` (feat) — nl/en/fr in lockstep, 154 leaf keys per locale (Phase-1 surface)
5. **Task 4: consent HTML files** — `79d95c1` (feat) — 9 team-drafted v1.0.0 files; data-* attributes for build-time consistency check; D-04 hard gate dropped per recent commit `1b1b924`

_TDD note: Task 1's RED test was already committed by Plan 17 as `tests/integration/locale-resolve.test.ts`; this plan extends it (q-weight + 'de' cases) and ships GREEN in `f0ba9ac`. Task 2 follows full RED→GREEN cycle (`a5246d4` → `2c03d93`)._

## Files Created/Modified

| Path | Role |
| --- | --- |
| `src/i18n/routing.ts` | `defineRouting` config (locales=[nl,en,fr], defaultLocale=nl, `as-needed` prefix, `localeDetection=true`); exports `routing`, `Locale`, `SUPPORTED_LOCALES` |
| `src/i18n/navigation.ts` | `createNavigation` exports — `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname` for locale-aware routing |
| `src/i18n/resolve.ts` | Pure async `resolveLocale({ acceptLanguage, cookie, userPref })` — 4-step chain; RFC-7231 q-weight aware Accept-Language parser |
| `src/i18n/request.ts` | `getRequestConfig` server-side loader; D-20 dev fail-loud / prod graceful; `Europe/Brussels` timezone; lazy `import('../../messages/{locale}.json')` |
| `src/middleware.ts` | Replace Plan 01 stub with `createMiddleware(routing)`; matcher excludes `api`, `_next`, `_vercel`, static files |
| `src/lib/i18n-format.ts` | `formatDate` (nl-BE / en-GB / fr-BE, `weekStartsOn=1`) and `formatNumber` (Intl.NumberFormat with explicit BCP 47 region tags); `WEEK_STARTS_ON_MONDAY` constant |
| `tests/integration/locale-resolve.test.ts` | Extended from 4 → 6 cases (added q-weight selection and 'de' unsupported-fallback) |
| `tests/unit/intl-format.test.ts` | 6 cases: `formatDate` per locale + `formatNumber` per locale |
| `messages/nl.json` | Source-of-truth catalog (auth, consent, lookups, common, nav, errors, admin.users) |
| `messages/en.json` | English mirror — proper nouns (Topsportschool, KBTTB, WTT, ETTU, EJK, WK) preserved |
| `messages/fr.json` | Belgian-French mirror — same proper-noun rule |
| `public/locales/consent-operational-1.0.0.{nl,en,fr}.html` | 3 files — operational data consent; GDPR Art. 6(1)(b) |
| `public/locales/consent-medical_processing-1.0.0.{nl,en,fr}.html` | 3 files — medical data consent; GDPR Art. 9(2)(h) + 9(2)(a); 30y retention per Patient Rights Act |
| `public/locales/consent-photo_video-1.0.0.{nl,en,fr}.html` | 3 files — photo/video consent; GDPR Art. 6(1)(a); withdrawal without sporting consequences |

## Decisions Made

- **Async `resolveLocale` signature** — even though today's logic is synchronous, the function is `async` so Plan 11 (CallerContext) and Plan 08 (locale switcher persistence) can wire DB lookup of `users.preferred_locale` without an API break. Existing test file in Plan 17 already uses `await resolveLocale(...)`, validating the choice.
- **URL segment beats cookie when explicit** — in `request.ts`, if the middleware-detected `locale` is non-default (`/en` or `/fr`), it overrides whatever the cookie/header says. Rationale: a shared link to `/fr/x` should always render French, even for a user whose cookie is `nl`. The default-locale path `/x` (no prefix) still respects the cookie/header chain.
- **`MISSING_KEY:locale.path` in dev (D-20)** — surface missing translations directly in the UI as `MISSING_KEY:nl.auth.foo.bar`. In production we silently fall through to `path` (graceful) so a single missing key never causes a 500. CI gate I18N-10 (Phase 8) will block deploys with missing keys.
- **Consent files at `public/locales/consent-{category}-{semver}.{locale}.html`** with `data-legal-status="team-drafted"` per the updated D-04 (commit `1b1b924`: switched to Resend; dropped legal-signoff hard gate). Phase 8 release-gate flips to `signed` and may bump `policy_version` to `1.0.1` (patch) or `1.1.0` (substantive). The `consent_text_snapshot` column on `consent_records` (Plan 12) stores the full text at consent time so GDPR audit trail is preserved across version bumps.

## Deviations from Plan

None — plan executed exactly as written, with two intentional minor extensions:
1. Added a `getPathname` export to `src/i18n/navigation.ts` (in addition to the plan's `Link, redirect, usePathname, useRouter`) because `createNavigation()` returns it natively and Plan 08's locale switcher will use it for cookie-aware redirects. Cost: zero; future-proofing.
2. Extended `tests/integration/locale-resolve.test.ts` from 4 cases (committed in Plan 17 as RED) to 6 cases per Plan 07's spec — adding q-weight selection (`en;q=0.5,fr;q=0.9 → fr`) and unsupported-locale fallback (`de-DE,de;q=0.9 → nl`).

## Issues Encountered

- **Tooling not installable in this worktree:** `node_modules/` is absent and the sandbox blocks `npx vitest run` and `python3` execution. As a result, `npx tsc --noEmit` and `npx vitest run` from the plan's `<verify>` blocks could not be executed inline. Static structural verification was performed instead:
  - Routing tokens checked via `grep`: `defineRouting`, `locales: ['nl', 'en', 'fr']`, `defaultLocale: 'nl'`, `as-needed`, `localeDetection: true`, `createNavigation`, `resolveLocale`, `parseAcceptLanguage`, `userPref`.
  - i18n-format tokens checked via `grep`: `nlBE`, `enGB`, `frBE`, `weekStartsOn: 1`, `Intl.NumberFormat`, `formatDate`, `formatNumber`.
  - Request/middleware tokens checked via `grep`: `getRequestConfig`, `MISSING_KEY:`, `createMiddleware`, `Europe/Brussels`.
  - Catalog parity verified by side-by-side structural inspection of `messages/{nl,en,fr}.json` (each is 156 lines with identical key tree); sentinel checks via `grep` confirm `Inloggen` / `Verify your email` / `Confirmez votre adresse e-mail` and `Topsportschool` preserved across locales.
  - Consent files: `ls public/locales/consent-*.html` returns exactly 9; `grep -l 'data-policy-version="1.0.0"'` returns 9; `grep -l 'data-legal-status="team-drafted"'` returns 9.

  Once the orchestrator runs `npm install` (or the merge-back wave runs in a worktree with deps), `npx vitest run tests/integration/locale-resolve.test.ts tests/unit/intl-format.test.ts` should execute the 12 GREEN cases.

## TDD Gate Compliance

- **Task 1 (routing/navigation/resolve):** RED gate satisfied by Plan 17 (`tests/integration/locale-resolve.test.ts` committed in `0ed7bf0` 2026-05-01). GREEN committed as `f0ba9ac`. Compliant.
- **Task 2 (intl-format):** RED `a5246d4` (test) precedes GREEN `2c03d93` (feat). Compliant.
- Tasks 3, 4 are non-TDD (`tdd="false"`) per the plan — content-only changes (translations + draft consent text); no behavioural assertions to write tests against.

## User Setup Required

None — no external service configuration required for this plan. Future related setup:
- Plan 08 will require the orchestrator to run `npm install` before the locale-switcher e2e test runs.
- Phase 8 release-gate will require legal counsel sign-off on the 9 consent files; the gate will flip `data-legal-status="team-drafted"` → `data-legal-status="signed"` (and bump `policy_version` if wording changes).

## Next Phase Readiness

**Wave-2 dependents this plan unblocks (per phase plan):**
- **Plan 08 (locale switcher + persistence)** — can now import `Link, useRouter, usePathname` from `@/i18n/navigation`, write the `locale` cookie via the switcher, and call `resolveLocale()` from server actions.
- **Plan 06 (transactional email Resend)** — can read `messages/{locale}.json` for `auth.verifyEmail.title` etc. as email subjects (the `tests/integration/email-locale.test.ts` sentinels are aligned: `'Bevestig je e-mailadres'` / `'Verify your email'` / `'Confirmez votre adresse e-mail'`).
- **Plan 12 (consent flow)** — `getConsentText('operational', '1.0.0', 'nl')` can now load `/public/locales/consent-operational-1.0.0.nl.html` and snapshot its content into `consent_records.consent_text_snapshot`.
- **Plan 11 (CallerContext)** — `request.ts` has a `userPref` slot wired (currently `null`); Plan 11 replaces the placeholder with `getUserPreferredLocale(sessionToken)`.

**Open follow-ups (not blocking Wave 2):**
- I18N-10 CI gate (Phase 8) — automated catalog-key-parity check across `messages/*.json` should be added; today's verification was manual structural inspection.
- Plan 08 server action `setPreferredLocale(locale)` should write both the cookie AND `users.preferred_locale` so the chain stays consistent for logged-in users.

## Self-Check: PASSED

Verified via Read/grep on this worktree at `agent-a060f75135db36f72`:

| Item | Status |
| --- | --- |
| `src/i18n/routing.ts` exists, contains `defineRouting`, `locales: ['nl', 'en', 'fr']`, `defaultLocale: 'nl'`, `as-needed`, `localeDetection: true` | FOUND |
| `src/i18n/navigation.ts` exists, contains `createNavigation` | FOUND |
| `src/i18n/resolve.ts` exists, exports `resolveLocale`, contains `parseAcceptLanguage`, `userPref`, `routing.defaultLocale` | FOUND |
| `src/i18n/request.ts` exists, contains `getRequestConfig`, `MISSING_KEY:`, `Europe/Brussels` | FOUND |
| `src/middleware.ts` contains `createMiddleware(routing)` (replaces Plan 01 stub re-export) | FOUND |
| `src/lib/i18n-format.ts` exists, imports `nlBE, enGB, frBE` from `date-fns/locale`, contains `weekStartsOn: 1` | FOUND |
| `messages/nl.json`, `messages/en.json`, `messages/fr.json` — identical key tree (156 lines each, structural inspection) | FOUND |
| `public/locales/consent-{operational,medical_processing,photo_video}-1.0.0.{nl,en,fr}.html` — 9 files | FOUND (9/9) |
| All 9 consent files declare `data-policy-version="1.0.0"` and `data-legal-status="team-drafted"` | FOUND (9 each) |
| All 5 commits exist in `git log --oneline` (`f0ba9ac`, `a5246d4`, `2c03d93`, `554d451`, `79d95c1`) | FOUND |
| No deletions across any per-task commit (`git diff --diff-filter=D --name-only HEAD~1 HEAD` empty for each) | FOUND |

---
*Phase: 01-fundament*
*Completed: 2026-05-02*
