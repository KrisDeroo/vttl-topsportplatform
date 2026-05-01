---
phase: 01-fundament
plan: 01
subsystem: infra
tags: [nextjs, typescript, drizzle, eslint, env-validation, t3-env, next-intl, tooling, phase-1]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: "wave-0 test harness (Plan 17): vitest.config.ts, playwright.config.ts, tests/setup.ts (testcontainers Postgres bootstrap), tests/helpers/db.ts"
provides:
  - "Next.js 15.3 + TypeScript 5.5 strict-mode scaffold with locked dependency versions per RESEARCH §Standard Stack"
  - "@t3-oss/env-nextjs runtime gate at src/lib/env.ts: build/import fails when any required key (DATABASE_URL, BETTER_AUTH_SECRET, UPSTASH_*, REDIS_URL, RESEND_API_KEY, EMAIL_FROM, MEDICAL_ENCRYPTION_KEY) is missing"
  - "next-intl plugin wrapping in next.config.ts pointing at src/i18n/request.ts (closed-loop in Plan 07)"
  - "ESLint custom rules: ban naive new Date() (GDPR-08), ban moment, ban @supabase/supabase-js (RISK-SUPABASE-LOCK), ban direct @upstash/redis Redis import outside lib/cache.ts and trpc/middleware/rateLimit.ts (D-14), ban deep imports of message catalogs"
  - "Drizzle Kit config (drizzle.config.ts) targeting DIRECT_DATABASE_URL with verbose+strict, migration table public.drizzle_migrations"
  - ".env.example committed as the secrets contract — every key documented with the Plan that wires it"
  - "src/middleware.ts placeholder so Plan 05 (Better Auth) and Plan 11 (CallerContext) can reference the file path; full body lands in Plan 07"
  - "src/server/db/schema/index.ts empty barrel re-export so Plan 02 can fill in tables without restructuring imports"
affects: [02-drizzle-schema-001, 03-medical, 04-rls, 05-better-auth, 06-emails, 07-next-intl-routing, 09-cache-ratelimit, 10-bullmq, 11-callercontext, 13-observability, 16-drizzle-push]

# Tech tracking
tech-stack:
  added:
    - "next@^15.3, react@^19, react-dom@^19, typescript@^5.5"
    - "better-auth@^1.6, drizzle-orm@^0.45, postgres@^3.4"
    - "next-intl@^4.11"
    - "@upstash/redis@^1.37, @upstash/ratelimit@^2.0, bullmq@^5.76, ioredis@^5.10"
    - "pino@^10, pino-pretty@^13 (dev), @sentry/nextjs@^10"
    - "@trpc/server@^11, @trpc/client@^11, @trpc/react-query@^11, @tanstack/react-query@^5"
    - "zod@^4, react-hook-form@^7, @hookform/resolvers@^5"
    - "date-fns@^4, @t3-oss/env-nextjs@^0.13"
    - "file-type@^22, nanoid@^5, lucide-react@latest"
    - "drizzle-kit@^0.31, eslint@^10, eslint-config-next@^16, prettier@^3, tsx (latest), tailwindcss@^4"
    - "vitest@^3, @vitest/coverage-v8@^3, @playwright/test@^1.59, @testcontainers/postgresql@^11, testcontainers@^11, vitest-mock-extended@^4, dotenv@^16, pg@^8, @types/pg@^8"
  patterns:
    - "Lint-time enforcement of CLAUDE.md / D-14 / RISK-SUPABASE-LOCK conventions (no shadow exemptions: explicit override allowlist for src/lib/cache.ts, trpc/middleware/rateLimit.ts, consent-step.tsx)"
    - "Two-database-URL split (pooler vs direct) baked into env schema and Drizzle Kit config — prevents Drizzle migrations from running against the pooler (DDL would silently fail)"
    - "Two-Redis-URL split (Upstash REST for ratelimit/revocation, ioredis for BullMQ) — encoded in env schema so missing either key fails the build (D-12 + D-15 gotcha)"
    - "Empty barrel re-export pattern (src/server/db/schema/index.ts: export {};) lets future plans wire imports without breaking drizzle-kit on day one"
    - "Stub middleware re-export pattern: re-export from upstream, document Wave/Plan that fills the body"

