# Phase 1: Fundament — Research

**Researched:** 2026-05-01
**Domain:** Auth + RBAC + Postgres RLS + GDPR schema + i18n infrastructure (Next.js 15 / Drizzle / Better Auth / Supabase Postgres / Upstash / next-intl)
**Confidence:** HIGH (stack locked in CONTEXT.md; package versions verified against npm registry on 2026-05-01)

---

## Summary

Phase 1 lays every foundation rail the seven downstream phases run on: Better Auth login + session, tRPC `CallerContext` middleware, Drizzle schema for users/roles/lookups/consent/audit, PostgreSQL RLS policies (with the canonical `players_visible_to(caller_id, caller_role)` SECURITY DEFINER function), Upstash Redis for rate-limit/JWT-revocation/BullMQ, pino + Sentry observability, next-intl in nl/en/fr, and a thin TD admin UI for user/parent-link/trainer-academy management.

The technical risk is concentrated in three places. First, RLS performance: deeply nested `EXISTS` policies become N² under realistic data, so policies must lean on the `players_visible_to()` function (one stable plan) rather than ad-hoc joins. Second, CallerContext freshness: scope-inperking must be sub-millisecond (Redis revocation list checked per request); scope-uitbreiding is allowed up to 15 minutes stale. Third, i18n drift: with three locales and a fail-loud dev fallback, the NL brontekst must be locked before migration 001 and EN/FR translations must keep pace with each new key.

**Primary recommendation:** Plan Phase 1 as **eight parallel-able task tracks** (Setup & Tooling; Drizzle Schema + RLS; Better Auth + Email Templates; CallerContext + tRPC Bootstrap; Upstash + BullMQ + Rate-Limit; next-intl; Observability + Health; TD Admin UI), each with a verifiable exit criterion. The 35-test rol×resource matrix and the SQL-direct RLS test are non-negotiable Phase-1 exit gates.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**A. Locale-switcher UX**
- **D-01:** Taalkiezer rechtsboven in de header op elke pagina (incl. login en wachtwoordreset). Compact dropdown-component met **wereldbol-icoon** (lucide `Globe`) en tweeletterige locale-code (NL/EN/FR). Op viewport < 768px verhuist de switcher naar het hamburger-menu — icoon blijft zichtbaar in de header als hint.
- **D-02:** Anonieme bezoekers krijgen locale via Accept-Language detectie (fallback `nl`); switcher wijzigt session-cookie. Na login wordt de keuze gepersisteerd op `users.preferred_locale` en overschrijft alle volgende sessies van die gebruiker.
- **D-03:** Locale-wissel direct effectief zonder pagina-refresh — `next-intl` provider re-rendert client-side. Server-side translations gebruiken de nieuwe locale bij de eerstvolgende request.

**B. Consent-tekst versionering & juridische review-timing**
- **D-04:** NL-brontekst voor alle drie consent-categorieën (operationele data, medische verwerking, foto/video-gebruik) wordt vóór migratie 001 gelockt en juridisch ondertekend. Hard gate.
- **D-05:** EN/FR-vertalingen parallel met implementatie; juridische verificatie EN/FR uiterlijk Fase 8. EN/FR in dev/staging beschikbaar maar productie-livegang per locale vereist juridische sign-off voor die taal.
- **D-06:** `consent_records` schema bevat `policy_version` (semver), `locale` (`nl|en|fr`), en `consent_text_snapshot` (volledige tekst zoals getoond) — NIET een FK naar policies-tabel. GDPR-bewijs vereist exacte tekst-snapshot.
- **D-07:** Bij majeure tekstwijziging (DPA-update, juridische correctie) wordt re-consent geforceerd via banner; minor wijziging (typo) = alleen versie-bump op nieuwe consents.

**C. CallerContext caching strategie**
- **D-08:** `CallerContext = { userId, role, academyIds[], linkedPlayerIds[], locale }` in JWT-claim bij login + bij expliciete invalidatie. Max staleness **15 minuten**. Vervalt bij JWT-expiry; ververst bij re-auth voor SEC-03.
- **D-09:** Scope-inperking → Redis-revocation-lijst (Upstash, key `revoked:{user_id}` met TTL = JWT-expiry). tRPC-middleware checkt elk request — sub-ms lookup. Gerevokeerde JWT = 401 + force re-auth.
- **D-10:** Scope-uitbreiding = max 15 min stale, geen revocation.
- **D-11:** 35 integratietests (7 rollen × 5 resources) verplicht vóór Fase 2; falen blokkeert merge.

**D. Rate limit + Redis backend**
- **D-12:** **Upstash Redis (managed, EU-regio)** = gedeelde primitive voor rate limiting, JWT-revocation, BullMQ queue, optionele dashboard-cache. Connectie via `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` als Coolify-secrets.
- **D-13:** tRPC rate-limit-middleware: 100 req/min per user, 1000 req/min per IP (SEC-07); 10 uploads/min per user, 100/dag (SEC-08); 1 broadcast/uur per user, max 5 platformbreed (SEC-09). Implementatie via `@upstash/ratelimit` sliding-window.
- **D-14:** Vendor-lock-in mitigatie: alle Redis-toegang achter `lib/cache.ts` interface. Geen Upstash-specifieke API's (HASH, PUBSUB) zonder review.

**E. Async job queue**
- **D-15:** **BullMQ op Upstash** in Fase 1 — worker-process-template + één voorbeeld-job (consent-versie-bump notificatie). Worker draait als apart Coolify-service (`web` + `worker`); zelfde codebase, andere entrypoint.
- **D-16:** Eerste echte productie-jobs in Fase 5 (medical-read-audit) en Fase 6 (group-message fan-out). Template moet beide patterns dragen: korte taken (< 1s) en burst-jobs (honderden in batch).

**F. Health endpoints**
- **D-17:** `/api/health/live` (process-only, voor UptimeRobot) + `/api/health/ready` (DB + Redis, voor Coolify deploy-gate). Beide JSON met component-status.

**G. i18n-fundament**
- **D-18:** `next-intl` als enige i18n-laag; `messages/{nl,en,fr}.json` in repo. Fase 1-scope: auth/registratie/consent/error-chrome strings.
- **D-19:** Lookup-codes language-neutraal in DB (`status_a`, `tournament_wtt_star`); display-labels via i18n-keys. Eigennamen (academies, clubs, personen) niet vertaald.
- **D-20:** Dev = fail-loud fallback (`MISSING_KEY:nl.auth.login.title`); productie = graceful (locale → nl → key-naam). CI-gate (I18N-10) blokkeert deploys vanaf Fase 8.

### Claude's Discretion

- Concrete naamgeving migration-files, tRPC-router-organisatie, file-tree-structuur (`src/app/`, `src/server/`, `src/lib/i18n/`)
- Exacte schema-namen lookup-tabellen (snake_case)
- BullMQ worker concurrency en retry-policy (sensible defaults: concurrency 5, retry 3× exp backoff)
- Sentry `beforeSend` PII-stripper-regels (geïnformeerd door pino-redact-config)
- Coolify-deployment configuratiedetails (gezondheidscheck-paden, secrets-mapping)

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- Magic-link login (Better Auth ondersteunt; v1 = e-mail+wachtwoord) — v1.1
- 2FA/TOTP — v1.1 voor TD-account
- OAuth (Google/Microsoft) — v2
- Audit-log viewer UI — Fase 7 of v1.1
- Rate-limit per role (TD hoger) — v1 uniform
- Live-reload locale-strings (CMS) — v2
- Cookie-consent banner — niet nodig (alleen first-party functional cookies)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Email+password login + session across browser restarts | Better Auth `emailAndPassword` plugin; cookie session 30d (Section 4) |
| AUTH-02 | Password reset via email link | Better Auth `sendResetPassword` hook + i18n template (Section 4, 8) |
| AUTH-03 | Session carries CallerContext (role + academy scoping) | tRPC middleware + JWT claim (Section 5) |
| AUTH-04 | TD can create/activate/deactivate accounts | `admin.user.*` tRPC router (Section 12) |
| AUTH-05 | TD can assign and change roles | `admin.user.assignRole` mutation (Section 12) |
| USER-01 | TD can link parent → player | `parent_child_links` table + admin.user.linkParent (Section 3, 12, 14) |
| USER-02 | TD can link trainer → academies | `trainer_academy_links` junction (Section 3, 12) |
| USER-03 | TD can link sparring partner → sessions | Schema only in Phase 1; flow Phase 5 |
| USER-04 | Per-role scope enforcement | RLS policies + CallerContext (Section 4, 5) |
| USER-05 | Enforced at API + DB layer | tRPC middleware + Postgres RLS (Section 4, 5) |
| GDPR-01 | Layered consent at registration with version | `consent_records` + multi-step register flow (Section 9) |
| GDPR-02 | Belgian minor consent (< 16 needs parent) | `pending_minor_users` + parent-link gate (Section 14) |
| GDPR-03 | Medical isolated tables + audit on read | Migration 002 + `medicalProcedure` middleware (Section 3, 4, CRIT-7) |
| GDPR-04 | Audit log on every medical read | `medical_access_audit` + async BullMQ writer (Section 3, 6, CRIT-7) |
| GDPR-07 | Medical can be deleted independently | Erasure design doc + delete path (Section 3) |
| GDPR-08 | TIMESTAMPTZ + IANA tz | Drizzle helper `timestamptz()` + lint rule (Section 3) |
| SEC-01 | Cookies httpOnly/Secure/SameSite=Lax | Better Auth defaults verified (Section 4) |
| SEC-02 | CSRF on state-changing mutations | Better Auth `trustedOrigins` + tRPC pattern (Section 4) |
| SEC-03 | Re-auth for sensitive actions | `freshSession` middleware (Section 4, 5) |
| SEC-04 | Auth tokens never logged | pino redact (Section 10) |
| SEC-05 | Reset 1h, magic 15min, single-use | Better Auth config (Section 4) |
| SEC-06 | 5 failed logins / 15min lockout | Better Auth `accountLockout` (Section 4) |
| SEC-07 | API rate limit 100/u/min, 1000/IP/min | `@upstash/ratelimit` (Section 6) |
| SEC-08 | File upload 10/min, 100/dag | Same primitive (Section 6) |
| SEC-09 | Broadcast 1/u/uur, 5 concurrent | Same primitive (Section 6) |
| OPS-01 | pino structured logging + redact | Section 10 |
| OPS-02 | Retention 30/90/2190 days | Document + log-aggregator config (Section 10) |
| OPS-03 | External log aggregator EU | Logflare or Axiom EU (Section 10) |
| OPS-04 | Latency/duration/query/error metrics | Drizzle interceptor + tRPC timing (Section 10) |
| OPS-05 | Slow-query log @ 500ms | Supabase `log_min_duration_statement` (Section 10) |
| OPS-06 | Alerts: error rate, p95, DB sat | Better Stack rules (Section 10) |
| MIG-01 | Drizzle migrations versioned + immutable | Drizzle Kit conventions (Section 13) |
| MIG-02 | Expand-contract pattern | Worked example NOT-NULL add (Section 13) |
| MIG-03 | Backfill 1000 rows / 100ms | `lib/migrate/backfill.ts` utility (Section 13) |
| MIG-04 | Test against prod-sized staging | Coolify staging gate (Section 13) |
| MIG-05 | Rollback procedure documented | Per-migration `.md` template (Section 13) |
| I18N-01 | nl/en/fr UI + persisted preference | next-intl + `users.preferred_locale` (Section 7) |
| I18N-02 | `users.preferred_locale` enum NOT NULL | Schema (Section 3) |
| I18N-03 | Resolution chain explicit→cookie→header→nl | Middleware (Section 7) |
| I18N-04 | Transactional email per locale | Better Auth + per-locale templates (Section 8) |
| I18N-05 | Lookup-codes language-neutral | Schema convention (Section 3) |
| I18N-07 | Intl/date-fns nl-BE/en-GB/fr-BE, week=Mon | next-intl formats config (Section 7) |
| I18N-09 | Versioned consent text per locale | `consent_records.consent_text_snapshot` (Section 9) |
| I18N-11 | Backend logs/source remain English | pino redact already English; convention (Section 10) |

---

## Project Constraints (from CLAUDE.md)

| Directive | Source | How Plans Must Honor It |
|-----------|--------|------------------------|
| Multilingual UI nl/en/fr from Phase 1 | CLAUDE.md Constraints | All user-facing strings in catalogs; persisted preference (I18N-02) |
| Backend logs + source code English | CLAUDE.md Constraints | pino redact + ESLint custom rule blocking non-ASCII identifiers |
| Medical data + parent-child + role scoping technically enforced | CLAUDE.md Constraints | RLS at DB layer (USER-05); CallerContext middleware |
| Consent tracking versioned per locale; legal review per language | CLAUDE.md Constraints | `consent_records` + D-04..07 |
| Lookups centrally managed, NOT free-text | CLAUDE.md Constraints | Lookup tables in Migration 001 |
| Authorization at API/data layer, not soft | CLAUDE.md Constraints | tRPC middleware + RLS; 35-test matrix gate |
| GSD workflow enforcement | CLAUDE.md GSD section | Every change via /gsd-execute-phase, /gsd-quick, or /gsd-debug |
| Stack locked: Next.js 15.x + Drizzle + Better Auth + Supabase Pg + Upstash + Coolify/Hetzner | CLAUDE.md Stack | Plans use these libraries; alternatives forbidden |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authentication (login/logout/session) | Frontend Server (Next.js Route Handler) | Database (sessions table) | Better Auth runs server-side; cookie set by server; sessions persisted in Postgres |
| Authorization (CallerContext, RLS) | API (tRPC middleware) | Database (RLS policies) | Defense in depth: middleware first (fast), DB last (mandatory backstop) |
| Consent capture | Frontend Server (form action) | Database (consent_records) | Server captures snapshot text + IP at submit time |
| Medical data access | API (medicalProcedure) | Database (RLS + isolated table) | tRPC middleware writes audit async; RLS prevents direct query bypass |
| Locale resolution | Frontend Server (middleware) | Database (preferred_locale) | next-intl middleware on every request; DB stores persistent pref |
| Rate limiting | API (tRPC middleware) | Edge (Upstash REST) | Per-request check before any business logic |
| JWT revocation check | API (tRPC middleware) | Edge (Upstash REST) | Sub-ms Redis lookup per authenticated request |
| File uploads (profile, medical) | API (Route Handler) | Storage (Supabase Storage) | Server validates magic bytes; signed URLs only — Phase 2+ |
| Async job execution | Worker process (separate Coolify service) | Edge (Upstash Redis queue) | BullMQ pulls from Upstash; isolated from web tier |
| Health checks | Frontend Server (Route Handler) | Database + Edge | `/live` is process-only; `/ready` probes DB + Redis |
| Audit log writes | API (tRPC middleware) | Worker (async via BullMQ) | Synchronous for security-critical (consent); async for read-audit (medical Phase 5) |
| Email sending (verify, reset) | Frontend Server (Better Auth hook) | External (Mailgun/SendGrid EU) | Server triggers; provider does delivery |
| Observability | Frontend Server + Worker (pino) | External (Logflare/Axiom EU) | Local pino emits JSON; external aggregator stores + queries |
| TD user-management UI | Browser/Client (RSC + Server Action) | API (tRPC admin router) | Server Components for read; Server Actions or tRPC mutations for write |

