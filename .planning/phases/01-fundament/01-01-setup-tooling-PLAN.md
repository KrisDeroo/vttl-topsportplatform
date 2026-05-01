---phase: 01-fundament
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - next.config.ts
  - .eslintrc.json
  - .prettierrc
  - .gitignore
  - .env.example
  - drizzle.config.ts
  - src/lib/env.ts
  - src/middleware.ts
autonomous: true
requirements:
  - I18N-11
requirements_supports:  # informational — primary owners listed below
  - OPS-03
  - MIG-01
threat_refs:
  - T-01-06
tags:
  - phase-1
  - setup
  - tooling
  - nextjs
  - drizzle
  - typescript

must_haves:
  truths:
    - "`npm run build` completes successfully against an empty schema"
    - "`npx tsc --noEmit` reports zero type errors"
    - "`src/lib/env.ts` validates DATABASE_URL, BETTER_AUTH_SECRET, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, REDIS_URL"
    - "`drizzle.config.ts` points at DIRECT_DATABASE_URL (port 5432, not pooler)"
    - "ESLint custom rule blocks `new Date()` (zero-arg) and direct `@upstash/redis` imports outside `lib/cache.ts`"
    - "ESLint rule blocks importing `@supabase/supabase-js` (RISK-SUPABASE-LOCK)"
  artifacts:
    - path: "package.json"
      provides: "Locked dependency versions per RESEARCH §Standard Stack"
      contains: "next@^15.3"
    - path: "src/lib/env.ts"
      provides: "Typed env via @t3-oss/env-nextjs; build fails if any required env missing"
      exports: ["env"]
    - path: "next.config.ts"
      provides: "next-intl plugin wrapper; serverExternalPackages for pino/bullmq/ioredis/postgres"
      contains: "createNextIntlPlugin"
    - path: ".eslintrc.json"
      provides: "Custom rules: no new Date(), no @upstash/redis outside lib/cache.ts, no @supabase/supabase-js, no moment"
      contains: "no-restricted-syntax"
    - path: "drizzle.config.ts"
      provides: "Drizzle Kit config pointing at DIRECT_DATABASE_URL with strict + verbose"
      contains: "defineConfig"
    - path: ".env.example"
      provides: "Documents every required env var; committed to repo"
      contains: "DATABASE_URL="
  key_links:
    - from: "next.config.ts"
      to: "src/i18n/request.ts"
      via: "createNextIntlPlugin('./src/i18n/request.ts')"
      pattern: "createNextIntlPlugin.*src/i18n/request"
    - from: "drizzle.config.ts"
      to: "src/server/db/schema/index.ts"
      via: "schema property"
      pattern: "schema:.*src/server/db/schema"
    - from: ".eslintrc.json"
      to: "src/lib/cache.ts"
      via: "no-restricted-imports allowlist"
      pattern: "@upstash/redis.*forbidden"
---

<objective>
Bootstrap a Next.js 15 + TypeScript 5.5 + Drizzle ORM project with strict tooling, env validation, and ESLint rules that enforce the project conventions (UTC-only dates, no Supabase JS SDK, no direct Upstash imports outside the cache abstraction). Every later plan in Wave 2+ depends on these files existing and being correct.

Purpose: Without correct env validation, ESLint rules, and Drizzle Kit config, schema migrations cannot run, the i18n plugin cannot mount, and the team will accumulate convention drift from day one.