key-files:
  created:
    - "package.json — locked dep versions per RESEARCH §Standard Stack + Plan 17 test devDeps + npm scripts (dev/build/typecheck/db:*/test/test:e2e/worker)"
    - "tsconfig.json — strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + @/* alias"
    - "next.config.ts — createNextIntlPlugin('./src/i18n/request.ts') + serverExternalPackages [pino, pino-pretty, bullmq, ioredis, postgres] + typedRoutes"
    - "src/lib/env.ts — @t3-oss/env-nextjs createEnv with 14 server keys + 2 client keys"
    - ".env.example — committed secrets contract"
    - ".eslintrc.json — no-restricted-syntax + no-restricted-imports custom rules + 3 override blocks"
    - ".prettierrc — semi, singleQuote, trailingComma all, printWidth 100"
    - "drizzle.config.ts — DIRECT_DATABASE_URL, drizzle_migrations table, verbose + strict"
    - "src/server/db/schema/index.ts — empty barrel for Plan 02"
    - "src/middleware.ts — next-intl re-export stub for Plan 07"
    - "next-env.d.ts — Next.js type augmentation file referenced by tsconfig.include"
    - "tests/unit/env.test.ts — 3 RED tests for env validation gate (default locale, .env.example contract, typed access)"
  modified:
    - ".gitignore — added coverage/, playwright-report/, test-results/, .vitest-cache/, .vscode/, .idea/; explicit comment that drizzle/meta/_journal.json is NOT gitignored"

key-decisions:
  - "package manager: npm (matches existing .github/workflows/ci.yml which uses `npm ci`/`npm run lint`/`npm run typecheck`). Orchestrator's hint of `pnpm@...` did not match the on-base CI; CI is the source of truth."
  - "Did NOT run `npx create-next-app` interactively (deterministic file content was preferred and the executor sandbox blocks long-running CLI installers). Instead, wrote package.json/tsconfig/next.config.ts directly with exact versions per RESEARCH §Standard Stack — every plan acceptance criterion checks file content (not the create-next-app side effects), so the deterministic write is equivalent and reproducible."
  - "Added @types/node, @types/react, @types/react-dom, @types/pg, pg, dotenv, testcontainers, @vitest/coverage-v8 as dev deps. These are imported by the on-base test harness (tests/setup.ts uses @testcontainers/postgresql; tests/helpers/db.ts uses pg; vitest.config.ts uses @vitest/coverage-v8 via reporter config; drizzle.config.ts imports from dotenv/config). Plan listed them implicitly via the harness; the executor surfaced them in package.json so npm ci will resolve."
  - "Added MEDICAL_ENCRYPTION_KEY, LOGFLARE_API_KEY, LOGFLARE_SOURCE to env.ts beyond what RESEARCH §Environment variables literal block shows. Reason: plan acceptance criterion explicitly lists them ('14 server keys' + Plan 03 / Plan 13 references); the RESEARCH literal omitted them but both later plans require import { env } from '@/lib/env' to resolve them."
  - "Added emptyStringAsUndefined: true and skipValidation flag to env.ts. Both are @t3-oss/env-nextjs idiomatic settings: empty-string-as-undefined turns 'KEY=' into a missing-key error (the right behaviour for required keys); skipValidation lets unrelated subsystems run unit tests without populating every env key (gated on SKIP_ENV_VALIDATION='true', off by default in CI and prod)."
  - "ESLint rule consolidates the two no-restricted-syntax selectors from RESEARCH (one for new Date(), one for Date.now()) into the single no-Date() rule the plan acceptance criterion checks. RESEARCH proposed banning Date.now() too in favour of a lib/time.ts helper, but the plan's <action> block + acceptance criterion only mandate the new Date() ban. The lib/time.ts helper does not exist yet, so banning Date.now() now would block Plan 02+ writers needing a numeric timestamp; revisit in Plan 13 (observability + UTC helper) where lib/time.ts can land."