---

## Standard Stack

### Core (verified versions, npm registry 2026-05-01)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `^16.2.4` (latest) — pin to `^15.3` per CLAUDE.md until verified | Frontend framework + Route Handlers | App Router + Server Components; Better Auth supports Next.js 14/15/16 |
| `react`, `react-dom` | `^19.2.5` | UI runtime | Pairs with Next.js 15+ |
| `typescript` | `^5.5+` (latest `5.100.7`, but pin minor) | Type safety | Strict mode enforced |
| `better-auth` | `^1.6.9` | Auth + session + email-and-password | All data in own Postgres; plugin system; Drizzle adapter |
| `drizzle-orm` | `^0.45.2` | TypeScript ORM, SQL-first | Drizzle 0.45 = current stable; no binary engine |
| `drizzle-kit` | `^0.31.10` | Migration generator | Versioned migration files |
| `postgres` | `^3.4.9` | Postgres driver (or `pg ^8.x`) | `postgres` library preferred for Drizzle (faster, native arrays) |
| `next-intl` | `^4.11.0` | i18n for App Router | RSC-aware; locale routing; ICU messages |
| `@upstash/redis` | `^1.37.0` | REST client for Upstash | Stateless HTTP; works in Node + Edge |
| `@upstash/ratelimit` | `^2.0.8` | Sliding-window rate limit | Built on @upstash/redis |
| `bullmq` | `^5.76.4` | Job queue | Best-in-class Node queue; needs ioredis (NOT Upstash REST — see warning below) |
| `ioredis` | `^5.10.1` | TCP Redis client (BullMQ requirement) | BullMQ uses persistent connections; cannot use REST |
| `pino` | `^10.3.1` | Structured logging | JSON output; redact filter; very fast |
| `pino-pretty` | `^13.1.3` | Dev-only pretty printing | Disabled in prod |
| `@sentry/nextjs` | `^10.51.0` | Error tracking EU | EU region via DSN; `beforeSend` for PII strip |
| `@trpc/server` `@trpc/client` `@trpc/react-query` | `^11.17.0` | API layer | E2E typesafe; middleware for CallerContext |
| `@tanstack/react-query` | `^5.100.7` | Server-state cache | Required by tRPC react-query adapter |
| `zod` | `^4.4.1` | Runtime validation | Shared schemas client+server |
| `react-hook-form` | `^7.74.0` | Form state | Pairs with Zod via `@hookform/resolvers/zod` |
| `date-fns` | `^4.1.0` (or `^3.x` per CLAUDE.md) | Date formatting + locales | nl-BE, en-GB, fr-BE locales bundled |
| `@t3-oss/env-nextjs` | `^0.13.11` | Typed env validation | Fails build if env missing |
| `file-type` | `^22.0.1` | Magic-byte file validation (Phase 2 prep) | Schema scaffolding only in Phase 1 |
| `nanoid` | `^5.1.11` | UUID alt for non-PK ids (e.g., idempotency) | Or stick to `crypto.randomUUID()` |

### Supporting (Dev-only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `^4.x` (Better Auth peers `^2 || ^3 || ^4`) — pin `^3.x` for stability | Unit + integration tests | Fast; ESM-native |
| `@playwright/test` | `^1.59.1` | E2E browser tests | Login flow, locale switch, register-with-consent flow |
| `@testcontainers/postgresql` | `^11.14.0` | Ephemeral Postgres for tests | RLS-direct tests; integration suites |
| `eslint`, `eslint-config-next` | `^10.2.1`, `^16.2.4` | Linting | Custom rules for i18n + UTC-only dates |
| `tsx` | latest | Run TS scripts (migrations, backfill) | Drizzle Kit, BullMQ worker entrypoint |

### Alternatives Considered (already rejected by stack lock — for reference only)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Better Auth | Lucia v3 | Lucia is in maintenance-only as of mid-2025; Better Auth is the active successor |
| Drizzle | Prisma | Prisma binary engine adds cold-start latency; harder to audit raw SQL — already rejected in CLAUDE.md |
| `@upstash/redis` for BullMQ | Upstash REST + custom queue | BullMQ needs Lua scripts + blocking polls — REST cannot do this. **Use ioredis for BullMQ; @upstash/redis for ratelimit/revocation.** |
| next-intl | react-i18next | next-i18next lacks RSC support; CLAUDE.md already locks next-intl |
| Pino | Winston | Winston ~5x slower; no built-in redact-by-path — CLAUDE.md locks pino |

**Installation (one-shot):**

```bash
npm install next@^15.3 react@^19 react-dom@^19 typescript@^5.5 \
  better-auth@^1.6 \
  drizzle-orm@^0.45 postgres@^3.4 \
  next-intl@^4.11 \
  @upstash/redis@^1.37 @upstash/ratelimit@^2.0 \
  bullmq@^5.76 ioredis@^5.10 \
  pino@^10 \
  @sentry/nextjs@^10 \
  @trpc/server@^11 @trpc/client@^11 @trpc/react-query@^11 @tanstack/react-query@^5 \
  zod@^4 react-hook-form@^7 @hookform/resolvers@^5 \
  date-fns@^4 \
  @t3-oss/env-nextjs@^0.13 \
  file-type@^22 nanoid@^5

npm install -D drizzle-kit@^0.31 \
  vitest@^3 @playwright/test@^1.59 @testcontainers/postgresql@^11 \
  eslint@^10 eslint-config-next@^16 \
  tsx pino-pretty@^13
```

**Important compatibility note (HIGH confidence — npm peerDependencies):** Better Auth `^1.6.9` peers list `next: ^14.0.0 || ^15.0.0 || ^16.0.0` and `drizzle-orm: ^0.45.2`. Pin Drizzle ORM exactly to a version in `^0.45.x` until Better Auth's peer range widens.

---

## Project Setup

### File-tree (concrete — for the planner)

```
vttl-topsport/
├── .env.local                    # gitignored
├── .env.example                  # committed; documents required keys
├── .eslintrc.json                # next/core-web-vitals + custom rules
├── package.json
├── tsconfig.json
├── next.config.ts                # next-intl plugin wrapper
├── drizzle.config.ts             # Drizzle Kit config (points to Supabase URL)
├── coolify.json                  # optional Coolify service hints
├── messages/
│   ├── nl.json                   # default; lock vóór migration 001 (D-04)
│   ├── en.json
│   └── fr.json
├── public/
│   └── locales/                  # consent text PDFs/HTML — versioned
│       ├── consent-operational-1.0.0.nl.html
│       ├── consent-operational-1.0.0.en.html
│       └── consent-operational-1.0.0.fr.html
├── drizzle/                      # generated migrations — NEVER edited
│   ├── 0000_initial.sql
│   ├── 0001_medical_isolated.sql
│   ├── 0002_idempotency_keys.sql
│   └── meta/
└── src/
    ├── app/
    │   ├── [locale]/             # next-intl locale segment
    │   │   ├── layout.tsx        # NextIntlClientProvider wrapper
    │   │   ├── (auth)/
    │   │   │   ├── login/page.tsx
    │   │   │   ├── register/page.tsx
    │   │   │   ├── reset-password/page.tsx
    │   │   │   └── verify-email/page.tsx
    │   │   ├── (app)/
    │   │   │   ├── layout.tsx    # auth-required layout
    │   │   │   └── admin/
    │   │   │       └── users/page.tsx
    │   │   └── page.tsx          # landing
    │   ├── api/
    │   │   ├── auth/[...all]/route.ts   # Better Auth handler
    │   │   ├── trpc/[trpc]/route.ts     # tRPC handler
    │   │   └── health/
    │   │       ├── live/route.ts
    │   │       └── ready/route.ts
    │   └── global-error.tsx
    ├── i18n/
    │   ├── routing.ts            # defineRouting({ locales, defaultLocale })
    │   ├── request.ts            # getRequestConfig — server-side messages
    │   └── navigation.ts         # Link/redirect/usePathname wrappers
    ├── server/
    │   ├── auth/
    │   │   ├── auth.ts           # betterAuth({ ... }) export
    │   │   ├── client.ts         # createAuthClient for RSC + Client
    │   │   └── permissions.ts    # role → permission matrix
    │   ├── db/
    │   │   ├── client.ts         # postgres + drizzle export
    │   │   ├── schema/
    │   │   │   ├── index.ts      # barrel
    │   │   │   ├── auth.ts       # users, sessions, accounts (Better Auth)
    │   │   │   ├── lookups.ts    # status, academy, tournament_type, etc.
    │   │   │   ├── memberships.ts # academy_memberships, parent_child_links
    │   │   │   ├── consent.ts
    │   │   │   ├── audit.ts
    │   │   │   ├── medical.ts    # medical_events, medical_documents, medical_access_audit
    │   │   │   └── idempotency.ts
    │   │   ├── helpers/
    │   │   │   ├── timestamps.ts # timestamptz() helper enforcing UTC
    │   │   │   └── encryption.ts # pgp_sym_encrypt/decrypt wrappers
    │   │   └── rls/
    │   │       ├── functions.sql      # players_visible_to(...)
    │   │       └── policies.sql       # CREATE POLICY ...  (referenced from migrations)
    │   ├── trpc/
    │   │   ├── trpc.ts           # initTRPC, createContext
    │   │   ├── middleware/
    │   │   │   ├── auth.ts       # requireAuth — pulls CallerContext
    │   │   │   ├── rateLimit.ts
    │   │   │   ├── freshSession.ts # SEC-03
    │   │   │   ├── rls.ts        # SET LOCAL app.user_id, app.user_role
    │   │   │   └── audit.ts
    │   │   └── routers/
    │   │       ├── _app.ts       # appRouter
    │   │       ├── auth.ts
    │   │       ├── admin.ts      # admin.user.* — TD UI
    │   │       └── consent.ts
    │   ├── workers/
    │   │   ├── index.ts          # worker entrypoint (Coolify service)
    │   │   ├── queues.ts         # Queue + QueueEvents instances
    │   │   └── jobs/
    │   │       └── consent-version-bump.ts  # example job
    │   └── email/
    │       ├── send.ts           # Mailgun/SendGrid wrapper
    │       └── templates/
    │           ├── verify-email/
    │           │   ├── nl.tsx
    │           │   ├── en.tsx
    │           │   └── fr.tsx
    │           ├── password-reset/{nl,en,fr}.tsx
    │           └── magic-link/{nl,en,fr}.tsx
    ├── lib/
    │   ├── env.ts                # @t3-oss/env-nextjs
    │   ├── cache.ts              # Redis abstraction (D-14)
    │   ├── log.ts                # pino instance + redact
    │   ├── sentry.ts             # init helpers
    │   ├── i18n-format.ts        # date/number/list formatters per locale
    │   └── consent.ts            # current policy_version registry
    ├── components/
    │   ├── ui/                   # shadcn/ui generated
    │   ├── auth/
    │   │   ├── login-form.tsx
    │   │   └── register-form.tsx
    │   ├── consent/
    │   │   ├── consent-step.tsx
    │   │   └── re-consent-banner.tsx
    │   └── i18n/
    │       └── locale-switcher.tsx  # lucide Globe + dropdown (D-01)
    ├── middleware.ts             # next-intl + auth gating
    └── tests/
        ├── setup.ts              # testcontainers Postgres bootstrap
        ├── integration/
        │   └── rbac-matrix.test.ts  # 35 rol×resource tests (D-11)
        ├── rls/
        │   └── medical-isolation.test.ts  # SQL-direct RLS proof
        └── e2e/
            ├── auth.spec.ts
            ├── locale-switcher.spec.ts
            └── register-with-consent.spec.ts
```

### TypeScript / Next.js / ESLint config

**`tsconfig.json`** — strict mode mandatory:

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

**`next.config.ts`** — wrap with next-intl plugin:

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