Output: A scaffolded Next.js 15 repository whose `npm run build` and `npx tsc --noEmit` both succeed against the (still empty) schema, with all CLAUDE.md / RESEARCH.md conventions enforced at lint time.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Initialise Next.js 15 + TypeScript 5.5 project with locked package versions</name>
  <read_first>
    - CLAUDE.md (Stack section — locks Next.js, Drizzle, Better Auth versions)
    - .planning/phases/01-fundament/01-CONTEXT.md (full file — 20 locked decisions)
    - .planning/phases/01-fundament/01-RESEARCH.md §Standard Stack (lines 164–238) — exact npm versions verified 2026-05-01
    - .planning/phases/01-fundament/01-RESEARCH.md §Project Setup → File-tree (lines 243–371) — exact directory layout to create
  </read_first>
  <files>
    package.json
    tsconfig.json
    .gitignore
    .prettierrc
  </files>
  <action>
    Run `npx create-next-app@15.3 vttl-topsport --typescript --eslint --app --src-dir --tailwind --import-alias "@/*"` in a parent dir, then copy the generated files into the repo root (or run with `--use-npm` directly in repo root if empty).

    Replace `package.json` so dependencies match RESEARCH §Standard Stack exactly:
    - `"next": "^15.3"`
    - `"react": "^19.0"`
    - `"react-dom": "^19.0"`
    - `"typescript": "^5.5"`
    - `"better-auth": "^1.6"`
    - `"drizzle-orm": "^0.45"`
    - `"postgres": "^3.4"`
    - `"next-intl": "^4.11"`
    - `"@upstash/redis": "^1.37"`
    - `"@upstash/ratelimit": "^2.0"`
    - `"bullmq": "^5.76"`
    - `"ioredis": "^5.10"`
    - `"pino": "^10"`
    - `"pino-pretty": "^13"` (devDependency)
    - `"@sentry/nextjs": "^10"`
    - `"@trpc/server": "^11"`, `"@trpc/client": "^11"`, `"@trpc/react-query": "^11"`
    - `"@tanstack/react-query": "^5"`
    - `"zod": "^4"`
    - `"react-hook-form": "^7"`
    - `"@hookform/resolvers": "^5"`
    - `"date-fns": "^4"`
    - `"@t3-oss/env-nextjs": "^0.13"`
    - `"file-type": "^22"`
    - `"nanoid": "^5"`
    - `"lucide-react": "latest"`

    devDependencies:
    - `"drizzle-kit": "^0.31"`
    - `"vitest": "^3"` (per RESEARCH note: pin ^3.x for stability — Better Auth peers ^2||^3||^4)
    - `"@playwright/test": "^1.59"`
    - `"@testcontainers/postgresql": "^11"`
    - `"vitest-mock-extended": "^4"`
    - `"eslint": "^10"`, `"eslint-config-next": "^16"`
    - `"prettier": "^3"`
    - `"tsx": "latest"`

    Scripts in `package.json`:
    ```json
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "next lint",
      "typecheck": "tsc --noEmit",
      "db:generate": "drizzle-kit generate",
      "db:migrate": "drizzle-kit migrate",
      "db:push": "drizzle-kit push",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test",
      "worker": "tsx src/server/workers/index.ts"
    }
    ```

    Replace `tsconfig.json` exactly per RESEARCH lines 377–399:
    ```json
    {
      "compilerOptions": {
        "target": "ES2022",
        "lib": ["dom", "dom.iterable", "es2022"],
        "module": "esnext",
        "moduleResolution": "bundler",
        "strict": true,
        "noUncheckedIndexedAccess": true,
        "exactOptionalPropertyTypes": true,
        "noImplicitOverride": true,
        "skipLibCheck": true,
        "esModuleInterop": true,
        "isolatedModules": true,
        "incremental": true,
        "jsx": "preserve",
        "plugins": [{ "name": "next" }],
        "paths": { "@/*": ["./src/*"] }
      },
      "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      "exclude": ["node_modules"]
    }
    ```

    Add `.prettierrc`:
    ```json
    { "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "tabWidth": 2 }
    ```

    `.gitignore` must include `.env`, `.env.local`, `node_modules`, `.next`, `coverage`, `playwright-report`, `test-results`, `drizzle/meta/_journal.json` is NOT gitignored (must be committed).

    Run `npm install` and verify zero errors.
  </action>
  <verify>
    <automated>cd vttl-topsport && npm install --silent && npx tsc --noEmit && grep -q '"next": "\^15.3"' package.json && grep -q '"drizzle-orm": "\^0.45"' package.json && grep -q '"better-auth": "\^1.6"' package.json && grep -q '"strict": true' tsconfig.json && grep -q 'noUncheckedIndexedAccess' tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` exists and contains exact strings: `"next": "^15.3"`, `"better-auth": "^1.6"`, `"drizzle-orm": "^0.45"`, `"next-intl": "^4.11"`, `"@upstash/redis": "^1.37"`, `"bullmq": "^5.76"`, `"@trpc/server": "^11"`, `"zod": "^4"`
    - `tsconfig.json` contains `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"paths": { "@/*": ["./src/*"] }`
    - `npx tsc --noEmit` returns exit 0
    - `npm run lint` returns exit 0 (no source files yet, just config)
    - `package.json` `scripts` block contains: `dev`, `build`, `typecheck`, `db:generate`, `db:migrate`, `test`, `worker`
  </acceptance_criteria>
  <done>Next.js 15 project initialised with TypeScript strict mode and locked dependency versions; type-check passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire next.config.ts (next-intl plugin) and src/lib/env.ts (typed env validation)</name>
  <read_first>
    - .planning/phases/01-fundament/01-CONTEXT.md (D-12, D-14, D-15 — Upstash + BullMQ env requirements)
    - .planning/phases/01-fundament/01-RESEARCH.md §Project Setup → next.config.ts (lines 401–413)
    - .planning/phases/01-fundament/01-RESEARCH.md §Project Setup → Environment variables (lines 445–491)
    - .planning/phases/01-fundament/01-RESEARCH.md (the BullMQ/Upstash gotcha note at lines 491–492 — REDIS_URL separate from UPSTASH_REDIS_REST_URL)
  </read_first>
  <files>
    next.config.ts
    src/lib/env.ts
    .env.example
    src/middleware.ts
  </files>
  <behavior>
    - Test 1 (unit): `import { env } from '@/lib/env'` throws at module-load time when DATABASE_URL is unset
    - Test 2 (unit): `env.NEXT_PUBLIC_DEFAULT_LOCALE` defaults to `'nl'` when unset
    - Test 3 (unit): all required env keys are present in `.env.example` (parsed file content vs schema keys)
    - Test 4 (build smoke): `next build` errors out when required env keys are missing (validates plugin wiring)
  </behavior>
  <action>
    Create `next.config.ts` exactly per RESEARCH §Project Setup:
    ```ts
    import createNextIntlPlugin from 'next-intl/plugin';
    const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

    export default withNextIntl({
      reactStrictMode: true,
      poweredByHeader: false,
      serverExternalPackages: ['pino', 'pino-pretty', 'bullmq', 'ioredis', 'postgres'],
      experimental: { typedRoutes: true },
    });
    ```

    Create `src/lib/env.ts` exactly per RESEARCH §Environment variables (lines 447–488). Server schema MUST include:
    - `DATABASE_URL: z.string().url()` (Supabase pooler, port 6543)
    - `DIRECT_DATABASE_URL: z.string().url()` (port 5432, used by Drizzle Kit migrations)
    - `BETTER_AUTH_SECRET: z.string().min(32)`
    - `BETTER_AUTH_URL: z.string().url()`
    - `UPSTASH_REDIS_REST_URL: z.string().url()` (D-12)
    - `UPSTASH_REDIS_REST_TOKEN: z.string().min(20)` (D-12)
    - `REDIS_URL: z.string().url()` (BullMQ ioredis, separate per gotcha — D-15)
    - `RESEND_API_KEY: z.string().min(1)` (Resend EU-region; Plan 06)
    - `EMAIL_FROM: z.string().email()` (verified sender, e.g. `noreply@vttl.be`)
    - `SENTRY_DSN: z.string().url().optional()`
    - `LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info')`
    - `NODE_ENV: z.enum(['development','test','production']).default('development')`
    - `MEDICAL_ENCRYPTION_KEY: z.string().min(32)` (pgcrypto symmetric key, used by Plan 03)
    - `LOGFLARE_API_KEY: z.string().optional()`, `LOGFLARE_SOURCE: z.string().optional()` (Plan 13)

    Client schema:
    - `NEXT_PUBLIC_APP_URL: z.string().url()`
    - `NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['nl','en','fr']).default('nl')`

    Skeleton `src/middleware.ts` (next-intl middleware — body filled in Plan 07):
    ```ts
    // Placeholder — full implementation in Plan 01-07-next-intl-routing-and-catalogs
    export { default } from 'next-intl/middleware';
    export const config = { matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'] };
    ```
    NOTE: this will fail to import until Plan 07 creates `src/i18n/routing.ts`. That is acceptable — `npm run build` is NOT required to succeed at this point (Plan 07 closes the loop in Wave 3). The placeholder establishes the file path so Plan 05 (Better Auth) and Plan 11 (CallerContext) can reference it. Add a comment in the file noting "Wave 3 dependency: requires src/i18n/routing.ts".

    Create `.env.example` documenting every key with example values:
    ```
    # Supabase (Plan 01-02 provisions; Plan 16 pushes schema)
    DATABASE_URL=postgres://postgres:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
    DIRECT_DATABASE_URL=postgres://postgres:password@db.<project>.supabase.co:5432/postgres
    # Better Auth
    BETTER_AUTH_SECRET=<32-char-random-secret>
    BETTER_AUTH_URL=http://localhost:3000
    # Upstash (Plan 09)
    UPSTASH_REDIS_REST_URL=https://eu1-<name>.upstash.io
    UPSTASH_REDIS_REST_TOKEN=<token-from-upstash-console>
    REDIS_URL=rediss://default:<password>@eu1-<name>.upstash.io:6379
    # Email (Plan 06 — Resend EU-region; verify domain in Resend dashboard with SPF/DKIM/DMARC)
    RESEND_API_KEY=re_<key-from-resend-console>
    EMAIL_FROM=noreply@vttl.be
    # Observability (Plan 13)
    SENTRY_DSN=
    LOGFLARE_API_KEY=
    LOGFLARE_SOURCE=
    LOG_LEVEL=info
    # GDPR (Plan 03)
    MEDICAL_ENCRYPTION_KEY=<32-char-symmetric-key>
    # Public
    NEXT_PUBLIC_APP_URL=http://localhost:3000
    NEXT_PUBLIC_DEFAULT_LOCALE=nl
    ```

    Write tests in `tests/unit/env.test.ts`:
    ```ts
    import { describe, it, expect, beforeEach, vi } from 'vitest';

    describe('env validation', () => {
      it('exposes typed env when all required vars present', async () => {
        // mock process.env then dynamic import to trigger validation
      });

      it('reads NEXT_PUBLIC_DEFAULT_LOCALE default of nl', () => {
        // assert default applied
      });

      it('.env.example documents every required key', async () => {
        const fs = await import('fs/promises');
        const example = await fs.readFile('.env.example', 'utf-8');
        for (const key of [
          'DATABASE_URL','DIRECT_DATABASE_URL','BETTER_AUTH_SECRET','BETTER_AUTH_URL',
          'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','REDIS_URL',
          'MEDICAL_ENCRYPTION_KEY','NEXT_PUBLIC_APP_URL'
        ]) {
          expect(example).toMatch(new RegExp(`^${key}=`, 'm'));
        }
      });
    });
    ```
    Note: This test needs the Wave-0 vitest config from Plan 17. Mark as RED until Plan 17 lands.
  </action>
  <verify>
    <automated>test -f next.config.ts && test -f src/lib/env.ts && test -f .env.example && grep -q "createNextIntlPlugin" next.config.ts && grep -q "DATABASE_URL: z.string().url()" src/lib/env.ts && grep -q "REDIS_URL: z.string().url()" src/lib/env.ts && grep -q "MEDICAL_ENCRYPTION_KEY" src/lib/env.ts && grep -q "^DATABASE_URL=" .env.example && grep -q "^REDIS_URL=" .env.example && grep -q "^MEDICAL_ENCRYPTION_KEY=" .env.example</automated>
  </verify>
  <acceptance_criteria>
    - `next.config.ts` contains `createNextIntlPlugin('./src/i18n/request.ts')`
    - `next.config.ts` `serverExternalPackages` array literally contains: `'pino'`, `'pino-pretty'`, `'bullmq'`, `'ioredis'`, `'postgres'`
    - `src/lib/env.ts` server schema contains all 14 server keys listed in <action>
    - `src/lib/env.ts` exports a `const env` (not function — runtime-validated on first import)
    - `.env.example` documents EVERY key from `src/lib/env.ts` server + client schemas (grep each one)
    - `tests/unit/env.test.ts` exists with 3 tests (RED until Plan 17 completes vitest config)
  </acceptance_criteria>
  <done>Env validation gate established; missing required vars cause build failure; .env.example documents the contract.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Configure ESLint custom rules + Drizzle Kit + Prettier</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Project Setup → .eslintrc.json (lines 415–443)
    - .planning/phases/01-fundament/01-RESEARCH.md §Drizzle Kit config (lines 493–508)
    - .planning/phases/01-fundament/01-RESEARCH.md §Upstash + BullMQ → forbidden imports note (lines 1195–1204) — ESLint must block direct @upstash/redis outside lib/cache.ts
    - CLAUDE.md (Conventions / Stack section — guards we are encoding)
  </read_first>
  <files>
    .eslintrc.json
    drizzle.config.ts
  </files>
  <action>
    Create `.eslintrc.json` exactly per RESEARCH §Project Setup → .eslintrc.json with these rules:

    ```json
    {
      "extends": ["next/core-web-vitals", "next/typescript"],
      "rules": {
        "no-restricted-syntax": [
          "error",
          {
            "selector": "NewExpression[callee.name='Date'][arguments.length=0]",
            "message": "Use Date.now() or db.timestamptz default. Naive new Date() forbidden — see GDPR-08."
          }
        ],
        "no-restricted-imports": [
          "error",
          {
            "paths": [
              { "name": "moment", "message": "Use date-fns instead." },
              { "name": "@supabase/supabase-js", "message": "Phase 1 stack lock: connect via postgres URL only — Drizzle ORM. No Supabase JS SDK in app code (RISK-SUPABASE-LOCK)." },
              { "name": "@upstash/redis", "importNames": ["Redis"], "message": "Use lib/cache.ts. Direct Upstash API forbidden by D-14." }
            ],
            "patterns": [
              { "group": ["**/messages/*"], "message": "Import message catalogs only via next-intl helpers (useTranslations, getTranslations)." }
            ]
          }
        ]
      },
      "overrides": [
        {
          "files": ["src/lib/cache.ts", "src/server/trpc/middleware/rateLimit.ts"],
          "rules": { "no-restricted-imports": "off" }
        },
        {
          "files": ["**/*.test.ts", "tests/**/*.ts", "scripts/**/*.ts"],
          "rules": { "no-restricted-syntax": "off" }
        },
        {
          "files": ["src/components/consent/consent-step.tsx"],
          "rules": { "react/no-danger": "off" }
        }
      ]
    }
    ```

    Note: the `no-restricted-imports` override allowlists `lib/cache.ts` AND `middleware/rateLimit.ts` — both legitimately use `@upstash/redis` directly. Tests and scripts may use bare `new Date()` for fixtures.

    Create `drizzle.config.ts` exactly per RESEARCH §Drizzle Kit config:
    ```ts
    import 'dotenv/config';
    import { defineConfig } from 'drizzle-kit';

    export default defineConfig({
      schema: './src/server/db/schema/index.ts',
      out: './drizzle',
      dialect: 'postgresql',
      dbCredentials: { url: process.env.DIRECT_DATABASE_URL! },
      verbose: true,
      strict: true,
      migrations: { table: 'drizzle_migrations', schema: 'public' },
    });
    ```

    Note: `./src/server/db/schema/index.ts` does not exist yet — Plan 02 creates it. `drizzle.config.ts` references the path; Drizzle Kit fails gracefully until then. That is intended (Plan 02 will run `npx drizzle-kit generate` for the first time).

    Create empty placeholder `src/server/db/schema/index.ts` with content `export {};` so `drizzle-kit generate --help` does not crash on missing file. Plan 02 fills this with real schema imports.
  </action>
  <verify>
    <automated>test -f .eslintrc.json && test -f drizzle.config.ts && test -f src/server/db/schema/index.ts && grep -q "no-restricted-syntax" .eslintrc.json && grep -q "Naive new Date" .eslintrc.json && grep -q "@supabase/supabase-js" .eslintrc.json && grep -q "@upstash/redis" .eslintrc.json && grep -q "RISK-SUPABASE-LOCK" .eslintrc.json && grep -q "DIRECT_DATABASE_URL" drizzle.config.ts && grep -q "drizzle_migrations" drizzle.config.ts && grep -q "src/lib/cache.ts" .eslintrc.json && grep -q "src/components/consent/consent-step.tsx" .eslintrc.json && npm run lint 2>&1 | tee /tmp/lint.log; grep -qE "^(✔|0 errors|✓|All files pass linting)" /tmp/lint.log || ! grep -q "error" /tmp/lint.log</automated>
  </verify>
  <acceptance_criteria>
    - `.eslintrc.json` contains `"no-restricted-syntax"` array entry blocking zero-arg `new Date()`
    - `.eslintrc.json` contains `"@supabase/supabase-js"` in `no-restricted-imports.paths` with the RISK-SUPABASE-LOCK message
    - `.eslintrc.json` contains `"@upstash/redis"` block targeting `importNames: ["Redis"]`
    - `.eslintrc.json` `overrides` array allowlists `src/lib/cache.ts` and `src/server/trpc/middleware/rateLimit.ts`
    - `.eslintrc.json` `overrides` array allowlists `src/components/consent/consent-step.tsx` for `react/no-danger` (MINOR-18 — controlled HTML from public/locales/consent-*.html, not user-generated)
    - `drizzle.config.ts` references `process.env.DIRECT_DATABASE_URL` (NOT pooler `DATABASE_URL`)
    - `drizzle.config.ts` sets `migrations.table` to `'drizzle_migrations'`
    - `src/server/db/schema/index.ts` exists (even if empty `export {};` placeholder for Plan 02)
    - `npm run lint` exits with code 0 (no source files yet to fail rules)
  </acceptance_criteria>
  <done>ESLint rules enforce CLAUDE.md conventions at lint time; Drizzle Kit config points at direct DB URL for migrations.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Build environment ↔ runtime | `.env.example` documents the secrets contract; build fails if missing |