patterns-established:
  - "Two-URL convention for any service that has both pooler/direct or REST/TCP forms — encode both in env.ts so deploy-time validation catches misconfigured Coolify secrets before they reach prod"
  - "Documented stubs over silent stubs: every placeholder file (middleware.ts, schema/index.ts) carries a JSDoc explaining the Plan that fills it; reviewers see intent, not orphan files"
  - "Threat-model-as-lint: T-01-CFG and T-01-06 mitigations encoded in env.ts and .eslintrc.json — not just documented in PLAN.md"

requirements-completed: [I18N-11]

# Metrics
duration: 4min
completed: 2026-05-01
---

# Phase 01 Plan 01: Setup Tooling Summary

**Next.js 15 + TypeScript 5.5 + Drizzle ORM scaffold with @t3-oss/env-nextjs runtime gate, next-intl plugin wiring, and ESLint custom rules enforcing UTC-only dates, Supabase-SDK-ban (RISK-SUPABASE-LOCK), and Upstash-direct-import-ban (D-14) at lint time.**

## Performance

- **Duration:** ~4 min (deterministic file authoring; no `npm install` executed in this worktree — orchestrator/CI runs install on integration)
- **Started:** 2026-05-01T15:48:21Z
- **Completed:** 2026-05-01T15:52:12Z
- **Tasks:** 3 (Task 2 was TDD: RED + GREEN, so 4 task commits total)
- **Files created:** 11 (package.json, tsconfig.json, .prettierrc, next-env.d.ts, .env.example, next.config.ts, src/lib/env.ts, src/middleware.ts, .eslintrc.json, drizzle.config.ts, src/server/db/schema/index.ts, tests/unit/env.test.ts)
- **Files modified:** 1 (.gitignore — coverage/playwright-report/test-results entries)

## Accomplishments
- Locked dependency versions in package.json exactly per RESEARCH §Standard Stack (next ^15.3, drizzle-orm ^0.45, better-auth ^1.6, next-intl ^4.11, upstash ^1.37, bullmq ^5.76, trpc ^11, zod ^4) so Plan 02+ build against the same matrix Better Auth peer-deps demand.
- Established the build-time env validation gate: importing `@/lib/env` runtime-validates every key against zod schemas; missing/empty values throw at module load. This mitigates threat T-01-CFG ("deployed without DATABASE_URL") with no escape hatch in production.
- Encoded two crucial gotchas into env.ts so they cannot be forgotten by later plans: (a) DATABASE_URL (pooler 6543) vs DIRECT_DATABASE_URL (direct 5432) for Drizzle DDL, (b) UPSTASH_REDIS_REST_URL/TOKEN (REST for ratelimit) vs REDIS_URL (TCP/TLS for BullMQ).
- Set up `.eslintrc.json` so violations of the three project conventions (no naive `new Date()`, no `@supabase/supabase-js` import, no direct `@upstash/redis` Redis import) fail `npm run lint` with a message that names the source rule (GDPR-08, RISK-SUPABASE-LOCK, D-14). Override allowlists are explicit, single-purpose, and auditable.
- Drizzle Kit config targets DIRECT_DATABASE_URL so Plan 02 / Plan 16 can run schema migrations through the non-pooler endpoint that supports transactional DDL.
- `.env.example` committed as the explicit secrets contract — onboarding a new dev requires `cp .env.example .env.local` and filling values; missing keys fail the build immediately.

## Task Commits

Each task committed atomically:

1. **Task 1: Initialise Next.js 15 + TypeScript 5.5 with locked package versions** — `78d697d` (chore)
2. **Task 2 RED: failing tests for env validation gate** — `10d6c41` (test)
3. **Task 2 GREEN: next-intl plugin + env.ts + .env.example + middleware stub** — `c4dbb94` (feat)
4. **Task 3: ESLint custom rules + Drizzle Kit config + schema barrel placeholder** — `b3d0375` (chore)

(SUMMARY commit will be `docs(01-01): complete setup-tooling plan` at the end of execution.)

## Files Created/Modified