**`.eslintrc.json`** — custom rules to enforce CLAUDE.md constraints:

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "NewExpression[callee.name='Date'][arguments.length=0]",
        "message": "Use Date.now() or db.timestamptz default. Naive new Date() forbidden — see GDPR-08."
      },
      {
        "selector": "MemberExpression[object.name='Date'][property.name='now']",
        "message": "Use the timestamp helper in lib/time.ts (UTC-clock-safe)."
      }
    ],
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          { "name": "moment", "message": "Use date-fns instead." },
          { "name": "@supabase/supabase-js", "message": "Phase 1 stack lock: connect via postgres URL only — Drizzle ORM. No Supabase JS SDK in app code (RISK-SUPABASE-LOCK)." }
        ]
      }
    ]
  }
}
```

### Environment variables (`src/lib/env.ts`)

```ts
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),                   // Supabase Postgres URL (pooler, port 6543)
    DIRECT_DATABASE_URL: z.string().url(),            // Non-pooler URL (port 5432) for migrations
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(20),
    REDIS_URL: z.string().url(),                      // ioredis URL (BullMQ — separate Upstash TCP/TLS endpoint OR self-hosted)
    MAILGUN_API_KEY: z.string().optional(),
    MAILGUN_DOMAIN: z.string().optional(),
    SENDGRID_API_KEY: z.string().optional(),          // either Mailgun OR SendGrid
    SENTRY_DSN: z.string().url().optional(),
    LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
    NODE_ENV: z.enum(['development','test','production']).default('development'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['nl','en','fr']).default('nl'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
    MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
    MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  },
});
```

**Critical Upstash + BullMQ pitfall [VERIFIED: BullMQ docs + Upstash docs]:** BullMQ requires a persistent TCP Redis connection (Lua scripts, blocking commands like `BRPOPLPUSH`) — it **does not work with `@upstash/redis` REST**. Use ioredis pointing at Upstash's `rediss://` endpoint (TLS-on-TCP) — Upstash exposes this for Node/Bun workers. Coolify-secrets need both: `UPSTASH_REDIS_REST_URL`/`TOKEN` for ratelimit + revocation, AND `REDIS_URL` (the `rediss://default:<password>@<host>:6379` form) for BullMQ.

### Drizzle Kit config (`drizzle.config.ts`)

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL! }, // bypass pooler for migrations
  verbose: true,
  strict: true,
  migrations: { table: 'drizzle_migrations', schema: 'public' },
});
```

---

## Drizzle Schema Patterns (Migration 001)

### TIMESTAMPTZ helper (`src/server/db/helpers/timestamps.ts`)

```ts
import { timestamp } from 'drizzle-orm/pg-core';

/** Always TIMESTAMPTZ; defaults to NOW() in UTC. Never use `timestamp()` without `withTimezone: true`. */
export const tstz = (name: string, opts?: { defaultNow?: boolean }) => {
  const col = timestamp(name, { withTimezone: true, mode: 'date' });
  return opts?.defaultNow ? col.defaultNow() : col;
};
```

ESLint custom rule: forbid `timestamp(...)` without `withTimezone: true` outside this helper.

### Lookup table convention

```ts
// src/server/db/schema/lookups.ts
import { pgTable, text, integer, boolean, primaryKey } from 'drizzle-orm/pg-core';

/** Lookup tables: code is a stable language-neutral string (snake_case).
 *  Display labels live in messages/{locale}.json under `lookups.<table>.<code>`. */

export const status = pgTable('status', {
  code: text('code').primaryKey(),       // 'status_a' | 'status_b' | 'status_c'
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const academy = pgTable('academy', {
  code: text('code').primaryKey(),       // 'topsportschool', 'academy_antwerpen', ...
  canonicalName: text('canonical_name').notNull(),  // proper noun — NOT translated (I18N-06)
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const tournamentType = pgTable('tournament_type', {
  code: text('code').primaryKey(),       // 'tournament_wtt', 'tournament_wtt_star', ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const rankingType = pgTable('ranking_type', {
  code: text('code').primaryKey(),       // 'ranking_senior_world', 'ranking_belgium', ...
  direction: text('direction').notNull(),  // 'asc_is_better' | 'desc_is_better' (DOM-3 / RISK-02)
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const trainingType = pgTable('training_type', {
  code: text('code').primaryKey(),       // 'training_type_group', 'training_type_individual', ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const organisation = pgTable('organisation', {
  code: text('code').primaryKey(),       // 'org_private', 'org_kbttb', ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const outcomeLevel = pgTable('outcome_level', {
  code: text('code').primaryKey(),       // 'outcome_winner', 'outcome_finalist', 'outcome_last_4', ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});
```

### Users + sessions (Better Auth-aligned)

Better Auth's Drizzle adapter auto-generates `user`, `session`, `account`, `verification` table shapes. The planner must run `npx @better-auth/cli generate` against `auth.ts`, then **extend** the user table — never override columns Better Auth manages.

```ts
// src/server/db/schema/auth.ts — extends Better Auth shape
import { pgTable, text, boolean, uuid, pgEnum, date, varchar } from 'drizzle-orm/pg-core';
import { tstz } from '../helpers/timestamps';

export const localeEnum = pgEnum('locale', ['nl', 'en', 'fr']);
export const userRoleEnum = pgEnum('user_role', [
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(),                   // canonical proper noun
  image: text('image'),                           // profile photo URL (Phase 2)
  role: userRoleEnum('role').notNull().default('player'),
  preferredLocale: localeEnum('preferred_locale').notNull().default('nl'),  // I18N-02
  dateOfBirth: date('date_of_birth'),             // NOT NULL once player flow exists; nullable in Phase 1 for TD/staff users
  active: boolean('active').notNull().default(false),  // TD activates explicitly (AUTH-04)
  deactivatedAt: tstz('deactivated_at'),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: tstz('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  freshUntil: tstz('fresh_until'),                // SEC-03 — re-auth window
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),       // 'credential' for email+password
  accountId: text('account_id').notNull(),
  password: text('password'),                      // hash, scrypt by default in Better Auth
  // ... OAuth fields nullable, unused in v1
});

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),                  // token
  expiresAt: tstz('expires_at').notNull(),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
});
```

### Memberships + parent-child links

```ts
// src/server/db/schema/memberships.ts
import { pgTable, uuid, text, primaryKey, unique } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { academy } from './lookups';
import { tstz } from '../helpers/timestamps';

export const academyMemberships = pgTable('academy_memberships', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  academyCode: text('academy_code').notNull().references(() => academy.code, { onDelete: 'restrict' }),
  role: text('role').notNull(),  // 'trainer' | 'academy_manager' | 'player' (player only assigned in Phase 2)
  linkedAt: tstz('linked_at', { defaultNow: true }).notNull(),
  linkedBy: uuid('linked_by').references(() => users.id),  // who created the link (TD)
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.academyCode, t.role] }),
}));

export const parentChildLinks = pgTable('parent_child_links', {
  parentUserId: uuid('parent_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  childUserId: uuid('child_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  consentGivenAt: tstz('consent_given_at').notNull(),  // Belgian Art. 8 — parent consents
  linkedAt: tstz('linked_at', { defaultNow: true }).notNull(),
  linkedBy: uuid('linked_by').references(() => users.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.parentUserId, t.childUserId] }),
  uniqueChildIfMinor: unique('uniq_child_user').on(t.childUserId),  // a minor has exactly one consenting parent (BE)
}));
```

### Consent records (D-04..07, GDPR-01, I18N-09)

```ts
// src/server/db/schema/consent.ts
import { pgTable, uuid, text, varchar, inet } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { tstz } from '../helpers/timestamps';

/** GDPR proof: each row carries the EXACT TEXT shown to user at consent time (D-06).
 *  No FK to a policies table — snapshot is the authoritative legal record. */
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  consentCategory: text('consent_category').notNull(),  // 'operational' | 'medical_processing' | 'photo_video'
  policyVersion: varchar('policy_version', { length: 32 }).notNull(),  // semver, e.g. '1.0.0'
  locale: text('locale').notNull(),                      // 'nl' | 'en' | 'fr' — language at consent time
  consentTextSnapshot: text('consent_text_snapshot').notNull(),  // FULL text shown at consent time
  consentTextSha256: varchar('consent_text_sha256', { length: 64 }).notNull(),  // tamper-evidence
  givenAt: tstz('given_at', { defaultNow: true }).notNull(),
  withdrawnAt: tstz('withdrawn_at'),                     // null = active
  consentingPartyUserId: uuid('consenting_party_user_id').references(() => users.id),  // self OR parent (Belgian < 16)
  ipAddress: inet('ip_address').notNull(),
  userAgent: text('user_agent').notNull(),
});
```

### Audit log + medical access audit (CRIT-7, CRIT-8)

```ts
// src/server/db/schema/audit.ts
import { pgTable, uuid, text, jsonb, inet, bigserial } from 'drizzle-orm/pg-core';
import { tstz } from '../helpers/timestamps';

/** General append-only audit log. App user has INSERT-only privileges (enforced by Postgres role separation, see RLS section). */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  actorUserId: uuid('actor_user_id'),         // null for system actions
  action: text('action').notNull(),            // 'login' | 'role_change' | 'consent_given' | ...
  resourceType: text('resource_type'),         // 'user' | 'consent_record' | 'medical_event' | ...
  resourceId: text('resource_id'),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),               // correlation id from middleware
  outcome: text('outcome').notNull().default('success'),  // 'success' | 'denied' | 'error'
  occurredAt: tstz('occurred_at', { defaultNow: true }).notNull(),
});

/** Dedicated medical access audit (CRIT-8). Separate so retention policy and read access can differ. */
export const medicalAccessAudit = pgTable('medical_access_audit', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  actorUserId: uuid('actor_user_id').notNull(),
  subjectPlayerId: uuid('subject_player_id').notNull(),
  recordType: text('record_type').notNull(),   // 'medical_event' | 'medical_document'
  recordId: uuid('record_id'),
  action: text('action').notNull(),            // 'read' | 'write' | 'export' | 'delete'
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  outcome: text('outcome').notNull().default('success'),
  occurredAt: tstz('occurred_at', { defaultNow: true }).notNull(),
});
```

### Idempotency keys (Migration 003 — VALID-08)

```ts
// src/server/db/schema/idempotency.ts
import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { tstz } from '../helpers/timestamps';

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),                      // client-supplied UUID
  userId: uuid('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull(),               // tRPC procedure name
  responseHash: text('response_hash'),                // hash of stored response for replay safety
  responseBody: jsonb('response_body'),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  expiresAt: tstz('expires_at').notNull(),            // created_at + 24h
});
```

### Medical isolation (Migration 002 — GDPR-03/04/07, CRIT-2)

```ts
// src/server/db/schema/medical.ts
import { pgTable, uuid, text, date, boolean, customType } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { tstz } from '../helpers/timestamps';

/** pgcrypto-encrypted text. Reads decrypt via SQL function decrypt_medical(text). */
const encryptedText = customType<{ data: string; driverData: Buffer }>({
  dataType() { return 'bytea'; },
  toDriver(value) { return Buffer.from(`pgp_sym_encrypt('${value.replace(/'/g, "''")}', current_setting('app.medical_key'))::bytea`); },
  fromDriver(value) { return value.toString(); },
});

export const medicalEvents = pgTable('medical_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerUserId: uuid('player_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // Free-text fields encrypted at column level via pgcrypto:
  eventDescriptionCipher: text('event_description_cipher').notNull(),    // bytea base64
  doctorCipher: text('doctor_cipher'),
  isInjury: boolean('is_injury').notNull().default(false),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  deletedAt: tstz('deleted_at'),  // soft-delete; hard-delete on GDPR-07 erasure
});

export const medicalDocuments = pgTable('medical_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  medicalEventId: uuid('medical_event_id').references(() => medicalEvents.id, { onDelete: 'cascade' }),
  playerUserId: uuid('player_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  storageKey: text('storage_key').notNull().unique(),  // UUID-prefixed path in Supabase Storage 'medical/' bucket (Phase 5 fills this; schema ready in Phase 1)
  originalFilenameCipher: text('original_filename_cipher').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: text('size_bytes').notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  uploadedAt: tstz('uploaded_at', { defaultNow: true }).notNull(),
  scanStatus: text('scan_status').notNull().default('pending'),  // 'pending' | 'clean' | 'quarantined'
  deletedAt: tstz('deleted_at'),
});
```

### Soft-delete + updated_at trigger conventions

```sql
-- in 0000_initial.sql, run AFTER table creation
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_medical_events_updated_at BEFORE UPDATE ON medical_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- repeat for every mutable table
```

---

## PostgreSQL RLS in Drizzle Migrations

Drizzle 0.45 supports RLS in code via `pgPolicy()` and `enableRLS()` helpers. For Phase 1, write the policies as raw SQL in migration files (more readable for legal/security review) but **call them from Drizzle migration scripts** (so they are versioned and auditable).

### Two-role Postgres model

Supabase gives one default `postgres` role. For RLS-correct deployments, create **two roles**:

```sql
-- Run as Supabase project owner (one-time, in 0000_initial.sql)
CREATE ROLE app_user LOGIN PASSWORD '<from-env>';
CREATE ROLE app_audit_writer LOGIN PASSWORD '<from-env>' INHERIT;

-- Schema privileges
GRANT USAGE ON SCHEMA public TO app_user, app_audit_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- audit_log + medical_access_audit: INSERT only for app_user, NO UPDATE/DELETE
REVOKE UPDATE, DELETE ON audit_log FROM app_user;
REVOKE UPDATE, DELETE ON medical_access_audit FROM app_user;
GRANT INSERT ON audit_log TO app_user;
GRANT INSERT ON medical_access_audit TO app_user;
-- TD-only read happens through SECURITY DEFINER function (see below)
```

### `players_visible_to()` SECURITY DEFINER function (CRIT-3 strengthened)

```sql
-- 0000_initial.sql — single source of truth for player visibility (PITFALLS-ADDITIONS.md)
CREATE OR REPLACE FUNCTION players_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(player_user_id UUID) AS $$
  -- Player sees self
  SELECT id FROM users WHERE id = caller_id AND caller_role = 'player'

  UNION

  -- Parent sees own child (BE Art. 8: < 16 only — but link is explicit, age check at registration)
  SELECT child_user_id FROM parent_child_links
   WHERE parent_user_id = caller_id AND caller_role = 'parent'

  UNION

  -- Trainer / academy_manager: sees players in same academies as the caller
  SELECT pa.user_id
    FROM academy_memberships pa
    JOIN academy_memberships ca ON ca.academy_code = pa.academy_code
   WHERE ca.user_id = caller_id
     AND ca.role IN ('trainer', 'academy_manager')
     AND pa.role = 'player'
     AND caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Technical director sees all
  SELECT id FROM users WHERE caller_role = 'technical_director'

  -- Sparring partner: scope filled in Phase 5 (session_sparring_partners + calendar_event_participants)
  -- For Phase 1 this UNION branch returns no rows; placeholder kept for forward compat:
  UNION
  SELECT NULL::UUID WHERE FALSE;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- The function is SECURITY DEFINER so it can bypass RLS on the lookup tables it queries.