| Source code ↔ external SDKs | ESLint blocks unauthorised imports (Supabase JS SDK, direct Upstash Redis) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-06 | Information Disclosure | Logs / source code (PII leakage prep) | mitigate | ESLint `no-restricted-syntax` blocks naive `new Date()` (forces UTC helper); `no-restricted-imports` blocks `@supabase/supabase-js` (vendor lock-in / leak surface). Pino redact ships in Plan 13. |
| T-01-CFG | Tampering | Env vars at build time | mitigate | `@t3-oss/env-nextjs` validates types and presence; build fails if a required key is missing — eliminates "deployed without DATABASE_URL" foot-guns. |
</threat_model>

<verification>
- `npm install` completes with no peer-dep errors
- `npx tsc --noEmit` exits 0
- `npm run lint` exits 0
- `.env.example` is committed (NOT gitignored)
- Future plans can `import { env } from '@/lib/env'` and get typed access
- Future plans can `import * as schema from '@/server/db/schema'` (empty re-export today, real schema in Plan 02)
</verification>

<success_criteria>
- Next.js 15.3 + Drizzle 0.45 + Better Auth 1.6 + next-intl 4.11 + Upstash 1.37 + BullMQ 5.76 + pino 10 in package.json
- TypeScript strict mode + noUncheckedIndexedAccess on
- Env validation runtime gate (build fails if required env missing)
- ESLint enforces: no `new Date()`, no `@supabase/supabase-js`, no direct `@upstash/redis` outside `lib/cache.ts`
- Drizzle Kit config ready for Plan 02 (Migration 001)
- `.env.example` committed as the secrets contract
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-01-SUMMARY.md` documenting:
- Final exact dependency versions installed (`npm list --depth=0`)
- Any version drift from RESEARCH (e.g., Better Auth peer-dep forced different patch)
- Confirmation that `npx tsc --noEmit` and `npm run lint` both exit 0
- Notes on the `src/middleware.ts` placeholder — Plan 07 must close it
</output>