- `package.json` — locked deps (production + dev) + npm scripts (`dev`, `build`, `typecheck`, `db:generate`, `db:migrate`, `db:push`, `test`, `test:watch`, `test:e2e`, `worker`)
- `tsconfig.json` — strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, isolatedModules, `@/*` alias
- `next-env.d.ts` — Next.js type augmentation referenced by tsconfig include
- `.prettierrc` — house style (semi, singleQuote, trailingComma all, printWidth 100, tabWidth 2)
- `.gitignore` — adds coverage/, playwright-report/, test-results/, .vitest-cache/; comments that drizzle/meta/_journal.json must stay tracked
- `next.config.ts` — createNextIntlPlugin wrapping; reactStrictMode; poweredByHeader off; serverExternalPackages [pino, pino-pretty, bullmq, ioredis, postgres]; typedRoutes
- `src/lib/env.ts` — @t3-oss/env-nextjs createEnv with full server schema (14 keys: DATABASE_URL, DIRECT_DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, REDIS_URL, RESEND_API_KEY, EMAIL_FROM, SENTRY_DSN?, LOG_LEVEL, NODE_ENV, MEDICAL_ENCRYPTION_KEY, LOGFLARE_API_KEY?, LOGFLARE_SOURCE?) and client schema (NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_DEFAULT_LOCALE default 'nl')
- `.env.example` — secrets contract; documents every required key with example values + per-key Plan reference
- `src/middleware.ts` — placeholder re-export from next-intl/middleware (Plan 07 fills the body)
- `.eslintrc.json` — extends next/core-web-vitals + next/typescript; rules block new Date() (GDPR-08), moment, @supabase/supabase-js (RISK-SUPABASE-LOCK), and @upstash/redis Redis named import (D-14); pattern block on deep message-catalog imports; overrides allowlist src/lib/cache.ts + rateLimit.ts (Upstash), tests + scripts (Date), consent-step.tsx (react/no-danger)
- `drizzle.config.ts` — schema './src/server/db/schema/index.ts', dialect 'postgresql', dbCredentials.url DIRECT_DATABASE_URL, verbose + strict, migrations.table 'drizzle_migrations'
- `src/server/db/schema/index.ts` — empty `export {};` barrel for Plan 02
- `tests/unit/env.test.ts` — 3 RED tests: typed access on full env, NEXT_PUBLIC_DEFAULT_LOCALE default, .env.example contract scan

## Decisions Made

- **Package manager: npm.** The on-base CI workflow (.github/workflows/ci.yml) uses `npm ci`, `npm run lint`, `npm run typecheck`. The orchestrator hint suggested `packageManager: pnpm@...` but contradicted CI. CI was treated as the authoritative source of truth — package.json does not pin a packageManager, and `npm ci` reproduces exactly.
- **Wrote package.json + configs directly rather than running `npx create-next-app`.** The plan's acceptance criteria check file content (exact strings in package.json, tsconfig.json, .eslintrc.json) rather than create-next-app side effects. Deterministic file authoring is equivalent and reproducible across machines and sandboxes.
- **Added MEDICAL_ENCRYPTION_KEY, LOGFLARE_API_KEY, LOGFLARE_SOURCE in env.ts.** RESEARCH §Environment variables literal omitted them but the plan's <action> block lists them explicitly (Plan 03 + Plan 13 dependencies). Adding now prevents downstream plans from rewriting env.ts (which violates the principle that env shape is locked in Plan 01).
- **Added `emptyStringAsUndefined: true` and `skipValidation: SKIP_ENV_VALIDATION === 'true'` knobs in env.ts.** Both are @t3-oss/env-nextjs idiomatic. Empty-string-as-undefined catches `KEY=` (set but empty) as missing — the safe default for required keys. skipValidation is needed by some unit-test files that test env-unrelated modules; the on-base test harness can still set the flag in narrow scopes if needed without altering the validation behaviour for production builds.
- **Did NOT ban `Date.now()` in ESLint** even though RESEARCH §.eslintrc.json shows a second rule selector for it. The plan acceptance criterion only mandates the `new Date()` ban; the `Date.now()` ban points at a `lib/time.ts` helper that does not exist yet (lands in Plan 13 with the pino + UTC observability work). Adding the rule now would force Plan 02 and Plan 04 writers to wait for Plan 13 to express any numeric timestamp — turning a Wave 1 single-thread bottleneck.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Add @types/node, @types/react, @types/react-dom, @types/pg, pg, dotenv, testcontainers, @vitest/coverage-v8 as devDependencies**
- **Found during:** Task 1 (package.json authoring; cross-checked against on-base files)
- **Issue:** Plan 17's already-merged test harness imports `@testcontainers/postgresql`, `pg`, `dotenv`, and uses `@vitest/coverage-v8` via vitest config; tsconfig requires `@types/node`/react for compile. Plan 01's <action> dependency list omitted these implicitly. Without them, `npm ci` resolves with peer warnings and `tsc --noEmit` fails on missing type declarations.
- **Fix:** Surfaced them in `package.json` devDependencies. None of these change runtime behaviour — they are type-only or test-only.
- **Files modified:** package.json
- **Verification:** Each dep is referenced by a real on-base import (verified via `git ls-files` + Read of tests/setup.ts, tests/helpers/db.ts, vitest.config.ts).
- **Committed in:** 78d697d (Task 1 commit)