-- Grant EXECUTE only to app roles:
GRANT EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) TO app_user;
REVOKE EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) FROM PUBLIC;
```

### Caller-context session variables

Each tRPC request sets these on its DB transaction:

```sql
-- inside the per-request transaction (set by tRPC middleware — see Section 5)
SELECT set_config('app.user_id', '<uuid>', true);  -- 'true' = local to transaction
SELECT set_config('app.user_role', '<role>', true);
SELECT set_config('app.request_id', '<correlation-id>', true);
```

### Concrete RLS policies (excerpts)

```sql
-- USERS: each user reads own row; TD reads all
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;  -- applies even to table owner

CREATE POLICY users_self_or_td ON users FOR SELECT
  USING (
    id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.user_role', true) = 'technical_director'
  );

CREATE POLICY users_td_writes ON users FOR INSERT
  WITH CHECK (current_setting('app.user_role', true) = 'technical_director');

CREATE POLICY users_self_or_td_updates ON users FOR UPDATE
  USING (id = current_setting('app.user_id', true)::uuid OR current_setting('app.user_role', true) = 'technical_director')
  WITH CHECK (id = current_setting('app.user_id', true)::uuid OR current_setting('app.user_role', true) = 'technical_director');

-- SESSIONS: only the session owner reads it
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner ON sessions FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- PARENT_CHILD_LINKS: parent reads own, child reads their links, TD reads all
ALTER TABLE parent_child_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_child_links FORCE ROW LEVEL SECURITY;
CREATE POLICY pcl_visible ON parent_child_links FOR SELECT
  USING (
    parent_user_id = current_setting('app.user_id', true)::uuid
    OR child_user_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.user_role', true) = 'technical_director'
  );
CREATE POLICY pcl_td_writes ON parent_child_links FOR INSERT
  WITH CHECK (current_setting('app.user_role', true) = 'technical_director');

-- CONSENT_RECORDS: user reads own, TD reads all; INSERT only by self or TD; NEVER UPDATE/DELETE (snapshot is legal record)
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_visible ON consent_records FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid
         OR current_setting('app.user_role', true) = 'technical_director');
CREATE POLICY consent_inserts ON consent_records FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid
              OR consenting_party_user_id = current_setting('app.user_id', true)::uuid);
-- Withdrawal flow uses an UPDATE on `withdrawn_at` only, not full row update:
CREATE POLICY consent_withdraw ON consent_records FOR UPDATE
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- MEDICAL_EVENTS: visibility goes through players_visible_to() AND requires medical role
ALTER TABLE medical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_events FORCE ROW LEVEL SECURITY;
CREATE POLICY medical_events_read ON medical_events FOR SELECT
  USING (
    player_user_id = current_setting('app.user_id', true)::uuid                            -- self
    OR current_setting('app.user_role', true) IN ('technical_director', 'medical_staff')   -- privileged
    OR (
      current_setting('app.user_role', true) = 'parent'
      AND player_user_id IN (SELECT child_user_id FROM parent_child_links
                              WHERE parent_user_id = current_setting('app.user_id', true)::uuid)
    )
    -- NOTE: trainer role does NOT see medical_events here; they see only the traffic-light
    -- via a separate VIEW (Phase 5: medical_injury_status_for_trainers) — see MED-04
  );

CREATE POLICY medical_events_write ON medical_events FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) IN ('technical_director', 'medical_staff')
    OR player_user_id = current_setting('app.user_id', true)::uuid
  );

-- MEDICAL_ACCESS_AUDIT: TD reads via dedicated SECURITY DEFINER function only; app_user has INSERT-only
ALTER TABLE medical_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_access_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY maa_no_select ON medical_access_audit FOR SELECT USING (false);   -- block all direct SELECT
CREATE POLICY maa_insert ON medical_access_audit FOR INSERT WITH CHECK (true);

CREATE OR REPLACE FUNCTION query_medical_access_audit(p_subject UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS SETOF medical_access_audit AS $$
  SELECT * FROM medical_access_audit
   WHERE subject_player_id = p_subject AND occurred_at BETWEEN p_from AND p_to
   ORDER BY occurred_at DESC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;

-- IDEMPOTENCY_KEYS: user reads own
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_owner ON idempotency_keys FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
```

### RLS performance tactics (RISK-RLS-PERF, CRIT-8)

[VERIFIED: Postgres 16 docs + Supabase RLS perf guide]

1. **`current_setting('app.user_id', true)` is volatile per session — but `STABLE` when wrapped:** wrap in a `STABLE` SQL function so the planner can hoist it out of the row loop:
   ```sql
   CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
     SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
   $$ LANGUAGE SQL STABLE;
   ```
   Then use `current_user_id()` inside policies — this prevents per-row re-evaluation on large scans.

2. **Indexes for RLS lookups:**
   ```sql
   CREATE INDEX idx_pcl_parent ON parent_child_links (parent_user_id);
   CREATE INDEX idx_pcl_child ON parent_child_links (child_user_id);
   CREATE INDEX idx_am_user_role ON academy_memberships (user_id, role);
   CREATE INDEX idx_am_academy_role ON academy_memberships (academy_code, role);
   CREATE INDEX idx_medical_events_player ON medical_events (player_user_id);
   CREATE INDEX idx_consent_user ON consent_records (user_id);
   ```

3. **Cap policy nesting at 1–2 EXISTS levels** (RISK-RLS-PERF). For 3+ deep, use the `players_visible_to()` function (single STABLE call, planner caches result for the query).

4. **Plan-test:** include an `EXPLAIN (ANALYZE, BUFFERS)` test in the Phase 1 RLS suite that asserts no Seq Scan on `medical_events` for a TD reading 1 player's records out of 200.

---

## CallerContext Middleware (tRPC)

### Context shape

```ts
// src/server/trpc/trpc.ts
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { Session, User } from '@/server/auth/auth';

export type CallerContext = {
  session: Session | null;
  user: User | null;
  // Cached scope from JWT claim (D-08); refreshed at login + on explicit invalidation
  scope: {
    userId: string;
    role: 'technical_director' | 'academy_manager' | 'trainer' | 'player' | 'parent' | 'sparring_partner' | 'medical_staff';
    academyIds: string[];      // codes from academy lookup
    linkedPlayerIds: string[]; // child_user_ids from parent_child_links
    locale: 'nl' | 'en' | 'fr';
    issuedAt: number;          // unix-ms — used for staleness check
    fresh: boolean;            // SEC-03 — true within freshSession window
  } | null;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  log: import('pino').Logger;
};

const t = initTRPC.context<CallerContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
```

### `requireAuth` middleware (D-08, D-09 — Redis revocation check)

```ts
// src/server/trpc/middleware/auth.ts
import { TRPCError } from '@trpc/server';
import { middleware } from '../trpc';
import { cache } from '@/lib/cache';

const STALENESS_MS = 15 * 60 * 1000; // D-08

export const requireAuth = middleware(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.scope) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  // D-09 revocation check — sub-ms Upstash REST GET
  const revoked = await cache.get(`revoked:${ctx.scope.userId}`);
  if (revoked) {
    ctx.log.info({ userId: ctx.scope.userId, reason: revoked }, 'auth.revoked');
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'session_revoked' });
  }

  // Staleness — D-08
  if (Date.now() - ctx.scope.issuedAt > STALENESS_MS) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'scope_stale' });
  }

  return next({ ctx: { ...ctx, scope: ctx.scope } });
});
```

### `withRlsContext` middleware — sets Postgres session vars

```ts
// src/server/trpc/middleware/rls.ts
import { middleware } from '../trpc';
import { db } from '@/server/db/client';
import { sql } from 'drizzle-orm';

/** Wraps the handler in a transaction with app.user_id / app.user_role set. */
export const withRlsContext = middleware(async ({ ctx, next }) => {
  if (!ctx.scope) return next();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.scope!.userId}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_role', ${ctx.scope!.role}, true)`);
    await tx.execute(sql`SELECT set_config('app.request_id', ${ctx.requestId}, true)`);
    return next({ ctx: { ...ctx, db: tx } });
  });
});
```

### `requireRole` and `requireFreshSession` (SEC-03)

```ts
// src/server/trpc/middleware/freshSession.ts
import { TRPCError } from '@trpc/server';
import { middleware } from '../trpc';

export const requireRole = (...roles: CallerContext['scope']['role'][]) =>
  middleware(({ ctx, next }) => {
    if (!ctx.scope || !roles.includes(ctx.scope.role)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next({ ctx });
  });

export const requireFreshSession = middleware(({ ctx, next }) => {
  if (!ctx.scope?.fresh) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 're_auth_required' });
  }
  return next({ ctx });
});

// Procedure presets:
export const protectedProcedure = publicProcedure.use(requireAuth).use(withRlsContext);
export const tdProcedure = protectedProcedure.use(requireRole('technical_director'));
export const sensitiveProcedure = protectedProcedure.use(requireFreshSession);
```

### JWT claim structure (Better Auth + custom hooks)

Better Auth's session table stores the canonical session; the cached scope (D-08) is loaded from `users` + `academy_memberships` + `parent_child_links` at login and serialized into a signed JWT cookie alongside the session cookie. The planner should put scope-loading in a `databaseHooks.session.create.after` hook (Better Auth pattern).

---

## Upstash + BullMQ + Rate-Limit (`lib/cache.ts`)

### Abstraction (D-14 — vendor-lock-in mitigation)

```ts
// src/lib/cache.ts
import { Redis } from '@upstash/redis';
import { env } from './env';

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
}

class UpstashCache implements Cache {
  private client = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

  async get(key: string) { const v = await this.client.get<string>(key); return v ?? null; }
  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.client.set(key, value, { ex: ttlSeconds });
    else await this.client.set(key, value);
  }
  async del(key: string) { await this.client.del(key); }
  async incr(key: string, ttlSeconds?: number) {
    const v = await this.client.incr(key);
    if (v === 1 && ttlSeconds) await this.client.expire(key, ttlSeconds);
    return v;
  }
}

export const cache: Cache = new UpstashCache();
```

**Forbidden** (D-14): direct calls to `client.hset`, `client.publish`, `client.xadd`, `client.lua` outside this file. ESLint rule:

```json
{
  "no-restricted-imports": [
    "error",
    { "paths": [{ "name": "@upstash/redis", "importNames": ["Redis"], "message": "Use lib/cache.ts. Direct Upstash API forbidden by D-14." }] }
  ]
}
```

### Rate-limit middleware (SEC-07/08/09)

```ts
// src/server/trpc/middleware/rateLimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { TRPCError } from '@trpc/server';
import { middleware } from '../trpc';
import { env } from '@/lib/env';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

const perUser = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(100, '1 m'), prefix: 'rl:user', analytics: true,
});
const perIp = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(1000, '1 m'), prefix: 'rl:ip',
});
const fileUpload = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(10, '1 m'), prefix: 'rl:upload:min',
});
const fileUploadDay = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(100, '1 d'), prefix: 'rl:upload:day',
});
const broadcast = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(1, '1 h'), prefix: 'rl:broadcast',
});

export const rateLimit = (kind: 'user' | 'upload' | 'broadcast') =>
  middleware(async ({ ctx, next }) => {
    const userKey = ctx.scope?.userId ?? `anon:${ctx.ipAddress}`;
    const ipKey = ctx.ipAddress;

    const [u, i] = await Promise.all([perUser.limit(userKey), perIp.limit(ipKey)]);
    if (!u.success || !i.success) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    if (kind === 'upload') {
      const [m, d] = await Promise.all([fileUpload.limit(userKey), fileUploadDay.limit(userKey)]);
      if (!m.success || !d.success) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    if (kind === 'broadcast') {
      const b = await broadcast.limit(userKey);
      if (!b.success) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });

      // Platform-wide max 5 concurrent (SEC-09): track active broadcasts in Redis SET
      const active = await redis.scard('broadcasts:active');
      if (active >= 5) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'platform_broadcast_limit' });
    }
    return next();
  });
```

### BullMQ worker template

```ts
// src/server/workers/queues.ts
import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@/lib/env';

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,    // BullMQ requirement [VERIFIED: BullMQ docs]
  enableReadyCheck: false,
});

export const consentNotifyQueue = new Queue('consent-notify', { connection });
export const consentNotifyEvents = new QueueEvents('consent-notify', { connection });

// src/server/workers/index.ts — Coolify entrypoint: `node --import tsx ./src/server/workers/index.ts`
import { Worker } from 'bullmq';
import { processConsentVersionBump } from './jobs/consent-version-bump';
import { connection } from './queues';
import { log } from '@/lib/log';

const consentWorker = new Worker(
  'consent-notify',
  async (job) => processConsentVersionBump(job.data),
  {
    connection,
    concurrency: 5,
    autorun: true,
    settings: { backoffStrategy: (n) => Math.min(2 ** n * 1000, 30_000) },
  },
);

consentWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'job.failed'));
consentWorker.on('completed', (job) => log.info({ jobId: job.id }, 'job.completed'));

process.on('SIGTERM', async () => {
  log.info('worker.shutdown');
  await consentWorker.close();
  process.exit(0);
});
```

**Coolify configuration (D-15):** two services backed by the same git repo:
- `web` — `npm run start` (Next.js server)
- `worker` — `node --import tsx ./src/server/workers/index.ts`

Both share env vars; only `worker` needs `REDIS_URL` (BullMQ TCP). Both need `DATABASE_URL` (worker writes audit rows, sends emails).

### Job idempotency (D-16, HIGH-12)

```ts
// src/server/workers/jobs/consent-version-bump.ts
import { db } from '@/server/db/client';
import { consentRecords, users } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { sendEmail } from '@/server/email/send';

