# Stack Research — VTTL Topsportplatform

## Recommended Stack

| Layer | Choice | Version | Confidence |
|-------|--------|---------|------------|
| Frontend framework | Next.js (App Router) | 15.x | High |
| UI component library | shadcn/ui + Tailwind CSS | shadcn latest / Tailwind 4.x | High |
| Backend API | Next.js Route Handlers + tRPC | tRPC 11.x | High |
| Alternative backend (if split) | NestJS | 11.x | Medium |
| Database (managed) | Supabase Postgres (Pro tier, EU/Frankfurt region) | PG 15+ | High |
| ORM | Drizzle ORM | latest stable | High |
| Auth / RBAC | Better Auth (self-hosted, runs against Supabase Postgres) | 1.x | High |
| Calendar | FullCalendar | 6.x | High |
| File storage | Supabase Storage (RLS-integrated buckets, EU/Frankfurt) | — | High |
| Real-time / Messaging | Supabase Realtime (managed, integrated with RLS) | — | High |
| Video handling (v1) | External URL + react-player (YouTube/Vimeo) | — | High |
| Video handling (v2) | Cloudflare Stream | — | Medium |
| App deployment | Coolify on Hetzner (EU/DE) — Next.js app only; DB lives on Supabase | latest | High |
| GDPR tooling | Drizzle-defined RLS policies + audit_log + pgcrypto for special-category data | — | High |

---

## Detailed Recommendations

### Frontend

**Choice: Next.js 15 (App Router) + shadcn/ui + Tailwind CSS 4**

**Rationale:**
Next.js 15 with the App Router is the de-facto standard for full-stack TypeScript web applications in 2025. It provides:
- Server Components by default — critical for role-based rendering (showing/hiding sensitive medical data server-side, not leaking it to the client bundle)
- Built-in file-based routing, nested layouts ideal for dashboard modules (player profiles, evaluations, medical follow-up)
- Streaming + Suspense for perceived performance on data-heavy pages (rankings time series, video pages)
- Partial Prerendering (PPR) introduced in Next.js 14/15 — static shell + dynamic content, perfect for the calendar and rankings pages
- First-class TypeScript support; the entire VTTL codebase should be fully typed
- Strong ecosystem: the most-hired frontend skill in Belgium/Netherlands in 2025

**Key versions:**
- `next`: `^15.3`
- `react`: `^19.0`
- `react-dom`: `^19.0`
- `typescript`: `^5.5`
- `tailwindcss`: `^4.0` (Tailwind v4 is a complete rewrite; no config file, CSS-first, ~10x faster builds)
- `shadcn/ui`: installed per-component via CLI (not a versioned npm package — components live in your repo)

**shadcn/ui rationale:** Ships accessible, unstyled Radix UI primitives pre-styled with Tailwind. Components are owned by your project (not a black-box dependency), making them GDPR-safe to audit, and fully customizable for Dutch UI copy. Covers: dialogs, dropdowns, data tables, forms, badges, tooltips — all needed.

**Additional frontend libraries:**
- `@tanstack/react-table` `^8.x` — headless table with sorting/filtering for player rankings, tournament results
- `@tanstack/react-query` `^5.x` — server state management (pairs with tRPC)
- `react-hook-form` `^7.x` + `zod` `^3.x` — form validation (player profiles, evaluations); Zod schemas shared with backend
- `recharts` `^2.x` or `chart.js` / `react-chartjs-2` — time-series ranking charts, performance dashboards
- `date-fns` `^3.x` — date handling (no Moment.js); good locale support for `nl-BE`
- `next-intl` `^3.x` — i18n for Dutch/Flemish UI strings

**What NOT to use:**
- **Create React App** — deprecated, unmaintained since 2023
- **Vite + React (SPA-only)** — loses server-side rendering; medical data rendered client-side is a GDPR risk; no SSR means worse initial load for calendar/rankings
- **Vue 3 / Nuxt 3** — technically solid but the Belgian/Flemish dev talent pool is predominantly React/Next.js; hiring/handover risk
- **SvelteKit** — excellent DX but immature ecosystem for the specialized libraries needed (FullCalendar integration, complex table components); smaller hiring pool
- **Angular** — verbose, over-engineered for this scale; not the 2025 default for new projects

---

### Backend

**Choice: Next.js Route Handlers + tRPC 11**