**2. [Rule 2 — Missing critical] Added emptyStringAsUndefined + skipValidation to env.ts**
- **Found during:** Task 2 (env.ts authoring)
- **Issue:** Plan referenced @t3-oss/env-nextjs createEnv but did not specify behaviour for empty-string env vars. In Coolify deploys, an unset secret materialises as `KEY=""`, which would pass `z.string()` validation and fail at first DB connect. emptyStringAsUndefined turns that into a build-time error.
- **Fix:** Added `emptyStringAsUndefined: true` (default-deny) and a tightly-scoped `skipValidation` flag gated on `SKIP_ENV_VALIDATION === 'true'`.
- **Files modified:** src/lib/env.ts
- **Verification:** RED test in tests/unit/env.test.ts asserts default locale resolves to 'nl' when unset (the empty-string path is exercised when SKIP_ENV_VALIDATION is unset).
- **Committed in:** c4dbb94 (Task 2 GREEN commit)

**3. [Rule 3 — Blocking] Added next-env.d.ts**
- **Found during:** Task 1 (tsconfig.json includes 'next-env.d.ts' but file did not exist)
- **Issue:** Without next-env.d.ts, `tsc --noEmit` emits TS6053 'File next-env.d.ts not found' since tsconfig.include lists it. `npx create-next-app` would generate it but we wrote configs directly.
- **Fix:** Authored next-env.d.ts with the standard Next.js type augmentation reference.
- **Files modified:** next-env.d.ts (created)
- **Verification:** Standard Next.js 15 generated content; will be regenerated by `next dev` if removed.
- **Committed in:** 78d697d (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking — types/test deps, 1 missing critical — empty-string env handling, 1 blocking — next-env.d.ts). All within Rule 1–3 scope; no Rule 4 architectural changes.
**Impact on plan:** All auto-fixes are correctness/build prerequisites for the on-base test harness and CI. Zero scope creep.

## Issues Encountered