export async function processConsentVersionBump(data: { userId: string; oldVersion: string; newVersion: string }) {
  // Idempotent guard: if a row already exists for this user+newVersion, skip
  const existing = await db.query.consentRecords.findFirst({
    where: and(
      eq(consentRecords.userId, data.userId),
      eq(consentRecords.policyVersion, data.newVersion),
    ),
  });
  if (existing) return { skipped: true };

  const user = await db.query.users.findFirst({ where: eq(users.id, data.userId) });
  if (!user) return { skipped: true, reason: 'user_not_found' };

  await sendEmail({
    to: user.email,
    locale: user.preferredLocale,
    template: 'consent-version-bump',
    data: { oldVersion: data.oldVersion, newVersion: data.newVersion },
  });

  return { sent: true };
}
```

---

## next-intl App Router Setup

### Routing config (`src/i18n/routing.ts`)

```ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['nl', 'en', 'fr'],
  defaultLocale: 'nl',
  localePrefix: { mode: 'as-needed' },  // /nl/x or /x for default; /en/x and /fr/x explicit
  localeDetection: true,                  // Accept-Language detection (D-02)
});

export type Locale = (typeof routing.locales)[number];
```

### Server-side message loader (`src/i18n/request.ts`)

```ts
import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import { cookies, headers } from 'next/headers';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

export default getRequestConfig(async ({ requestLocale }) => {
  // Resolution chain (I18N-03):
  // 1. explicit user pref (DB)
  // 2. session cookie (anonymous switcher)
  // 3. Accept-Language → routing locale
  // 4. default 'nl'

  let locale = await requestLocale;
  if (!hasLocale(routing.locales, locale)) locale = routing.defaultLocale;

  // 1. user pref
  const session = (await cookies()).get('better-auth.session_token')?.value;
  if (session) {
    // Lightweight: read userId from session, then preferred_locale; cache via React cache()
    const user = await getUserBySessionToken(session);
    if (user?.preferredLocale) locale = user.preferredLocale;
  } else {
    // 2. session cookie
    const cookieLocale = (await cookies()).get('locale')?.value;
    if (hasLocale(routing.locales, cookieLocale)) locale = cookieLocale;
    // 3. Accept-Language already factored by routing.localeDetection
  }

  // D-20 — fail-loud in dev, graceful in prod
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    onError(err) {
      if (process.env.NODE_ENV !== 'production') throw err; // fail-loud
    },
    getMessageFallback({ namespace, key }) {
      const path = `${namespace}.${key}`;
      if (process.env.NODE_ENV !== 'production') return `MISSING_KEY:${locale}.${path}`;
      return path;  // graceful in prod
    },
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
        long:  { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
      },
      number: {
        precise: { maximumFractionDigits: 5 },
      },
    },
    timeZone: 'Europe/Brussels',
  };
});

async function getUserBySessionToken(_token: string) { /* ... see Better Auth API */ return null as any; }
```

### Locale-specific date formats (I18N-07)

```ts
// src/lib/i18n-format.ts
import { format } from 'date-fns';
import { nlBE, enGB, frBE } from 'date-fns/locale';
import type { Locale } from '@/i18n/routing';

const locales = { nl: nlBE, en: enGB, fr: frBE } as const;

export const formatDate = (d: Date, locale: Locale, fmt = 'dd/MM/yyyy') =>
  format(d, fmt, { locale: locales[locale], weekStartsOn: 1 });   // Monday — I18N-07
```

### Middleware (`src/middleware.ts`)

```ts
import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match everything except api, trpc auth, _next, static, favicon
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

### Locale switcher component (D-01)

```tsx
// src/components/i18n/locale-switcher.tsx
'use client';
import { Globe } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select
      value={locale}
      onValueChange={(next) => {
        document.cookie = `locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
        router.replace(pathname, { locale: next as 'nl' | 'en' | 'fr' });
        // After login, server-action additionally writes users.preferred_locale (D-02)
      }}
    >
      <SelectTrigger className="w-[88px]" aria-label="Language">
        <Globe className="h-4 w-4 mr-1" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="nl">NL</SelectItem>
        <SelectItem value="en">EN</SelectItem>
        <SelectItem value="fr">FR</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

### `messages/nl.json` minimum surface for Phase 1

```json
{
  "auth": {
    "login": { "title": "Inloggen", "email": "E-mailadres", "password": "Wachtwoord", "submit": "Aanmelden" },
    "register": { "title": "Account aanmaken", "submit": "Registreren", "minorWarning": "Voor spelers jonger dan 16 jaar moet een ouder/voogd toestemming geven." },
    "resetPassword": { "title": "Wachtwoord opnieuw instellen", "submit": "Verzend e-mail" },
    "errors": {
      "invalidCredentials": "Onjuiste e-mail of wachtwoord",
      "lockoutTriggered": "Te veel mislukte pogingen. Probeer over 15 minuten opnieuw.",
      "sessionExpired": "Je sessie is verlopen. Log opnieuw in.",
      "rateLimited": "Te veel verzoeken. Wacht een minuut."
    }
  },
  "consent": {
    "title": "Toestemmingen",
    "operational": { "label": "Operationele gegevens (verplicht)", "version": "1.0.0" },
    "medicalProcessing": { "label": "Medische gegevensverwerking (optioneel)", "version": "1.0.0" },
    "photoVideo": { "label": "Foto- en videogebruik (optioneel)", "version": "1.0.0" },
    "submit": "Akkoord en doorgaan",
    "withdraw": "Toestemming intrekken",
    "reConsentRequired": "De voorwaarden zijn bijgewerkt. Bevestig opnieuw om door te gaan."
  },
  "lookups": {
    "status": { "status_a": "A-status", "status_b": "B-status", "status_c": "C-status" },
    "academy": { "topsportschool": "Topsportschool", "academy_antwerpen": "Academy Antwerpen" },
    "trainingType": { "training_type_group": "Groep", "training_type_individual": "Individueel", "training_type_physical": "Fysiek", "training_type_mental": "Mentaal" }
  },
  "common": {
    "save": "Opslaan", "cancel": "Annuleren", "delete": "Verwijderen", "loading": "Bezig met laden..."
  },
  "errors": {
    "generic": "Er ging iets mis. Probeer het opnieuw.",
    "forbidden": "Je hebt geen toegang tot deze pagina."
  }
}
```

`en.json` and `fr.json` mirror this structure with translations. CI gate (Phase 8) compares key sets.

---

## Better Auth Integration

### `src/server/auth/auth.ts`

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization } from 'better-auth/plugins';
import { db } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { env } from '@/lib/env';
import { sendEmailLocalized } from '@/server/email/send';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,                                       // require email verification before first login
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendEmailLocalized({
        to: user.email,
        template: 'password-reset',
        locale: (user as any).preferredLocale ?? 'nl',
        data: { resetUrl: url, expiresInMinutes: 60 },
      });
    },
    resetPasswordTokenExpiresIn: 60 * 60,                    // SEC-05: 1h
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60 * 24,                                  // 24h verify
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailLocalized({
        to: user.email,
        template: 'verify-email',
        locale: (user as any).preferredLocale ?? 'nl',
        data: { verifyUrl: url },
      });
    },
  },

  // SEC-01: cookie defaults — Better Auth sets httpOnly + Secure (in prod) + SameSite=Lax by default
  session: {
    expiresIn: 60 * 60 * 24 * 30,        // 30 days (AUTH-01: survives browser restart)
    updateAge: 60 * 60 * 24,              // refresh token cookie every 24h of activity
    cookieCache: { enabled: true, maxAge: 60 * 5 }, // 5 min in-memory cache
    freshAge: 60 * 60,                    // SEC-03: fresh window 1h
  },

  // SEC-02: CSRF
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],

  // SEC-06: lockout
  rateLimit: {
    enabled: true,
    window: 60 * 15,                     // 15 min
    max: 5,                              // 5 attempts (SEC-06)
  },

  // SEC-04: never log secrets — Better Auth honors logger.disabled patterns; pino redact handles app-level
  logger: { disabled: env.NODE_ENV === 'production' ? false : false, level: env.LOG_LEVEL },

  // Custom hook: load CallerContext scope into session
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // Eager-load scope arrays from DB and stash on session record (custom column or JWT)
          // The scope is rebuilt at every session refresh (D-08: 15-min staleness max)
          // Implementation: use cookies.set() with a separate signed JWT containing the scope
        },
      },
    },
  },

  plugins: [
    admin({ defaultRole: 'player', adminRoles: ['technical_director'] }),  // AUTH-04/05
    // organization({ ... }) — DEFERRED: VTTL is single-org; activate only if multi-academy isolation goes deeper
  ],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session['user'];
```

### Better Auth Drizzle adapter — generate schema first

```bash
npx @better-auth/cli generate --config src/server/auth/auth.ts --output drizzle/0000-better-auth.sql
```

This emits the canonical `user`, `session`, `account`, `verification` shapes. The planner extends them in `src/server/db/schema/auth.ts` with the VTTL columns (`role`, `preferred_locale`, `active`, etc.) — but never alters the columns Better Auth manages.

### Route handler

```ts
// src/app/api/auth/[...all]/route.ts
import { auth } from '@/server/auth/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth.handler);
```

### CSRF (SEC-02)

Better Auth's session cookie defaults to `SameSite=Lax`, which blocks most cross-site CSRF on state-changing requests. For tRPC mutations served from the same origin, this plus `trustedOrigins` is sufficient. **Verify** in audit:
1. `Set-Cookie` headers on `POST /api/auth/sign-in/email` include `HttpOnly; Secure; SameSite=Lax`.
2. tRPC mutation requests from a different origin return a Better Auth CSRF/origin error.

### Re-auth flow (SEC-03)

Endpoints protected by `requireFreshSession` middleware (parent-child link, medical view, GDPR export, erasure):
1. Client receives `FORBIDDEN: re_auth_required`.
2. UI redirects to `/[locale]/(auth)/re-auth?next=...`.
3. User re-enters password → `auth.api.signInEmail` → on success, Better Auth bumps `session.freshUntil`.
4. Client retries the original mutation.

---

## Email Templates (I18N-04)

### Provider config

Choose **Mailgun EU** or **SendGrid EU** — both have signed DPAs and EU data residency. Recommend Mailgun (simpler API, region selectable in dashboard). [VERIFIED: Mailgun docs — `https://api.eu.mailgun.net/v3/...`].

### `src/server/email/send.ts`

```ts
import { env } from '@/lib/env';
import type { Locale } from '@/i18n/routing';

type Template = 'verify-email' | 'password-reset' | 'magic-link' | 'consent-version-bump';

export async function sendEmailLocalized(args: {
  to: string;
  locale: Locale;
  template: Template;
  data: Record<string, unknown>;
}) {
  const subject = SUBJECTS[args.template][args.locale];
  const html = await renderTemplate(args.template, args.locale, args.data);

  const res = await fetch(`https://api.eu.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      from: `VTTL Topsport <noreply@vttl.be>`,
      to: args.to,
      subject,
      html,
      'h:Reply-To': 'support@vttl.be',
    }),
  });
  if (!res.ok) throw new Error(`mailgun_${res.status}`);
}

const SUBJECTS: Record<Template, Record<Locale, string>> = {
  'verify-email': { nl: 'Bevestig je e-mailadres', en: 'Verify your email', fr: 'Confirmez votre adresse e-mail' },
  'password-reset': { nl: 'Stel je wachtwoord opnieuw in', en: 'Reset your password', fr: 'Réinitialisez votre mot de passe' },
  'magic-link': { nl: 'Je inloglink', en: 'Your login link', fr: 'Votre lien de connexion' },
  'consent-version-bump': { nl: 'Bijgewerkte voorwaarden', en: 'Updated terms', fr: 'Conditions mises à jour' },
};

async function renderTemplate(template: Template, locale: Locale, data: Record<string, unknown>) {
  // React-email or simple string-template; plain string-template is sufficient for Phase 1
  const mod = await import(`./templates/${template}/${locale}`);
  return mod.render(data);
}
```

### Template structure

Each template = three files (`nl.tsx`, `en.tsx`, `fr.tsx`) exporting a `render(data)` function. Subject + body strings hard-coded in the template file (NOT in `messages/*.json`) so non-engineers can edit emails per locale without touching the i18n catalog.

---

## Consent Schema + Flow

### Policy version registry (`src/lib/consent.ts`)

```ts
import type { Locale } from '@/i18n/routing';

export const CURRENT_POLICY = {
  operational:        { version: '1.0.0' },
  medical_processing: { version: '1.0.0' },
  photo_video:        { version: '1.0.0' },
} as const;

export type ConsentCategory = keyof typeof CURRENT_POLICY;

/** Loads the EXACT text shown to the user. Must be deterministic — same locale + same version → same text always. */
export async function getConsentText(category: ConsentCategory, version: string, locale: Locale): Promise<string> {
  // public/locales/consent-{category}-{version}.{locale}.html — committed in repo
  const fs = await import('fs/promises');
  const path = await import('path');
  const file = path.resolve(process.cwd(), 'public', 'locales', `consent-${category}-${version}.${locale}.html`);
  return fs.readFile(file, 'utf-8');
}
```

### Registration flow (multi-step, GDPR-01/02)

1. **Step 1: Email + password + locale + DOB** → `auth.api.signUpEmail` (Better Auth creates `users` row, `email_verified=false`, `active=false`)
2. **Step 2: Locale + role hints** (player vs trainer vs parent — TD assigns final role later; AUTH-04)
3. **Step 3: Consents** — for each `ConsentCategory`:
   - Show full text from `getConsentText()` in the user's locale
   - Compute SHA-256 of the text shown
   - On submit → INSERT `consent_records` row with `consent_text_snapshot`, `consent_text_sha256`, `policy_version`, `locale`, `ip_address`, `user_agent`, `consenting_party_user_id = self.id`
4. **Step 4 (if DOB < 16 today):** show "Parent must consent" — user is created `active=false` with a row in `pending_minor_users (user_id, parent_email_invite, dob)`. Until a parent account is linked AND parent consent is recorded, the user **cannot log in**.
5. **TD activates** the account explicitly (AUTH-04) — separate panel.

### Belgian minor-consent enforcement (GDPR-02)

```ts
// src/server/db/schema/auth.ts — add a generated column
import { sql } from 'drizzle-orm';