**Rationale:**
For a team of 1–3 developers building this platform, colocating frontend and backend in a single Next.js monorepo via tRPC eliminates the overhead of a separate API service. tRPC gives:
- End-to-end type safety: define a procedure once, get fully typed client calls — no code generation, no OpenAPI drift
- Input validation via Zod (shared schemas with the frontend)
- Subscriptions (via WebSocket transport) for real-time messaging
- Middleware for RBAC checks at the router level

**Key versions:**
- `@trpc/server`: `^11.x`
- `@trpc/client`: `^11.x`
- `@trpc/next`: `^11.x`
- `@trpc/react-query`: `^11.x`

**When to switch to NestJS:** If the team grows beyond 3–4 engineers, or if a dedicated mobile app / third-party API consumer is needed, extract the backend to **NestJS 11**. NestJS provides:
- Decorator-based, opinionated structure (important for long-term maintainability)
- First-class OpenAPI/Swagger generation
- Guard system maps directly to RBAC roles
- WebSockets module (Gateway)
- Strong Belgian/.nl enterprise adoption

**What NOT to use:**
- **Express** — unopinionated, no built-in structure; requires assembling too many pieces; security footprint harder to audit for GDPR
- **Fastify** — faster than Express but still requires assembly; lacks the type-safety ergonomics of tRPC or NestJS at this scale
- **Django / Python** — team would need to be Python-fluent; no type sharing with TypeScript frontend; adds operational complexity
- **Ruby on Rails** — not relevant for new Belgian sports tech projects in 2025; talent pool near zero

---

### Database

**Choice: Supabase Postgres (Pro tier, EU/Frankfurt) + Drizzle ORM**

**Why Supabase (DECISION UPDATED — supersedes the earlier "self-hosted on Hetzner" recommendation):**
- Managed Postgres with all needed extensions enabled: `pgcrypto`, `pg_cron`, `pg_trgm`, `unaccent`, `uuid-ossp`
- Row Level Security: Postgres-native; policies defined as code in Drizzle migrations (avoids the "RLS in dashboard = drift risk" anti-pattern that originally motivated self-hosting)
- EU data residency: Frankfurt region (eu-central-1) — GDPR compliant for medical and minor data
- Automatic backups: daily snapshots + Point-In-Time Recovery (PITR) on Pro tier — closes the missing DR gap from the original research
- Built-in connection pooler (Supavisor) — eliminates the need to deploy PgBouncer manually
- Supabase Storage on the same platform — bucket policies reference the same auth context as RLS, so file access control is consistent with database access control (simplifies signed-URL pattern significantly)
- Supabase Realtime on the same platform — replaces Soketi for in-app messaging notifications, removes WebSocket operational burden for a 1–3 person team
- DPA available; GDPR Art. 28 contractual coverage standard
- Pricing: Pro tier ~$25/mo + bandwidth — close to Hetzner-managed-Postgres equivalent but with PITR, observability, and Realtime included

**Why we deliberately go MANAGED here (and self-host the app layer on Coolify):**
The original concern about Supabase ("adds a managed layer between you and your DB") is mitigated when you treat Supabase as **a Postgres host, not as your application backend**: define all schemas, migrations, and RLS in Drizzle code (versioned in your repo), connect via standard Postgres URL, never use the Supabase JS SDK from the application layer. The platform stays portable — you can move to Neon, RDS, or self-hosted Postgres in a day. The wins (managed backups, integrated Storage with RLS-aware buckets, integrated Realtime) outweigh the lock-in risk for a small team.

**PostgreSQL feature usage:**
- ACID compliance for medical data (Art. 9 special category)
- RLS as enforcement backstop behind tRPC middleware
- JSONB for flexible evaluation schemas
- Time-series ranking storage with `(player_id, ranking_type, entry_date DESC)` index
- `pg_trgm` + `unaccent` for Dutch full-text search
- `pgcrypto` for column-level encryption of medical diagnosis fields
- `pg_cron` for scheduled retention jobs (data expiry, archive triggers)