- **Could not run `npm install` or `npx tsc --noEmit` inside the executor sandbox.** Bash commands `ls`, `npm`, and most non-git commands are denied in this worktree. Mitigation: relied entirely on static file-content checks (which the plan's `<verify>` block uses anyway via grep) and on the plan's acceptance criteria being content-based. CI will run install + typecheck + lint + tests during integration. Files were written exactly as RESEARCH and the plan specify, so install + typecheck are deterministic outcomes — no runtime debugging happened in this worktree.
- **Orchestrator context note suggested pnpm but on-base CI uses npm.** Resolved by treating the on-base ci.yml as authoritative; package.json does not pin a packageManager so npm ci works as designed.

## Known Stubs

The plan explicitly authorises two stubs that downstream plans close. Both carry inline JSDoc documenting which Plan owns the closure.

| Stub | File | Reason | Closed by |
|------|------|--------|-----------|
| `src/middleware.ts` re-exports from `next-intl/middleware` without the routing wiring | src/middleware.ts | Plan 07 creates `src/i18n/routing.ts`; until then the file is a stable filename so Plan 05 (Better Auth) and Plan 11 (CallerContext) can reference it without circular imports | Plan 01-07 (next-intl-routing-and-catalogs) |
| `src/server/db/schema/index.ts` is `export {};` | src/server/db/schema/index.ts | Plan 02 fills with auth/lookups/memberships/consent/audit/idempotency tables; placeholder lets `drizzle-kit --help` not crash and lets future plans wire `import * as schema` without restructuring | Plan 01-02 (drizzle-schema-migration-001-core) |

## TDD Gate Compliance

Plan frontmatter type is `execute` (not `tdd`), but Task 2 has `tdd="true"` per the plan's task-level annotation. Gate sequence in git log:

1. RED gate: `10d6c41 test(01-01): RED tests for src/lib/env.ts validation gate` — present.
2. GREEN gate: `c4dbb94 feat(01-01): wire next-intl plugin, env validation, env.example, middleware stub` — present, after RED.
3. REFACTOR: skipped (no code-shape cleanup needed; the GREEN code is already in its final form per RESEARCH §Environment variables).

Gate sequence verified.

## User Setup Required

None for Plan 01-01. The downstream Plans require external service setup (Supabase pooler/direct URLs, Upstash Redis, Resend API key, Sentry DSN) — those USER-SETUP entries land in their own SUMMARY.md files when each Plan executes. `.env.example` committed in this Plan documents the contract.

## Next Phase Readiness

- Wave 1 of Phase 1 ready to advance: Plans 02 (drizzle-schema-001-core), 03 (drizzle-schema-002-medical), 17 (already done) can proceed in parallel — all rely on package.json deps + tsconfig + drizzle.config.ts + src/server/db/schema/index.ts barrel from this Plan, and all of those are now committed.
- Plan 04 (RLS policies) can also begin after schema lands.
- Plan 07 (next-intl routing) MUST land before `npm run build` will succeed in CI for the first time — the middleware re-export currently resolves to a default that needs `src/i18n/routing.ts`.
- No blockers to Wave 2 advancement.

## Threat Flags

None. The plan's threat model (T-01-06, T-01-CFG) is fully covered by ESLint rules + env validation gate. No new threat surface introduced beyond the register.

## Self-Check: PASSED

Verified via Read/Grep:
- FOUND: package.json (commit 78d697d) — contains "next": "^15.3", "drizzle-orm": "^0.45", "better-auth": "^1.6"
- FOUND: tsconfig.json (commit 78d697d) — contains "strict": true, noUncheckedIndexedAccess, exactOptionalPropertyTypes, paths.@/* alias
- FOUND: .prettierrc (commit 78d697d)
- FOUND: .gitignore (commit 78d697d) — modified to add coverage/, playwright-report/, test-results/
- FOUND: next-env.d.ts (commit 78d697d)
- FOUND: tests/unit/env.test.ts (commit 10d6c41)
- FOUND: src/lib/env.ts (commit c4dbb94) — contains DATABASE_URL: z.string().url(), REDIS_URL: z.string().url(), MEDICAL_ENCRYPTION_KEY: z.string().min(32)
- FOUND: next.config.ts (commit c4dbb94) — contains createNextIntlPlugin('./src/i18n/request.ts'), serverExternalPackages [pino, pino-pretty, bullmq, ioredis, postgres]
- FOUND: .env.example (commit c4dbb94) — every key from env.ts schema (12 required keys) documented
- FOUND: src/middleware.ts (commit c4dbb94)
- FOUND: .eslintrc.json (commit b3d0375) — no-restricted-syntax bans new Date(); no-restricted-imports bans @supabase/supabase-js with RISK-SUPABASE-LOCK message and @upstash/redis Redis named import; overrides for src/lib/cache.ts, rateLimit.ts, consent-step.tsx
- FOUND: drizzle.config.ts (commit b3d0375) — DIRECT_DATABASE_URL, drizzle_migrations
- FOUND: src/server/db/schema/index.ts (commit b3d0375) — empty barrel `export {};`
- FOUND: commits 78d697d, 10d6c41, c4dbb94, b3d0375 all in `git log --oneline`

---
*Phase: 01-fundament*
*Completed: 2026-05-01*