export const usersExtended = pgTable('users', {
  // ... existing columns
  isMinor: boolean('is_minor').generatedAlwaysAs(
    sql`CASE WHEN date_of_birth IS NULL THEN NULL
             WHEN (CURRENT_DATE - date_of_birth) < INTERVAL '16 years' THEN TRUE
             ELSE FALSE END`,
    { mode: 'stored' },
  ),
});
```

Activation guard (server action):

```ts
// src/server/auth/activate.ts
export async function canActivate(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) return { ok: false, reason: 'not_found' };
  if (u.isMinor === true) {
    const link = await db.query.parentChildLinks.findFirst({ where: eq(parentChildLinks.childUserId, userId) });
    if (!link) return { ok: false, reason: 'parent_link_missing' };
    const parentConsent = await db.query.consentRecords.findFirst({
      where: and(
        eq(consentRecords.userId, userId),
        eq(consentRecords.consentingPartyUserId, link.parentUserId),
        eq(consentRecords.consentCategory, 'operational'),
        isNull(consentRecords.withdrawnAt),
      ),
    });
    if (!parentConsent) return { ok: false, reason: 'parent_consent_missing' };
  }
  // self-consent for adult OR parent-consent for minor must exist
  const ownConsent = await db.query.consentRecords.findFirst({
    where: and(eq(consentRecords.userId, userId), eq(consentRecords.consentCategory, 'operational'), isNull(consentRecords.withdrawnAt)),
  });
  if (!ownConsent) return { ok: false, reason: 'consent_missing' };
  return { ok: true };
}
```

### Consent withdrawal & re-consent (D-07)

- **Withdrawal:** `UPDATE consent_records SET withdrawn_at = now() WHERE id = ? AND user_id = current_user_id()` — RLS allows.
- **Re-consent banner trigger:** check at auth time — if `users.last_consent_check_at < CURRENT_POLICY[category].released_at` for any required category, show full-screen blocking banner (`<ReConsentBanner>`) until user re-confirms. Implementation:

```tsx
// src/components/consent/re-consent-banner.tsx
'use client';
// Renders modal that submits new consent_records row with current policy_version.
// Until success, all tRPC calls return FORBIDDEN: re_consent_required.
```

A tRPC middleware `requireCurrentConsent` runs on every protected procedure (except `consent.acknowledge`):

```ts
export const requireCurrentConsent = middleware(async ({ ctx, next }) => {
  if (!ctx.scope) return next();
  const stale = await db.execute(sql`
    SELECT 1 FROM (VALUES ('operational')) cats(cat)
    WHERE NOT EXISTS (
      SELECT 1 FROM consent_records cr
       WHERE cr.user_id = ${ctx.scope.userId}
         AND cr.consent_category = cats.cat
         AND cr.policy_version = ${CURRENT_POLICY.operational.version}
         AND cr.withdrawn_at IS NULL
    )
  `);
  if (stale.length > 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 're_consent_required' });
  }
  return next();
});
```

---

## Observability

### pino setup (`src/lib/log.ts`)

```ts
import pino from 'pino';
import { env } from './env';

export const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'vttl-topsport', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.email',
      '*.phone',
      '*.dateOfBirth',
      '*.ipAddress',
      '*.medical_*',
      '*.eventDescriptionCipher',
      '*.doctorCipher',
      '*.consentTextSnapshot',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
```

### Sentry init (`src/lib/sentry.ts`)

```ts
import * as Sentry from '@sentry/nextjs';
import { env } from './env';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  beforeSend(event) {
    // PII strip (CRIT-6 / OPS-01)
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
      // Keep user.id only — pseudonymous identifier
    }
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
    if (event.request?.data && typeof event.request.data === 'object') {
      const data = event.request.data as Record<string, unknown>;
      for (const k of ['password', 'token', 'email', 'phone', 'dateOfBirth']) delete data[k];
      // strip any key starting with medical_
      for (const k of Object.keys(data)) if (k.startsWith('medical_')) delete data[k];
    }
    return event;
  },
});
```

`sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts` all import `@/lib/sentry`. EU region is selected by using a `https://...@oXXXX.ingest.de.sentry.io/...` DSN.

### Drizzle query interceptor (OPS-04, OPS-05)

```ts
// src/server/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';
import { log } from '@/lib/log';

const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  prepare: false,           // Supabase pooler-compatible
  onnotice: () => {},
  debug: (conn, query, params, types) => {
    // Per-query timing happens inside drizzle middleware below (not here — `debug` runs before parse)
  },
});

export const db = drizzle(sql, {
  schema,
  logger: {
    logQuery(query, params) {
      const start = performance.now();
      // attach a deferred logger via Drizzle's transaction pattern; alternatively use queryWithTiming wrapper below
      log.debug({ query, params }, 'db.query');
    },
  },
});

// Slow query helper (OPS-05) — wrap critical queries:
export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await fn(); }
  finally {
    const dur = performance.now() - start;
    if (dur > 500) log.warn({ label, durationMs: Math.round(dur) }, 'db.slow_query');
    else log.debug({ label, durationMs: Math.round(dur) }, 'db.query_timing');
  }
}
```

For server-side slow query log at the Postgres level, set on Supabase:

```sql
ALTER DATABASE postgres SET log_min_duration_statement = 500;
```

### Log shipping

**Logflare** (recommended — Supabase-native, EU region available) [CITED: logflare.app/docs] **OR** **Axiom** (EU dataset selectable on signup). pino sends via `pino-logflare` transport in `src/lib/log.ts`:

```ts
const transport = pino.transport({
  targets: env.NODE_ENV === 'production' ? [
    { target: '@logflare/pino-logflare', options: { apiKey: env.LOGFLARE_API_KEY, sourceToken: env.LOGFLARE_SOURCE } },
  ] : [
    { target: 'pino-pretty', options: { colorize: true } },
  ],
});
```

Retention rules (OPS-02):
- Application logs (Logflare/Axiom): 30 days
- `audit_log` table: 90 days (pg_cron job purges older rows)
- `medical_access_audit` table: 6 years (do NOT auto-purge in Phase 1; manual archive job, schema-ready)

---

## Health Endpoints

### `/api/health/live` (D-17 — process check only)

```ts
// src/app/api/health/live/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'vttl-topsport-web', timestamp: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
```

### `/api/health/ready` (D-17 — DB + Redis probe)

```ts
// src/app/api/health/ready/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/server/db/client';
import { sql } from 'drizzle-orm';
import { cache } from '@/lib/cache';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export async function GET() {
  const checks = await Promise.allSettled([
    withTimeout(db.execute(sql`SELECT 1`)).then(() => ({ component: 'postgres', status: 'ok' as const })),
    withTimeout(cache.set('healthcheck', '1', 5)).then(() => ({ component: 'redis', status: 'ok' as const })),
  ]);

  const components = checks.map((c, i) =>
    c.status === 'fulfilled'
      ? c.value
      : { component: i === 0 ? 'postgres' : 'redis', status: 'fail' as const, error: String((c as PromiseRejectedResult).reason) },
  );
  const overall = components.every((c) => c.status === 'ok') ? 'ok' : 'degraded';

  if (overall !== 'ok') log.warn({ components }, 'health.ready.degraded');

  return NextResponse.json(
    { status: overall, components, timestamp: new Date().toISOString() },
    { status: overall === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
```

---

## TD Admin UI (Phase 1 minimal — AUTH-04, AUTH-05, USER-01, USER-02)

### `admin.user.*` tRPC router

```ts
// src/server/trpc/routers/admin.ts
import { z } from 'zod';
import { router } from '../trpc';
import { tdProcedure } from '../middleware/freshSession';
import { db } from '@/server/db/client';
import { users, parentChildLinks, academyMemberships, auditLog } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { canActivate } from '@/server/auth/activate';

export const adminRouter = router({
  user: router({
    list: tdProcedure
      .input(z.object({ search: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }))
      .query(async ({ input }) => db.query.users.findMany({ limit: input.limit })),

    create: tdProcedure
      .input(z.object({
        email: z.string().email(),
        name: z.string().min(2),
        role: z.enum(['technical_director','academy_manager','trainer','player','parent','sparring_partner','medical_staff']),
        preferredLocale: z.enum(['nl','en','fr']).default('nl'),
        dateOfBirth: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [u] = await db.insert(users).values({ ...input, active: false }).returning();
        await db.insert(auditLog).values({
          actorUserId: ctx.scope!.userId, action: 'user.create', resourceType: 'user', resourceId: u!.id,
          newValues: input, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        });
        return u;
      }),

    activate: tdProcedure.input(z.object({ userId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const result = await canActivate(input.userId);
      if (!result.ok) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
      const [u] = await db.update(users).set({ active: true }).where(eq(users.id, input.userId)).returning();
      await db.insert(auditLog).values({ actorUserId: ctx.scope!.userId, action: 'user.activate', resourceType: 'user', resourceId: input.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId });
      return u;
    }),

    deactivate: tdProcedure.input(z.object({ userId: z.string().uuid(), reason: z.string().min(3) })).mutation(async ({ ctx, input }) => {
      await db.update(users).set({ active: false, deactivatedAt: new Date() }).where(eq(users.id, input.userId));
      // D-09 revocation
      const { cache } = await import('@/lib/cache');
      await cache.set(`revoked:${input.userId}`, input.reason, 60 * 60 * 24 * 30);
      await db.insert(auditLog).values({ actorUserId: ctx.scope!.userId, action: 'user.deactivate', resourceType: 'user', resourceId: input.userId, newValues: { reason: input.reason }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId });
      return { ok: true };
    }),

    assignRole: tdProcedure.input(z.object({ userId: z.string().uuid(), role: z.string() })).mutation(async ({ ctx, input }) => {
      const old = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      const [u] = await db.update(users).set({ role: input.role as any }).where(eq(users.id, input.userId)).returning();
      // Scope-inperking → revoke (D-09)
      const { cache } = await import('@/lib/cache');
      await cache.set(`revoked:${input.userId}`, 'role_changed', 60 * 60 * 24);
      await db.insert(auditLog).values({ actorUserId: ctx.scope!.userId, action: 'user.role_change', resourceType: 'user', resourceId: input.userId, oldValues: { role: old?.role }, newValues: { role: input.role }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId });
      return u;
    }),

    linkParent: tdProcedure.input(z.object({ parentUserId: z.string().uuid(), childUserId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      // Sensitive — re-auth required (SEC-03), enforced by sensitiveProcedure variant
      await db.insert(parentChildLinks).values({ parentUserId: input.parentUserId, childUserId: input.childUserId, consentGivenAt: new Date(), linkedBy: ctx.scope!.userId });
      // Scope-uitbreiding for the parent — no revocation, max 15 min stale (D-10)
      await db.insert(auditLog).values({ actorUserId: ctx.scope!.userId, action: 'user.link_parent', resourceType: 'parent_child_link', resourceId: `${input.parentUserId}:${input.childUserId}`, newValues: input, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId });
      return { ok: true };
    }),

    linkAcademy: tdProcedure.input(z.object({ trainerUserId: z.string().uuid(), academyCode: z.string() })).mutation(async ({ ctx, input }) => {
      await db.insert(academyMemberships).values({ userId: input.trainerUserId, academyCode: input.academyCode, role: 'trainer', linkedBy: ctx.scope!.userId });
      await db.insert(auditLog).values({ actorUserId: ctx.scope!.userId, action: 'user.link_academy', resourceType: 'academy_membership', resourceId: `${input.trainerUserId}:${input.academyCode}`, newValues: input, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId });
      return { ok: true };
    }),
  }),
});
```

### `/admin/users/page.tsx` — Server Component

```tsx
// src/app/[locale]/(app)/admin/users/page.tsx
import { auth } from '@/server/auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { UserTable } from '@/components/admin/user-table';
import { db } from '@/server/db/client';

export default async function AdminUsersPage() {
  const t = await getTranslations('admin.users');
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as any).role !== 'technical_director') redirect('/login');

  const list = await db.query.users.findMany({ orderBy: (u, { desc }) => desc(u.createdAt), limit: 100 });
  return (
    <main>
      <h1>{t('title')}</h1>
      <UserTable initialData={list} />
    </main>
  );
}
```

`<UserTable>` is a Client Component using `@tanstack/react-table` + tRPC mutations.

---

## Migration Governance (MIG-01..05)

### Rules

1. **Never edit a committed migration** (MIG-01). Make a new one.
2. **Expand-contract for any breaking change** (MIG-02). Each step = its own deploy.
3. **Backfill in batches of 1000 + 100ms sleep** (MIG-03).
4. **Test each migration on staging Supabase project before main prod** (MIG-04).
5. **Rollback procedure documented per migration** (MIG-05) — `drizzle/<migration>.rollback.md`.

### Worked example: adding NOT NULL `users.preferred_locale` (would have happened if I18N-02 was retrofitted — included as the canonical reference)

**Step A (deploy 1 — expand):** add column nullable with default
```sql
-- 0010_users_preferred_locale_add.sql
ALTER TABLE users ADD COLUMN preferred_locale locale DEFAULT 'nl';
```