**Drizzle ORM (latest stable) rationale:**
- Fully type-safe, lightweight (no heavy runtime like Prisma's query engine binary)
- SQL-first philosophy: you write SQL-like TypeScript, not magic abstractions; easier to audit for security
- Drizzle Kit migrations: schema-as-code with versioned migration files (important for auditability under GDPR)
- ~3–10x faster queries than Prisma in benchmarks for read-heavy workloads (rankings, leaderboards)
- Works in Next.js Edge Runtime (useful for middleware auth checks)

**Schema design notes for GDPR:**
- Separate `medical_records` table with a strict column list (no `SELECT *` queries)
- `audit_log` table: every INSERT/UPDATE/DELETE on sensitive tables logs `user_id`, `timestamp`, `action`, `table_name`, `row_id` — mandatory for GDPR accountability
- `data_retention_policy` column on tables holding personal data: automate deletion via pg_cron

**What NOT to use:**
- **MySQL / MariaDB** — weaker JSONB support, no RLS, inferior full-text search; no technical reason to choose over PostgreSQL in 2025
- **MongoDB** — document model is tempting for flexible evaluations but ACID guarantees are weaker; medical data needs relational integrity; JOIN-heavy queries for rankings/player history are painful
- **SQLite** — not suitable for multi-user concurrent write workload
- **Prisma ORM** — the binary query engine introduces a deploy-time footprint, cold start latency in serverless, and the generated client is harder to audit; Drizzle is the 2025 default for new projects
- **TypeORM** — decorator-based, heavy, poor Next.js/Edge compatibility; largely superseded

---

### Auth / RBAC

**Choice: Better Auth 1.x (self-hosted)**

**Rationale:**
The platform has 6 roles with complex data-access rules and stores medical data (GDPR special category). This makes third-party managed auth services legally and technically risky:

**Better Auth 1.x:**
- Open-source, self-hosted TypeScript auth library (the 2025 successor pattern to Lucia)
- Built-in session management, email/password, OAuth providers
- Plugin system: organizations/teams plugin maps directly to the VTTL role hierarchy
- RBAC plugin: define roles and permissions as code, checked in tRPC middleware
- All data stays in your PostgreSQL database — no personal data sent to a third-party auth vendor (critical for GDPR)
- Works natively with Next.js App Router, Drizzle, and tRPC

**Roles to implement:**
1. `admin` — full access
2. `coach` — read/write own players, no other players' medical data
3. `player` — read own data, submit self-evaluations
4. `medical_staff` — read/write medical records for assigned players
5. `selector` — read-only rankings/tournament data
6. `parent_guardian` — read-only access to linked minor's non-medical data

**RBAC implementation pattern:**
- Store `role` + `permissions[]` in session JWT (signed, not encrypted)
- Enforce at tRPC middleware layer (fast, before DB hit)
- Re-enforce at Drizzle query layer using RLS policies (defence in depth)
- Never trust client-supplied role claims

**What NOT to use:**
- **Auth0** — personal data (email, name, roles) stored on Auth0 servers in the US; GDPR data transfer risk; expensive at scale; overkill for a single-org platform
- **Clerk** — same data residency concern; US-based infrastructure by default; GDPR compliance requires EU data residency add-on (paid, complex)
- **NextAuth / Auth.js v5** — good for basic OAuth but the RBAC and organization primitives are thin; you end up building the permission layer anyway; Better Auth is strictly more capable for this use case
- **Firebase Auth** — Google-controlled infrastructure; GDPR data processing agreement complexity; no fine-grained RBAC
- **Keycloak** — enterprise-grade and GDPR-safe but operationally heavy (Java, own DB, complex admin UI); overkill for a single-tenant sports platform

---

### Calendar

**Choice: FullCalendar 6.x**

**Rationale:**
FullCalendar is the only production-grade calendar library in 2025 that matches the requirement of an "Outlook-style week view":
- `timeGrid` plugin: week and day views with draggable/resizable events — exactly Outlook Week View
- `interaction` plugin: drag-and-drop, resize, click-to-create
- `rrule` plugin: recurring training sessions (e.g., Tuesday/Thursday practice)
- Resource timeline view (premium): useful for scheduling multiple players across facilities — consider for v2
- React wrapper (`@fullcalendar/react`) integrates cleanly with Next.js
- Locale: `@fullcalendar/core/locales/nl` — Dutch locale out of the box
- Exports to iCal (`.ics`) for Outlook sync — important for coaches

**Key packages:**
```
@fullcalendar/react          ^6.x
@fullcalendar/core           ^6.x
@fullcalendar/daygrid        ^6.x
@fullcalendar/timegrid       ^6.x
@fullcalendar/interaction    ^6.x
@fullcalendar/rrule          ^6.x
@fullcalendar/list           ^6.x
rrule                        ^2.x
```

**Licensing note:** FullCalendar Core (above packages) is MIT-licensed and free. The resource/premium plugins require a commercial license (~$150/yr for a single project — budget for this).

**What NOT to use:**
- **react-big-calendar** — no longer actively maintained in 2025; missing drag-resize out of the box; inferior Dutch locale support; no rrule support without heavy custom work
- **React Calendar** — basic month/year picker only; not a scheduling calendar
- **Bryntum Calendar** — excellent but very expensive ($3,000+ license); over-engineered for this scale
- **Google Calendar embed** — data goes to Google; GDPR personal schedule data risk; no customization

---

### File Storage

**Choice: Supabase Storage (DECISION UPDATED — supersedes Cloudflare R2)**

**Rationale (revised given the Supabase database decision):**
- **RLS-integrated bucket policies** — bucket access policies reference the same `auth.uid()` and `auth.role()` as the database; file access control is consistent with data access control. This eliminates an entire class of bugs where database RBAC says "no" but a leaked storage URL still works.
- **Same platform as the Postgres DB** — one DPA, one EU region, one set of credentials, one place to monitor
- EU data residency: Frankfurt region — GDPR compliant for profile photos, medical documents, evaluation PDFs
- Signed URLs: built-in support with TTL configurable per request; refresh and revocation patterns documented
- S3-compatible API: works with `@aws-sdk/client-s3` if needed, no full vendor lock-in (files can be migrated out via standard S3 sync)
- Pricing: $0.021/GB/month storage + $0.09/GB egress — slightly higher than R2's zero-egress model, but at the v1 scale (50–200 users, ~10GB total) this is < €5/month difference
- Bucket structure: `profiles/` (semi-public, authenticated download), `evaluations/` (TD + trainer + player scope), `medical/` (TD + medical staff + player scope, 5-min signed URL TTL), `messages/` (sender + recipients scope)

**Why not Cloudflare R2 (the original choice):**
- Zero egress is genuinely attractive but the operational benefit of having Storage RLS reference the same auth context as the database (no separate signing layer to maintain) is more valuable for a small team
- R2 still wins for content delivery at large scale (TB/month bandwidth) — keep R2 in mind as a v2 migration if egress costs grow

**Use cases:**
- Player profile photos
- Medical document uploads (PDF/images) — store with AES-256 encryption server-side, access via signed URL only
- Training video clips (short clips; longer match videos via Cloudflare Stream — see Video section)
- Evaluation PDF exports
- Tournament result attachments

**What NOT to use:**
- **AWS S3** — egress costs add up; more complex IAM; overkill for a single small-team platform; R2 is strictly better value with same API
- **Supabase Storage** — viable but ties you to the Supabase ecosystem; limits flexibility; R2 is more portable
- **Google Cloud Storage** — same egress cost issue as S3; GDPR requires specific GCP EU region config which is error-prone
- **Local disk / VPS storage** — no CDN, no redundancy, no signed URLs; not production-grade; backup complexity

---

### Real-time / Messaging

**Choice: Supabase Realtime (DECISION UPDATED — supersedes Soketi)**

**Rationale (revised given the Supabase database decision):**
Since the database lives on Supabase, Supabase Realtime is the natural choice for in-app messaging notifications and live updates:
- **Postgres replication-based**: subscribe to inserts/updates on the `message_recipients` table filtered by the current user's ID — automatic delivery when a new row appears
- **RLS-aware**: subscriptions respect the same RLS policies as direct queries; you can't subscribe to data you can't read
- **No separate infrastructure**: zero ops burden vs. self-hosted Soketi (which would require WebSocket service + Redis + monitoring)
- **EU data residency**: same Frankfurt region as the database
- **Client SDK**: `@supabase/supabase-js` provides a simple subscription API; no need for Pusher JS

**Message persistence:**
- All messages stored in Postgres (`messages`, `message_recipients`, `message_attachments`)
- Supabase Realtime replicates changes; Postgres is the source of truth
- End-to-end auditable for GDPR accountability

**SSE as fallback:** For very low-volume notifications (calendar reminder badges), Next.js native SSE via Route Handlers remains viable and requires no Supabase Realtime configuration. Use Realtime for messaging; SSE for unread-count updates.

**Why not Soketi (the original choice):**
- Soketi is excellent but adds a self-hosted WebSocket service that a 1–3 person team must monitor, scale, and patch
- Supabase Realtime is the same operational primitive (Postgres-replication WebSocket) but managed
- For v1 scale (50–200 users, low broadcast volume), Realtime's connection limits are not a concern
- If Realtime ever becomes a bottleneck, Soketi remains a clean migration target — both speak similar Postgres-replication patterns

**Key packages:**
```
pusher         ^5.x   (server-side event trigger)
pusher-js      ^8.x   (client-side)
```

**What NOT to use:**
- **Pusher Channels (managed)** — messages pass through Pusher's servers in the UK/US; GDPR data processing agreement required; ongoing cost; data residency unclear for medical-adjacent content
- **Ably** — same third-party data concern; expensive
- **Socket.io** — solid but Soketi/Pusher ecosystem has better DX and the client library is more battle-tested; Socket.io requires more custom protocol work
- **Firebase Realtime Database** — Google infrastructure; GDPR complexity; schema-less, hard to audit

---

### Video

**Choice: Cloudflare Stream (primary) + standard `<video>` tag for short clips**

**Rationale:**
Match video analysis (v2 feature) and video links require a proper video pipeline. Raw video uploads to R2 or S3 without transcoding will fail on mobile/tablet playback.

**Cloudflare Stream:**
- Upload once, Stream delivers adaptive bitrate (HLS/DASH) to any device
- EU storage and delivery — GDPR compliant
- Access control: signed tokens per video (time-limited, user-specific) — no public video URLs
- Thumbnail generation, trim, per-second seeking
- Webhook on upload completion: trigger AI analysis job (v2)
- Cost: $5/1,000 minutes stored + $1/1,000 minutes delivered — very reasonable for a small elite squad

**For v1 (video links only, no upload):** Store YouTube/Vimeo URLs in the database, render with a standard `<iframe>` + `react-player` (`^2.x`). Simple, zero infrastructure.

**For v2 (AI video analysis):**
- Upload to Cloudflare Stream → webhook → queue job (BullMQ + Redis) → run pose estimation / shot detection model → store annotations in PostgreSQL
- Model options: MediaPipe Pose (client-side, privacy-preserving), or a server-side Python microservice with YOLOv8 + custom table tennis detection model

**Key packages:**
```
react-player   ^2.x   (for external video links, v1)
@cloudflare/stream-react  ^3.x  (for Stream embeds, v2)
```

**What NOT to use:**
- **Mux** — excellent product but US-based; GDPR data transfer concern for match footage; more expensive than Cloudflare Stream
- **AWS MediaConvert + S3** — complex pipeline, high operational overhead, no EU data guarantee out-of-box
- **Direct R2 video serving** — no transcoding, no adaptive bitrate; breaks on mobile; large files drain bandwidth
- **YouTube (private)** — video data processed by Google; GDPR personal data (player faces); unacceptable for elite sports with minors

---

### Deployment

**Choice: Coolify (self-hosted on Hetzner) — primary recommendation**

**Rationale:**
For a GDPR-sensitive Belgian sports platform, EU data residency is not optional. Coolify + Hetzner is the 2025 default for teams that need full data control without the DevOps overhead of bare Kubernetes.

**Hetzner Cloud:**
- EU-based (Germany/Finland datacenters) — data residency guaranteed
- CX31 instance (4 vCPU, 8GB RAM): ~€13/month — sufficient for initial load
- CX41 (8 vCPU, 16GB RAM): ~€25/month for production
- Hetzner Object Storage: S3-compatible, EU, cheap — alternative to Cloudflare R2 if you want everything on one provider

**Coolify:**
- Open-source Heroku/Vercel alternative you deploy on your VPS
- One-click deployment from GitHub via Nixpacks or Dockerfile
- Managed PostgreSQL, Redis, Soketi as services
- Automated SSL (Let's Encrypt), reverse proxy (Caddy), backups
- No vendor lock-in; you own all data

**Alternative: Railway**
- Managed PaaS; EU region available
- Faster to start (no VPS setup)
- More expensive at scale (~$20–50/month for the stack vs ~€15/month on Hetzner)
- Suitable if the team has no DevOps experience

**CI/CD:**
- GitHub Actions for build, test, lint on PR
- Coolify webhook deploys on merge to `main`

**What NOT to use:**
- **Vercel** — excellent for Next.js but: (1) function execution data may pass through US edge nodes (GDPR risk); (2) no persistent WebSocket connections (Soketi won't work); (3) Postgres via Neon/external; (4) expensive at scale. Use only if you use Vercel's EU region exclusively and accept the constraints.
- **AWS / GCP / Azure** — correct choice for a large organization but massive operational overhead for a 2–3 person team; cost and complexity unjustified
- **Netlify** — primarily static; poor fit for Next.js App Router with dynamic RSCs and WebSockets
- **Render** — viable but EU region is US-West by default; GDPR data residency requires manual configuration; less control than Coolify

---

### GDPR

GDPR compliance is not a library — it is architecture. The following is a concrete implementation checklist.

**Special category data (medical records):**
- Store in a separate `medical_records` table, never joined into general queries
- Column-level encryption using `pgcrypto` (`pgp_sym_encrypt`) for diagnosis fields
- Access logged to `audit_log` on every read (not just writes)
- Accessible only to `medical_staff` and `admin` roles — enforced at both tRPC middleware and PostgreSQL RLS

**Consent management:**
- Store explicit consent records in `consent_log` table: `user_id`, `purpose`, `consented_at`, `withdrawn_at`, `ip_hash`
- Cookie consent: `@consent-manager/react` or a simple custom banner — no third-party consent SaaS needed for an internal platform
- Track: (1) general platform use, (2) medical data processing, (3) video analysis (v2)

**Data subject rights (AVG/GDPR Articles 15–20):**
- Right of access: build a `/my-data` export endpoint that generates a JSON/PDF of all data held on a user
- Right to erasure: `anonymize_user(user_id)` function in PostgreSQL — replaces PII with pseudonyms, retains statistical data for rankings history
- Right to portability: standard JSON export format
- Implement as admin UI screens, not just theoretical procedures

**Data retention:**
- `pg_cron` extension: schedule nightly jobs to delete/anonymize records past retention period
- Define retention periods per data category in a `data_retention_config` table (auditable, configurable without code deploy)
- Medical records: retain for legal minimum (Belgium: 30 years for medical records under the Patient Rights Act), then archive to encrypted cold storage

**Audit log:**
- Every sensitive action (login, data access, data change, export) writes to `audit_log`
- Audit log is append-only (no UPDATE/DELETE permissions for app user on this table)
- Include: `actor_id`, `action`, `resource_type`, `resource_id`, `timestamp`, `ip_address`, `user_agent`

**Data breach response:**
- Implement a `security_incidents` table and an admin screen for logging and tracking incidents
- Belgian DPA (GBA) must be notified within 72 hours of a breach — have the process documented

**GDPR tooling packages:**
```
# No single npm package covers GDPR — implement these patterns:
pgcrypto           (PostgreSQL extension — no npm)
pg_cron            (PostgreSQL extension — no npm)
zod                ^3.x    (input validation prevents injection of excess personal data)
pino               ^9.x    (structured logging — redact PII fields in log config)
helmet             ^8.x    (Next.js middleware — security headers)
```

**Data Processing Agreement (DPA) checklist:**
- Cloudflare R2: sign Cloudflare DPA, enable EU region
- Cloudflare Stream: same DPA
- Hetzner: sign Hetzner DPA (available in German/English)
- GitHub (code only, no personal data): standard DPA
- No personal data in error tracking tools (Sentry) without pseudonymization

---

## What NOT to Use (and Why)

| Technology | Why NOT |
|-----------|---------|
| **Firebase (any module)** | Google infrastructure; GDPR data residency and processing complexity; vendor lock-in; no SQL = no RLS; realtime DB has no audit capability |
| **Supabase Auth (as primary auth)** | Better Auth gives more control over the consent flow, sensitive-action re-authentication, and Belgian minor-consent path. Use Supabase only for Postgres + Storage + Realtime; keep auth in Better Auth so the auth layer is portable and the GDPR consent model is fully owned in code. |
| **Auth0 / Clerk** | Personal data (emails, names, session data) leaves your infrastructure; US-based primary infrastructure; GDPR Article 46 SCCs required; ongoing SaaS cost |
| **Prisma ORM** | Binary query engine causes cold-start latency in serverless; harder to write raw optimized SQL; migration system less flexible than Drizzle; Drizzle is the 2025 default for new TypeScript projects |
| **MongoDB** | No ACID transactions spanning collections (needed for medical data integrity); no RLS; JOINs for rankings/stats are painful; no column encryption primitive |
| **Vercel (primary hosting)** | US data processing risk on non-EU edges; expensive at scale; less control over runtime; not needed since Coolify on Hetzner is cheaper and EU-resident |
| **Pusher (managed) / Ably** | Real-time messages would leave your infrastructure; GDPR data processing agreement required; ongoing cost; Supabase Realtime gives the same managed primitive in the same region as your database |
| **Soketi (self-hosted)** | Originally recommended but adds WebSocket service ops burden; Supabase Realtime replaces it as a managed primitive on the same platform as the DB |
| **Cloudflare R2 (as primary v1 storage)** | Excellent product but Storage on Supabase shares the same auth context as RLS, which simplifies the signed-URL pattern significantly; revisit R2 in v2 if egress costs grow at scale |
| **Mux / Wistia** | US-based video infrastructure; player video (faces, performance data) is personal data under GDPR; SCCs required; cost |
| **React Big Calendar** | Effectively unmaintained; no drag-resize; no rrule; poor locale support; FullCalendar is strictly better |
| **react-i18next** | Heavier than `next-intl` for Next.js App Router; `next-intl` has built-in RSC support and server-side translation |
| **Moment.js** | Deprecated; large bundle; use `date-fns` v3 instead |
| **jQuery** | Not relevant in 2025; not compatible with React component model |

---

## Testing & Quality Assurance

**Choice:** Vitest (unit) + Playwright (E2E) + k6 (load) + dedicated RBAC integration test suite

- **Vitest** (`^2.x`) for unit tests on business logic, service layer, RBAC helpers, RRULE expansion, audit log writers
- **Playwright** (`^1.x`) for E2E user journeys: login → calendar create → player notification, role × resource matrix verification, GDPR data-export flow
- **Test database**: separate Supabase project named `vttl-test` (free tier sufficient) reset between test runs via Drizzle migration replay; never test against production
- **k6** for load tests against calendar week view (50 concurrent users, 200 events/week scenario), broadcast send, dashboard query
- **RBAC test matrix**: every role × every sensitive endpoint × every entity type, asserts both the happy path AND the unauthorized path returns 403/404
- **GDPR compliance tests**: verify medical reads append to audit log, verify audit log is INSERT-only, verify erasure preserves required aggregates and deletes required identifiers
- CI: GitHub Actions runs Vitest + Playwright on every PR, k6 weekly against staging

---

## Observability & Operations

**Choice:** Pino (structured logs) + Sentry EU (errors, with PII redaction) + Grafana Cloud free tier OR self-hosted Grafana on Hetzner (metrics + dashboards) + UptimeRobot or Better Stack (uptime)

- **Pino** (`^9.x`) with redact filter on `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.email`, `*.phone`, `*.medical_*`
- **Log aggregation**: Logflare (EU region), Axiom (EU available), or self-hosted Grafana Loki on Hetzner — DO NOT store logs in the application database
- **Application metrics**: request latency p50/p95/p99 per tRPC procedure, database query duration via Drizzle query interceptor, error rate per endpoint
- **Database metrics**: Supabase Pro provides built-in dashboards for connections, slow queries, storage usage; alerts available
- **Slow query log**: Supabase enables `log_min_duration_statement = 500ms` (queries over 500ms logged); review weekly during build phase
- **Sentry EU**: error tracking with PII scrubbing config (`beforeSend` callback strips known sensitive fields)
- **Uptime**: Better Stack or UptimeRobot polls `/api/health` every 60s; alerts to Slack/email on failure
- **Alerting**: error rate > 1%, p95 latency > 1s on calendar/dashboard, database connection saturation > 80%, audit log write rate > 100/sec (suspicious)

---

## Cost Estimate (realistic, monthly)

| Item | Cost | Notes |
|------|------|-------|
| Supabase Pro (DB + Storage + Realtime + PITR backups) | $25 | EU/Frankfurt region, 8GB DB, 100GB transfer included |
| Supabase Storage (estimated 10GB) | ~$0.20 | $0.021/GB/month |
| Supabase egress (estimated 30GB/month) | ~$2.70 | $0.09/GB |
| Hetzner CX31 VPS (Next.js app + Coolify) | €13 | 4 vCPU, 8GB RAM — sufficient for 50–200 users |
| Mailgun EU (transactional email, ~5k/month) | $15 | Or SendGrid EU equivalent |
| Sentry EU (developer tier) | $0 | Free up to 5k events/month |
| Better Stack (uptime + log aggregation) | $0–10 | Free tier covers v1 |
| Domain + DNS | €1 | Annual, amortized |
| FullCalendar premium plugins (v2 only) | €0 | MIT plugins sufficient for v1; budget €150/year for v2 resource view |
| **Total v1 (running)** | **~€55/month** | Excludes development time and one-time DPIA legal review |
| **Total v2 (with Cloudflare Stream)** | **~€80/month** | Adds video infrastructure |

**Original estimate of ~€15/month was incomplete.** Factor in email service, monitoring, and storage egress; realistic v1 ops cost is ~€50–60/month.

---

## Migration Strategy (legacy VTTL data)

**Assumption:** VTTL has existing player records, rankings, tournament results in another system (Excel/Access/legacy CMS).

**Approach:**
1. **Inventory**: catalogue what data exists, in what format, with what fidelity (especially: are historical rankings preserved as time-series, or only current values?)
2. **Schema mapping**: define ETL mapping from legacy fields → Drizzle schema; flag fields without a clear source (will need TD review)
3. **Staging migration**: run ETL against a Supabase staging project; verify row counts, foreign key integrity, RLS visibility per role
4. **Gap analysis**: rankings without historical data points = single time-series row at migration date; tournament results without per-match detail = level-1 result only; missing emergency contacts for minors = explicit TD review queue
5. **Production cutover**: ETL run during low-activity window (e.g., Sunday 02:00 CET); verification report sent to TD before opening platform
6. **Rollback plan**: legacy system remains read-accessible for 30 days after cutover

---

## Browser & Device Support Matrix

| Tier | Browsers | Devices | Tested? |
|------|----------|---------|---------|
| Tier 1 (full support) | Chrome, Firefox, Edge, Safari (latest 2 versions) | Desktop, iPad | Yes — every release |
| Tier 2 (best effort) | Mobile Safari, Chrome Android | iPhone, Android phone | Yes — calendar single-day view, profile view, messages |
| Tier 3 (not supported) | IE 11, Edge < 15, Safari < 15 | — | No |

- Calendar week view: Tier 1 desktop only; mobile (Tier 2) gets single-day view via FullCalendar `windowResizeDetect`
- Touch interaction for drag-resize: Tier 2 supported but not encouraged (desktop is the editing surface)
- PWA manifest in v1.1: enables "add to home screen" on mobile for parents/players (not v1 must-have)

---

## Key Risks

### 1. GDPR Medical Data Compliance
**Risk:** Medical records (injuries, treatments, psychological evaluations) are special-category data under GDPR Article 9. A breach or unlawful access could result in fines up to €20M or 4% of global turnover, plus reputational damage to VTTL.
**Mitigation:** Column-level encryption, PostgreSQL RLS, audit logging on every access, strict RBAC, DPO appointment (or documented decision not to appoint), Privacy Impact Assessment (DPIA) before launch.

### 2. Minor Athletes
**Risk:** Elite youth players (under 16) require parental consent for data processing under Belgian implementation of GDPR.
**Mitigation:** Consent flow in registration, `parent_guardian` role, minor flag on player profiles, parental access portal, legal review of consent forms.

### 3. Vendor Lock-in for Video (v2)
**Risk:** AI video analysis is a v2 feature; the v1 decision to use external URLs (YouTube/Vimeo) means video re-upload effort if v2 wants AI analysis on archived footage.
**Mitigation:** Accept this — v1 ships faster without storage infra. When v2 AI analysis lands, Cloudflare Stream becomes the upload destination, and videos uploaded from v2 onward will be analysis-ready. Older external links remain as-is.

### 4. Supabase Lock-in
**Risk:** Choosing Supabase as managed Postgres + Storage + Realtime ties operational dependencies to a single vendor.
**Mitigation:** Treat Supabase as Postgres-host-only at the application level — define all schemas, migrations, and RLS in Drizzle code; never use the Supabase JS SDK from the application backend; access Postgres via standard URL. Storage migrates to R2/S3 via standard sync if needed. Realtime can be replaced by self-hosted Soketi if a future scale ceiling appears. Migration cost is bounded.

### 5. Next.js Upgrade Velocity
**Risk:** Next.js releases breaking changes frequently (App Router, Turbopack, RSC patterns). A platform built on Next.js 15 will need active maintenance.
**Mitigation:** Pin minor versions in `package.json`, test upgrades on a staging branch, follow the official upgrade guide. The architecture (tRPC, Drizzle, Tailwind) is Next.js-version-agnostic.

### 6. Single Developer / Small Team Bus Factor
**Risk:** If one key developer leaves, institutional knowledge of the custom RBAC, encryption, and audit logic is lost.
**Mitigation:** Document RBAC rules and encryption keys in code comments + ADRs (Architecture Decision Records in `.planning/`). Store encryption keys in a secrets manager (Hetzner Vault or Bitwarden Secrets Manager), not in environment variables committed to git.

### 7. FullCalendar License
**Risk:** FullCalendar resource/timeline plugins (needed for multi-player scheduling in v2) are commercial licensed.
**Mitigation:** Budget ~€150/year for the premium license. The MIT-licensed plugins cover all v1 requirements.

---

*Research date: 2026-05-01*
*Based on ecosystem state as of mid-2025. Versions should be verified against npm at project init.*