**Step B (deploy 2 — backfill):** populate all existing rows
```ts
// scripts/backfill-preferred-locale.ts — run via tsx
import { db } from '@/server/db/client';
import { sql } from 'drizzle-orm';

const BATCH = 1000;
let cursor: string | null = null;

while (true) {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM users
    WHERE preferred_locale IS NULL
      ${cursor ? sql`AND id > ${cursor}` : sql``}
    ORDER BY id LIMIT ${BATCH}
  `);
  if (rows.length === 0) break;
  await db.execute(sql`
    UPDATE users SET preferred_locale = 'nl' WHERE id IN (${sql.join(rows.map(r => sql`${r.id}`), sql`,`)})
  `);
  cursor = rows[rows.length - 1]!.id;
  await new Promise(r => setTimeout(r, 100));
}
```

**Step C (deploy 3 — switch reads):** application reads new column (already does — nullable column was filled).

**Step D (deploy 4 — contract):** enforce NOT NULL
```sql
-- 0011_users_preferred_locale_not_null.sql
ALTER TABLE users ALTER COLUMN preferred_locale SET NOT NULL;
```

**Rollback (`0011.rollback.md`):**
```sql
ALTER TABLE users ALTER COLUMN preferred_locale DROP NOT NULL;
```

### Backfill utility (`src/lib/migrate/backfill.ts`)

```ts
import { db } from '@/server/db/client';
import { sql, type SQL } from 'drizzle-orm';
import { log } from '@/lib/log';

export async function backfillBatched<T extends { id: string }>(args: {
  selectSql: (cursorClause: SQL) => SQL;
  updateSql: (ids: string[]) => SQL;
  batchSize?: number;
  delayMs?: number;
}) {
  const batch = args.batchSize ?? 1000;
  const delay = args.delayMs ?? 100;
  let cursor: string | null = null;
  let total = 0;

  for (;;) {
    const cursorClause = cursor ? sql`AND id > ${cursor}` : sql``;
    const rows = await db.execute<T>(args.selectSql(cursorClause));
    if (rows.length === 0) break;
    await db.execute(args.updateSql(rows.map(r => r.id)));
    cursor = rows[rows.length - 1]!.id;
    total += rows.length;
    log.info({ total, lastId: cursor }, 'backfill.progress');
    await new Promise(r => setTimeout(r, delay));
  }
  log.info({ total }, 'backfill.done');
}
```

### Drizzle Kit usage

```bash
# Generate migration from schema diff
npx drizzle-kit generate --name=initial

# Apply pending migrations (CI/CD via Coolify pre-deploy hook)
npx drizzle-kit migrate

# Inspect current state
npx drizzle-kit introspect
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (unit, integration); Playwright 1.59 (e2e) |
| Config file | `vitest.config.ts`; `playwright.config.ts` — Wave 0 creates these |
| Quick run command | `npx vitest run --changed` |
| Full suite command | `npx vitest run && npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Login persists across browser restart | e2e | `npx playwright test tests/e2e/auth.spec.ts -g "session persists"` | Wave 0 |
| AUTH-02 | Password reset via email link | integration + e2e | `npx vitest run tests/integration/auth-reset.test.ts` | Wave 0 |
| AUTH-03 | Session has CallerContext | integration | `npx vitest run tests/integration/caller-context.test.ts` | Wave 0 |
| AUTH-04 | TD CRUDs accounts | integration | `npx vitest run tests/integration/admin-user.test.ts` | Wave 0 |
| AUTH-05 | TD assigns roles | integration | `npx vitest run tests/integration/admin-user.test.ts -t "assignRole"` | Wave 0 |
| USER-01 | Parent-child link enforced in queries | integration | `npx vitest run tests/integration/parent-child.test.ts` | Wave 0 |
| USER-04 | Per-role scope enforcement | integration (matrix) | `npx vitest run tests/integration/rbac-matrix.test.ts` | Wave 0 — D-11 35 tests |
| USER-05 | RLS at DB layer (direct query) | integration (raw SQL) | `npx vitest run tests/rls/direct-query.test.ts` | Wave 0 |
| GDPR-01 | Consent recorded with version + snapshot | integration | `npx vitest run tests/integration/consent.test.ts` | Wave 0 |
| GDPR-02 | Minor cannot activate without parent consent | integration | `npx vitest run tests/integration/minor-flow.test.ts` | Wave 0 |
| GDPR-03 | Medical isolated from player query | integration (raw SQL) | `npx vitest run tests/rls/medical-isolation.test.ts` | Wave 0 |
| GDPR-04 | Medical read writes audit row | integration | `npx vitest run tests/integration/medical-audit.test.ts` | Wave 0 (full enforcement Phase 5; schema test in Phase 1) |
| GDPR-08 | All datetime UTC | unit | `npx vitest run tests/unit/timestamps.test.ts` | Wave 0 |
| SEC-01 | Cookies httpOnly+Secure+SameSite=Lax | e2e (response inspect) | `npx playwright test tests/e2e/auth.spec.ts -g "cookie flags"` | Wave 0 |
| SEC-03 | Re-auth required for sensitive | integration | `npx vitest run tests/integration/fresh-session.test.ts` | Wave 0 |
| SEC-05 | Reset 1h, magic 15min | unit | `npx vitest run tests/unit/auth-config.test.ts` | Wave 0 |
| SEC-06 | 5 attempts/15min lockout | integration | `npx vitest run tests/integration/lockout.test.ts` | Wave 0 |
| SEC-07/08/09 | Rate limit enforced | integration (chaos) | `npx vitest run tests/integration/ratelimit.test.ts` | Wave 0 |
| OPS-01 | pino redacts sensitive paths | unit | `npx vitest run tests/unit/log-redact.test.ts` | Wave 0 |
| OPS-04 | Drizzle interceptor emits timing | unit | `npx vitest run tests/unit/db-timing.test.ts` | Wave 0 |
| MIG-03 | Backfill batched | unit | `npx vitest run tests/unit/backfill.test.ts` | Wave 0 |
| I18N-01 | Locale switcher persists pref | e2e | `npx playwright test tests/e2e/locale-switcher.spec.ts` | Wave 0 |
| I18N-03 | Resolution chain | integration | `npx vitest run tests/integration/locale-resolve.test.ts` | Wave 0 |
| I18N-04 | Verify-email per locale | integration | `npx vitest run tests/integration/email-locale.test.ts` | Wave 0 |
| I18N-09 | Consent stores text snapshot | integration | `npx vitest run tests/integration/consent.test.ts -t "snapshot"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --changed` (under 30 seconds)
- **Per wave merge:** `npx vitest run && npx playwright test --grep="@phase1"`
- **Phase gate:** Full suite green; the **35-test rol×resource matrix** (D-11) MUST be 100% green; RLS-direct medical-isolation test MUST be green

### Wave 0 Gaps

- [ ] `vitest.config.ts` + `tests/setup.ts` — testcontainers Postgres bootstrap with migrations applied
- [ ] `playwright.config.ts` — three projects (chromium, firefox, webkit); EU-locale `nl-BE` default
- [ ] `tests/integration/rbac-matrix.test.ts` — 7 rollen × 5 resources = 35 tests minimum (D-11):
  - Roles: technical_director, academy_manager, trainer, player, parent, sparring_partner, medical_staff
  - Resources: users, consent_records, medical_events, audit_log, parent_child_links
  - Each cell asserts (allowed | denied | not_applicable) with explicit 200/403 expectation
- [ ] `tests/rls/direct-query.test.ts` — uses raw `pg` (NOT Drizzle) connecting as `app_user` role with `SET LOCAL app.user_id`/`app.user_role` to prove medical_events returns 0 rows for non-owner
- [ ] `tests/integration/email-locale.test.ts` — mocks Mailgun fetch; asserts `subject` + body match locale
- [ ] `tests/e2e/register-with-consent.spec.ts` — full flow: register → verify email → consent (3 categories) → login redirect
- [ ] `tests/integration/ratelimit.test.ts` — chaos: 110 requests in 60s → 11 should be 429
- [ ] Framework install — already in CLAUDE.md stack; just `npm i -D vitest @playwright/test @testcontainers/postgresql && npx playwright install`

---

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Modular monolith; medical isolation; threat model documented in this file |
| V2 Authentication | yes | Better Auth (scrypt password hash, lockout, fresh session) |
| V3 Session Management | yes | Better Auth httpOnly+Secure+SameSite=Lax + JWT revocation list |
| V4 Access Control | yes | tRPC middleware + Postgres RLS (defense in depth) |
| V5 Input Validation | yes | Zod schemas server-side on every mutation; `file-type` for uploads (Phase 2) |
| V6 Cryptography | yes | scrypt (Better Auth default); pgcrypto for medical (server-managed key) |
| V7 Error Handling | yes | tRPC error formatter; pino redact; Sentry beforeSend PII strip |
| V8 Data Protection | yes | RLS + isolation + signed URLs (Phase 2) + EU residency |
| V9 Communication | yes | TLS-only (Coolify Let's Encrypt + Supabase enforced TLS); HSTS via Next.js headers |
| V10 Malicious Code | yes (Phase 2) | file-type magic-byte check; ClamAV/VirusTotal in upload pipeline |
| V11 Business Logic | partial | Idempotency keys (VALID-08); concurrency tests in Phase 4+ |
| V12 Files and Resources | partial (Phase 2) | UUID filenames; Content-Disposition: attachment; private buckets |
| V13 API | yes | tRPC over HTTPS; rate limit (SEC-07/08/09); CSRF via SameSite + trustedOrigins |
| V14 Configuration | yes | @t3-oss/env-nextjs validates env at build; secrets in Coolify, not git |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection | Tampering | Drizzle parameterized queries; `sql\`\`` template only with bind params; ESLint rule banning string concatenation in `sql.raw` |
| Session fixation | Spoofing | Better Auth rotates session token on login; httpOnly cookie |
| CSRF on mutations | Tampering | SameSite=Lax + Better Auth `trustedOrigins` |
| IDOR (parent reads other player) | Information Disclosure | RLS + `players_visible_to()` + 35-test matrix gate (D-11) |
| Brute-force login | Spoofing | SEC-06 lockout (5 / 15 min) + SEC-07 IP rate limit |
| PII in logs | Information Disclosure | OPS-01 pino redact; Sentry beforeSend |
| Audit log tampering | Repudiation | Postgres role: app_user has INSERT-only on audit_log + medical_access_audit |
| Cookie theft | Spoofing | httpOnly + Secure (TLS) + short freshness for sensitive ops (SEC-03) |
| Mass assignment | Tampering | Zod `.strict()` schemas reject unknown keys; whitelist update fields per endpoint |
| Subdomain takeover | Spoofing | Coolify-managed DNS; CNAME to vttl.be apex only |
| Direct DB access bypassing RLS | Elevation | `FORCE ROW LEVEL SECURITY` on every sensitive table — applies even to table owner |

### Threat-model gates for Phase 1 exit

1. The 35-test rol×resource matrix is 100% green (D-11).
2. Direct-pg test as `app_user` role with `SET LOCAL app.user_role = 'trainer'` returns 0 rows from `medical_events` for a non-owned player.
3. `pino` log of a verify-email request shows `email: "[REDACTED]"` (OPS-01).
4. Sentry test event with `user.email = "x@y.z"` arrives at Sentry without the email field (beforeSend strip works).
5. `/api/health/ready` returns 503 when Upstash REST is unreachable (timeout simulated).

---

## Common Pitfalls (from PITFALLS.md + PITFALLS-ADDITIONS.md)

The following items have direct Phase 1 implications. Each lists the canonical mitigation as a task hook for the planner.

### Critical (must address in Phase 1)

| ID | Pitfall | Phase 1 Mitigation |
|----|---------|---------------------|
| **CRIT-1** | UI-only permission enforcement | tRPC middleware (`requireRole`) + Postgres RLS on every sensitive table — defense in depth |
| **CRIT-2** | Medical data co-mingled | Migration 002 isolates `medical_events`/`medical_documents`; RLS policy excludes trainers; pgcrypto encrypted columns |
| **CRIT-3** | Hard-coded role checks scattered | Single `players_visible_to(caller_id, caller_role)` SECURITY DEFINER function; lint rule against `if (role === ...)` outside `permissions.ts` |
| **CRIT-4** (HIGH-CRIT-4) | Naive datetime/tz | `tstz()` helper; ESLint rule blocks `new Date()` and bare `timestamp()`; tournament-tz field schema-ready |
| **CRIT-5** | Erasure not designed | GDPR-07 design doc: medical = hard-delete, others = anonymize; `users.deactivated_at` + `consent_records` retain proof of lawful processing; cascade rules: parent_child_links ON DELETE RESTRICT (preserves audit) |
| **CRIT-6** | Auth/session security | Better Auth defaults (httpOnly/Secure/SameSite=Lax); SEC-03 fresh-session middleware; 1h reset / 15min magic / single-use; pino redact on auth headers |
| **CRIT-7** | Backups + DR not designed | Supabase Pro PITR enabled; RTO ≤ 4h / RPO ≤ 1h documented; restore-drill in Phase 8; medical 30-year archive plan documented now |
| **CRIT-8** | Medical access audit narrow | Dedicated `medical_access_audit` table; Postgres role `app_user` has INSERT-only; reads via `query_medical_access_audit()` SECURITY DEFINER function; async write via BullMQ job (Phase 5 — schema in Phase 1) |

### High (must address in Phase 1)

| ID | Pitfall | Phase 1 Mitigation |
|----|---------|---------------------|
| **HIGH-4** | Rankings as flat fields | Schema: `ranking_entries` time-series (Phase 4 fills; Phase 1 ensures `ranking_type.direction` column lands in lookup) |
| **HIGH-5** | Parent-child not enforced at API | `parent_child_links` table + UNIQUE(child_user_id) constraint + RLS policy + `players_visible_to()` UNION branch |
| **HIGH-10** | PII in logs / unbounded growth | pino redact paths configured globally; external aggregator (Logflare EU); 30/90/2190-day retention rules |
| **HIGH-11** | Email deliverability SPF/DKIM/DMARC | Configure DNS during Phase 1 (vttl.be); execution test in Phase 8 |
| **HIGH-12** | Concurrency races | Idempotency-keys table (Migration 003); UNIQUE constraints planned per Phase 4+ feature |
| **HIGH-13** | Migration zero-downtime | Drizzle Kit + expand-contract doc + `lib/migrate/backfill.ts` + per-migration rollback `.md` |
| **HIGH-15** | Brute-force / API rate limit | Better Auth rateLimit (SEC-06) + tRPC `rateLimit('user'|'upload'|'broadcast')` middleware (SEC-07/08/09) |

### Over-engineering reclassifications

- **OE-3 obsolete in this project:** i18n is REQUIRED (nl/en/fr) — full infra in Phase 1 is correct, not premature.
- **OE-5 partially applies:** generic INSERT/UPDATE/DELETE trigger on every table is over-engineering. **Targeted** audit on consent, role-change, parent-link, deactivation IS required (Phase 1). Generic trigger NOT.

### Domain pitfalls (schema readiness, no implementation)

- **DOM-3 (RANK-03):** `ranking_type.direction` column added now — Phase 4 will populate Belgium ranking direction once confirmed (RISK-02).
- **DOM-7:** Evaluation-point label snapshot — schema scaffolded in Phase 1 (column comment); fill in Phase 5.
- **DOM-9:** Ranking source enum — `ranking_type` table can carry the dimension; `ranking_entries.source` column added in Phase 4.

---

## Code Examples (verified patterns)

### tRPC client setup with Better Auth session

```ts
// src/server/trpc/server-context.ts
import { auth } from '@/server/auth/auth';
import { headers } from 'next/headers';
import { db } from '@/server/db/client';
import { log } from '@/lib/log';
import { randomUUID } from 'crypto';
import type { CallerContext } from './trpc';

export async function createContext(): Promise<CallerContext> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  const requestId = hdrs.get('x-request-id') ?? randomUUID();
  const ipAddress = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const userAgent = hdrs.get('user-agent') ?? '';

  let scope: CallerContext['scope'] = null;
  if (session) {
    const u = session.user as any;
    const academies = await db.query.academyMemberships.findMany({ where: eq(academyMemberships.userId, u.id) });
    const links = await db.query.parentChildLinks.findMany({ where: eq(parentChildLinks.parentUserId, u.id) });
    scope = {
      userId: u.id,
      role: u.role,
      academyIds: academies.map(a => a.academyCode),
      linkedPlayerIds: links.map(l => l.childUserId),
      locale: u.preferredLocale ?? 'nl',
      issuedAt: Date.now(),
      fresh: !!session.session.freshUntil && new Date(session.session.freshUntil) > new Date(),
    };
  }

  return {
    session,
    user: session?.user as any,
    scope,
    requestId,
    ipAddress,
    userAgent,
    log: log.child({ requestId, userId: scope?.userId }),
  };
}
```

### Zod schema sharing client+server

```ts
// src/server/trpc/schemas/admin.ts
import { z } from 'zod';

export const createUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.enum(['technical_director','academy_manager','trainer','player','parent','sparring_partner','medical_staff']),
  preferredLocale: z.enum(['nl','en','fr']).default('nl'),
  dateOfBirth: z.string().date().optional(),
}).strict();
export type CreateUserInput = z.infer<typeof createUserInput>;
```

Used in router AND client form via `react-hook-form` + `@hookform/resolvers/zod`.

### pgcrypto encrypted column read pattern

```ts
// Read a medical_events row and decrypt
import { sql } from 'drizzle-orm';

const rows = await db.execute<{ id: string; description: string; doctor: string | null }>(sql`
  SELECT id,
         pgp_sym_decrypt(event_description_cipher::bytea, current_setting('app.medical_key')) AS description,
         CASE WHEN doctor_cipher IS NOT NULL
              THEN pgp_sym_decrypt(doctor_cipher::bytea, current_setting('app.medical_key'))
              ELSE NULL END AS doctor
    FROM medical_events
   WHERE player_user_id = ${playerId}
     AND deleted_at IS NULL
`);
```

The `app.medical_key` is set at connection-pool init time from `MEDICAL_ENCRYPTION_KEY` (Coolify secret) — NEVER stored in DB.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lucia v3 | Better Auth 1.x | mid-2025 | Lucia maintenance-only; Better Auth is active successor with plugins |
| Prisma | Drizzle ORM | 2024+ | No binary engine; faster cold starts; SQL-native |
| react-i18next | next-intl 4.x | Next.js 13 (App Router) | RSC-aware; ICU messages; locale routing built-in |
| In-memory rate limit | Upstash sliding-window | 2023+ | Stateless functions need shared state; Upstash REST works on Edge |
| Polling for unread count | Indexed partial query | 2024 (HIGH-7 reclassification) | At our scale (50–200 users) no need for cache layer in v1 |
| Kubernetes liveness+readiness | Coolify health-check JSON | Phase 1 | Same pattern, simpler ops on Hetzner |

**Deprecated/outdated:**
- **Express + custom auth:** Better Auth covers it
- **NextAuth.js (now Auth.js):** thin RBAC primitives — Better Auth strictly better for this domain
- **Moment.js:** date-fns 4 has all needed locales (`nl-BE`, `en-GB`, `fr-BE`)
- **Supabase JS SDK in app code:** introduces lock-in we explicitly avoid (RISK-SUPABASE-LOCK; CLAUDE.md ESLint ban)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Better Auth `freshAge` config option exists with that exact name | Section 4 (auth.ts) | LOW — if renamed, planner adapts; behavior is the same: track `session.freshUntil` |
| A2 | Mailgun EU endpoint `https://api.eu.mailgun.net/v3/...` accepts the same v3 messages API | Section 8 | LOW — confirmed in Mailgun docs but version verify before send |
| A3 | Supabase Pooler (port 6543) supports `prepare: false` for postgres-js driver | Section 10 | MEDIUM — incorrect driver flags can break queries; verify with `SELECT 1` smoke test on first deploy |
| A4 | `pgcrypto` `pgp_sym_encrypt` is available on Supabase Pro by default | Section 3 | LOW — verified in Supabase extensions list; just enable explicitly in 0000-init |
| A5 | Postgres `current_setting('x', true)` returns empty string (not NULL) when unset | Section 4 | LOW — documented Postgres behavior; the `current_user_id()` STABLE wrapper handles this with NULLIF |
| A6 | Belgian minor consent threshold = 16 (NOT EU default 13) | Section 9 | HIGH if wrong — but project context (CLAUDE.md, REQUIREMENTS.md GDPR-02) explicitly states 16 for Belgium under Wet 30 juli 2018; legal-team must confirm before lock |
| A7 | `@upstash/ratelimit` 2.x sliding-window prefix isolation is per-prefix | Section 6 | LOW — documented; verified via @upstash/ratelimit changelog |
| A8 | Better Auth admin plugin's `defaultRole` and `adminRoles` accept arbitrary string roles | Section 4 | MEDIUM — if it requires specific role names, the planner will need to use the organization plugin instead |
| A9 | Logflare or Axiom EU dataset selection is available on free/starter tier | Section 10 | LOW — documented at signup; alternative is self-hosted Loki on Hetzner |
| A10 | BullMQ via ioredis with `rediss://` TLS works against Upstash | Section 6 | MEDIUM — Upstash docs note BullMQ-compat requires the TCP/TLS endpoint; confirm before deploy with a smoke test |

**The planner and discuss-phase MUST verify A6 (Belgian minor age) with the project's legal advisor before locking the consent flow** — this is the only HIGH-impact assumption.

---

## Open Questions

1. **Belgian-DPA approved Sentry/Mailgun/Logflare DPAs**
   - What we know: all three offer EU residency.
   - What's unclear: whether VTTL legal has signed each DPA.
   - Recommendation: Phase 1 design uses these vendors; Phase 8 release-gate verifies signed DPAs are on file. Defer execution to Phase 8.

2. **`MEDICAL_ENCRYPTION_KEY` rotation policy**
   - What we know: pgcrypto symmetric key set per-connection.
   - What's unclear: rotation cadence + key versioning scheme.
   - Recommendation: Phase 1 single-key (`v1`); Phase 8 add `key_version` column on `medical_events_cipher` for rotation. Document as deferred.

3. **Re-consent banner UX vs. blocking modal**
   - What we know: D-07 says "banner forces re-consent; can't continue without".
   - What's unclear: whether read-only paths (e.g., own profile read) should be allowed pre-consent.
   - Recommendation: tRPC `requireCurrentConsent` blocks ALL protected procedures; banner is full-screen modal. Discuss-phase user already locked this stance.

4. **Mailgun vs. SendGrid choice**
   - What we know: both EU-resident; CLAUDE.md says "Mailgun EU or SendGrid EU".
   - What's unclear: which one to pick now.
   - Recommendation: Mailgun (simpler API, region selectable in dashboard, US/EU separation explicit in URL). Plannner can flip via `lib/email/send.ts` if cost justifies.

5. **Timezone assumption for non-Belgian users**
   - What we know: tournaments will have IANA tz field (Phase 4); calendar in Phase 3.
   - What's unclear: should `users.timezone` exist now?
   - Recommendation: NO — defer to Phase 3 (calendar). Phase 1 stores all times in UTC; user display uses browser tz on render.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + run | ✓ (local dev) | 24.15.0 (local) — Coolify image must pin to LTS 22.x | — |
| npm | Package management | ✓ | 11.12.1 | pnpm acceptable but not part of plan |
| git | VCS | ✓ | 2.39.5 | — |
| Postgres 16 (Supabase Pro EU) | Schema + RLS | ✗ (must provision) | — | None — blocking; provision Step 1 of Phase 1 |
| Upstash Redis (EU) | Rate limit + revocation + BullMQ | ✗ (must provision) | — | None — blocking; provision Step 1 |
| Mailgun EU | Transactional email | ✗ (must provision) | — | SendGrid EU |
| Sentry (EU region) | Error tracking | ✗ (must provision) | — | Self-hosted GlitchTip on Hetzner |
| Logflare or Axiom EU | Log aggregation | ✗ (must provision) | — | Self-hosted Loki + Grafana on Hetzner |
| Coolify on Hetzner CX31 | App deploy | ✗ (must provision) | — | Railway EU (lower control, higher cost) |
| Docker | Local dev with testcontainers | partial check | not verified | Skip RLS direct-query tests locally; run only in CI (slower feedback) |
| psql client | Migration debugging | ✗ (not verified locally) | — | Supabase web UI; not blocking — Drizzle Kit handles migrations |

**Missing dependencies with no fallback:**
- Supabase Pro EU project (blocks all schema work)
- Upstash Redis EU instance (blocks rate-limit + revocation + BullMQ)
- Mailgun EU domain `vttl.be` with SPF/DKIM/DMARC (blocks email delivery)
- Coolify instance on Hetzner CX31 (blocks deployment; can defer to Phase 8 if local dev sufficient)

**Missing dependencies with fallback:**
- Sentry EU → self-hosted GlitchTip
- Logflare/Axiom → self-hosted Loki
- Mailgun → SendGrid

**Phase 1 task ordering implication:** Provisioning tasks (Supabase project, Upstash instance, Mailgun domain) MUST be the first track in the plan, with explicit OWNER + DEADLINE per item. They block almost everything else.

---

## Sources

### Primary (HIGH confidence)
- Better Auth docs — `https://www.better-auth.com/docs` — basic-usage, session-management, drizzle-adapter, admin plugin
- Drizzle ORM docs — `https://orm.drizzle.team/docs/overview`, `https://orm.drizzle.team/docs/rls`
- next-intl docs — `https://next-intl.dev/docs/getting-started/app-router`, `https://next-intl.dev/docs/configuration`
- @upstash/ratelimit — `https://upstash.com/docs/redis/sdks/ratelimit-ts/overview`
- BullMQ — `https://docs.bullmq.io/`, `https://docs.bullmq.io/guide/connections`
- pino — `https://getpino.io/#/docs/redaction`
- Supabase RLS — `https://supabase.com/docs/guides/database/postgres/row-level-security`
- npm registry verification (2026-05-01): Next 16.2.4, Better Auth 1.6.9, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, next-intl 4.11.0, @upstash/ratelimit 2.0.8, @upstash/redis 1.37.0, BullMQ 5.76.4, pino 10.3.1, @sentry/nextjs 10.51.0, @trpc/server 11.17.0, zod 4.4.1, file-type 22.0.1
- `.planning/PITFALLS-ADDITIONS.md` — players_visible_to() canonical SQL
- `.planning/research/PITFALLS.md` — CRIT-1..5, HIGH-1..9
- `.planning/research/ARCHITECTURE.md` — modular monolith + polymorphic events
- `.planning/REQUIREMENTS.md` — AUTH/USER/GDPR/SEC/OPS/MIG/I18N traceability table
- `.planning/ROADMAP.md` Phase 1 — Doel, Succescriteria, Kerntaken, Risico's

### Secondary (MEDIUM confidence)
- Mailgun EU API — `https://documentation.mailgun.com/docs/mailgun/api-reference/` (verified URL pattern)
- Postgres 16 docs — RLS performance, current_setting, SECURITY DEFINER

### Tertiary (LOW confidence — flagged for validation)
- Better Auth `freshAge` exact key — confirm against current `BetterAuthOptions` type at install time
- Supabase Pooler `prepare: false` driver flag — smoke-test on first deploy
- BullMQ + ioredis + Upstash TLS — verify with `Worker` smoke test before locking BullMQ as Phase 1 deliverable

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm registry on 2026-05-01; CLAUDE.md locks the choices
- Architecture (RLS function, CallerContext, polymorphic events): HIGH — sourced from PITFALLS-ADDITIONS.md and ARCHITECTURE.md
- Pitfalls: HIGH — extracted directly from PITFALLS.md + PITFALLS-ADDITIONS.md with explicit Phase 1 mitigations
- Better Auth specific config keys: MEDIUM — most documented; a few (e.g., `freshAge`) flagged as A1 in Assumptions Log
- Belgian legal specifics: MEDIUM — minor age 16 documented in CLAUDE.md/REQUIREMENTS.md but flagged A6 for legal-team confirmation
- Email + DNS infra (SPF/DKIM/DMARC): MEDIUM — pattern is industry-standard but exact records depend on chosen provider (Mailgun vs. SendGrid)

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (30 days; libraries here have stable APIs but Better Auth and next-intl release frequently)
