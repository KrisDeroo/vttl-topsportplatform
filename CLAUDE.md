<!-- GSD:project-start source:PROJECT.md -->
## Project

**VTTL Topsportplatform**

An operational elite sports management platform for the Flemish Table Tennis League (VTTL — Vlaamse Tafeltennis Liga). It supports the full lifecycle of elite player development: training management, tournament tracking, rankings, evaluations, medical follow-up, calendar coordination, internal communication, and AI-assisted video analysis. Primary users are the technical director, coaches, players, parents, academy managers, and sparring partners.

**Core Value:** Every player's complete development picture — training quality, competition results, rankings, evaluations, and ambitions — is visible in one place, accessible by the right people, and actionable in daily sports operations.

### Constraints

- **Language**: Multilingual UI — Nederlands (nl, default), English (en), Frans (fr). All user-facing labels, copy, validation messages, transactional emails, and consent text must be available in all three locales before production. Per-user `preferred_locale` persisted; lookup display via i18n message catalogs (codes in DB, labels in catalogs); proper nouns (academy names, club names, person names) not translated. Backend logs and source code remain English.
- **Privacy/GDPR**: Medical data, parent-child links, and role scoping must be technically enforced; consent tracking required (consent text versioned per locale; legal review per language)
- **Usability**: Platform must be operationally strong from day one — not an MVP skeleton. Calendar and player view are the two most critical daily-use surfaces
- **Calendar**: Week view (Outlook-style) is mandatory for v1; must support all event types with color coding
- **Data integrity**: Lookups (status, academy, tournament type, ranking type, etc.) must be centrally managed, not free-text
- **Authorization**: Role scoping is a hard constraint, not a soft guideline — enforced at API/data layer
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
| Layer | Choice | Version | Confidence |
|-------|--------|---------|------------|
| Frontend framework | Next.js (App Router) | 15.x | High |
| UI component library | shadcn/ui + Tailwind CSS | shadcn latest / Tailwind 4.x | High |
| Backend API | Next.js Route Handlers + tRPC | tRPC 11.x | High |
| Alternative backend (if split) | NestJS | 11.x | Medium |
| Database | PostgreSQL | 16.x | High |
| ORM | Drizzle ORM | 0.40.x | High |
| Auth / RBAC | Lucia v3 (self-hosted) or Better Auth | 3.x / 1.x | High |
| Calendar | FullCalendar | 6.x | High |
| File storage | Cloudflare R2 (S3-compatible) | — | High |
| Real-time / Messaging | Soketi (self-hosted Pusher) + Pusher JS | 1.x / 8.x | Medium |
| Video handling | Cloudflare Stream | — | High |
| Deployment | Coolify (self-hosted VPS) or Railway | latest | Medium |
| GDPR tooling | Custom audit log + pg_audit + data-at-rest encryption | — | High |
## Detailed Recommendations
### Frontend
- Server Components by default — critical for role-based rendering (showing/hiding sensitive medical data server-side, not leaking it to the client bundle)
- Built-in file-based routing, nested layouts ideal for dashboard modules (player profiles, evaluations, medical follow-up)
- Streaming + Suspense for perceived performance on data-heavy pages (rankings time series, video pages)
- Partial Prerendering (PPR) introduced in Next.js 14/15 — static shell + dynamic content, perfect for the calendar and rankings pages
- First-class TypeScript support; the entire VTTL codebase should be fully typed
- Strong ecosystem: the most-hired frontend skill in Belgium/Netherlands in 2025
- `next`: `^15.3`
- `react`: `^19.0`
- `react-dom`: `^19.0`
- `typescript`: `^5.5`
- `tailwindcss`: `^4.0` (Tailwind v4 is a complete rewrite; no config file, CSS-first, ~10x faster builds)
- `shadcn/ui`: installed per-component via CLI (not a versioned npm package — components live in your repo)
- `@tanstack/react-table` `^8.x` — headless table with sorting/filtering for player rankings, tournament results
- `@tanstack/react-query` `^5.x` — server state management (pairs with tRPC)
- `react-hook-form` `^7.x` + `zod` `^3.x` — form validation (player profiles, evaluations); Zod schemas shared with backend
- `recharts` `^2.x` or `chart.js` / `react-chartjs-2` — time-series ranking charts, performance dashboards
- `date-fns` `^3.x` — date handling (no Moment.js); good locale support for `nl-BE`
- `next-intl` `^3.x` — i18n for Dutch/Flemish UI strings
- **Create React App** — deprecated, unmaintained since 2023
- **Vite + React (SPA-only)** — loses server-side rendering; medical data rendered client-side is a GDPR risk; no SSR means worse initial load for calendar/rankings
- **Vue 3 / Nuxt 3** — technically solid but the Belgian/Flemish dev talent pool is predominantly React/Next.js; hiring/handover risk
- **SvelteKit** — excellent DX but immature ecosystem for the specialized libraries needed (FullCalendar integration, complex table components); smaller hiring pool
- **Angular** — verbose, over-engineered for this scale; not the 2025 default for new projects
### Backend
- End-to-end type safety: define a procedure once, get fully typed client calls — no code generation, no OpenAPI drift
- Input validation via Zod (shared schemas with the frontend)
- Subscriptions (via WebSocket transport) for real-time messaging
- Middleware for RBAC checks at the router level
- `@trpc/server`: `^11.x`
- `@trpc/client`: `^11.x`
- `@trpc/next`: `^11.x`
- `@trpc/react-query`: `^11.x`
- Decorator-based, opinionated structure (important for long-term maintainability)
- First-class OpenAPI/Swagger generation
- Guard system maps directly to RBAC roles
- WebSockets module (Gateway)
- Strong Belgian/.nl enterprise adoption
- **Express** — unopinionated, no built-in structure; requires assembling too many pieces; security footprint harder to audit for GDPR
- **Fastify** — faster than Express but still requires assembly; lacks the type-safety ergonomics of tRPC or NestJS at this scale
- **Django / Python** — team would need to be Python-fluent; no type sharing with TypeScript frontend; adds operational complexity
- **Ruby on Rails** — not relevant for new Belgian sports tech projects in 2025; talent pool near zero
### Database
- Best-in-class ACID compliance — non-negotiable for medical data (GDPR special category)
- Row-level security (RLS) — enforce data access rules at database level as a second layer behind application RBAC
- JSONB columns — useful for storing flexible training plan structures, evaluation schemas that evolve over time
- Time-series ranking data: use `timescaledb` extension (free tier) or PostgreSQL partitioning with an indexed `recorded_at` column
- Full-text search in Dutch (with `pg_trgm` and `unaccent` extensions) for player search
- `pgcrypto` extension — column-level encryption for special-category medical fields at rest
- Strong managed hosting: Neon (serverless, branching for dev/test), Supabase (adds realtime + storage), or self-hosted with pgBackRest
- Fully type-safe, lightweight (no heavy runtime like Prisma's query engine binary)
- SQL-first philosophy: you write SQL-like TypeScript, not magic abstractions; easier to audit for security
- Drizzle Kit migrations: schema-as-code with versioned migration files (important for auditability under GDPR)
- ~3–10x faster queries than Prisma in benchmarks for read-heavy workloads (rankings, leaderboards)
- Works in Next.js Edge Runtime (useful for middleware auth checks)
- Separate `medical_records` table with a strict column list (no `SELECT *` queries)
- `audit_log` table: every INSERT/UPDATE/DELETE on sensitive tables logs `user_id`, `timestamp`, `action`, `table_name`, `row_id` — mandatory for GDPR accountability
- `data_retention_policy` column on tables holding personal data: automate deletion via pg_cron
- **MySQL / MariaDB** — weaker JSONB support, no RLS, inferior full-text search; no technical reason to choose over PostgreSQL in 2025
- **MongoDB** — document model is tempting for flexible evaluations but ACID guarantees are weaker; medical data needs relational integrity; JOIN-heavy queries for rankings/player history are painful
- **SQLite** — not suitable for multi-user concurrent write workload
- **Prisma ORM** — the binary query engine introduces a deploy-time footprint, cold start latency in serverless, and the generated client is harder to audit; Drizzle is the 2025 default for new projects
- **TypeORM** — decorator-based, heavy, poor Next.js/Edge compatibility; largely superseded
### Auth / RBAC
- Open-source, self-hosted TypeScript auth library (the 2025 successor pattern to Lucia)
- Built-in session management, email/password, OAuth providers
- Plugin system: organizations/teams plugin maps directly to the VTTL role hierarchy
- RBAC plugin: define roles and permissions as code, checked in tRPC middleware
- All data stays in your PostgreSQL database — no personal data sent to a third-party auth vendor (critical for GDPR)
- Works natively with Next.js App Router, Drizzle, and tRPC
- Store `role` + `permissions[]` in session JWT (signed, not encrypted)
- Enforce at tRPC middleware layer (fast, before DB hit)
- Re-enforce at Drizzle query layer using RLS policies (defence in depth)
- Never trust client-supplied role claims
- **Auth0** — personal data (email, name, roles) stored on Auth0 servers in the US; GDPR data transfer risk; expensive at scale; overkill for a single-org platform
- **Clerk** — same data residency concern; US-based infrastructure by default; GDPR compliance requires EU data residency add-on (paid, complex)
- **NextAuth / Auth.js v5** — good for basic OAuth but the RBAC and organization primitives are thin; you end up building the permission layer anyway; Better Auth is strictly more capable for this use case
- **Firebase Auth** — Google-controlled infrastructure; GDPR data processing agreement complexity; no fine-grained RBAC
- **Keycloak** — enterprise-grade and GDPR-safe but operationally heavy (Java, own DB, complex admin UI); overkill for a single-tenant sports platform
### Calendar
- `timeGrid` plugin: week and day views with draggable/resizable events — exactly Outlook Week View
- `interaction` plugin: drag-and-drop, resize, click-to-create
- `rrule` plugin: recurring training sessions (e.g., Tuesday/Thursday practice)
- Resource timeline view (premium): useful for scheduling multiple players across facilities — consider for v2
- React wrapper (`@fullcalendar/react`) integrates cleanly with Next.js
- Locale: `@fullcalendar/core/locales/nl` — Dutch locale out of the box
- Exports to iCal (`.ics`) for Outlook sync — important for coaches
- **react-big-calendar** — no longer actively maintained in 2025; missing drag-resize out of the box; inferior Dutch locale support; no rrule support without heavy custom work
- **React Calendar** — basic month/year picker only; not a scheduling calendar
- **Bryntum Calendar** — excellent but very expensive ($3,000+ license); over-engineered for this scale
- **Google Calendar embed** — data goes to Google; GDPR personal schedule data risk; no customization
### File Storage
- S3-compatible API: works with AWS SDK v3 (`@aws-sdk/client-s3`), no vendor lock-in
- **Zero egress fees** — critical distinction from AWS S3 (which charges per GB downloaded); player video clips and medical PDFs will be downloaded frequently
- EU data residency: R2 stores data in European datacenters — GDPR compliant for personal data (profile photos, medical documents, evaluation PDFs)
- Signed URLs: generate time-limited URLs for secure document access (medical records never publicly accessible)
- Cloudflare Access integration: add IP/identity rules in front of storage access
- Pricing: ~$0.015/GB/month storage, $0 egress — significantly cheaper than S3 or GCS at this scale
- Player profile photos
- Medical document uploads (PDF/images) — store with AES-256 encryption server-side, access via signed URL only
- Training video clips (short clips; longer match videos via Cloudflare Stream — see Video section)
- Evaluation PDF exports
- Tournament result attachments
- **AWS S3** — egress costs add up; more complex IAM; overkill for a single small-team platform; R2 is strictly better value with same API
- **Supabase Storage** — viable but ties you to the Supabase ecosystem; limits flexibility; R2 is more portable
- **Google Cloud Storage** — same egress cost issue as S3; GDPR requires specific GCP EU region config which is error-prone
- **Local disk / VPS storage** — no CDN, no redundancy, no signed URLs; not production-grade; backup complexity
### Real-time / Messaging
- Open-source, self-hosted Pusher-compatible WebSocket server (Node.js)
- Drop-in replacement for Pusher Channels — use the official `pusher-js` client without modification
- Deploy alongside the app on the same VPS/container cluster
- All message data stays on your own infrastructure — GDPR compliant (no messages routed through third-party servers)
- Horizontal scaling via Redis adapter (if needed later)
- Store all messages in PostgreSQL (`messages` table with `sender_id`, `recipient_id`, `thread_id`, `body`, `sent_at`, `read_at`)
- Soketi handles real-time delivery; PostgreSQL is the source of truth
- Messages are end-to-end auditable (GDPR accountability)
- **Pusher Channels (managed)** — messages pass through Pusher's servers in the UK/US; GDPR data processing agreement required; ongoing cost; data residency unclear for medical-adjacent content
- **Ably** — same third-party data concern; expensive
- **Socket.io** — solid but Soketi/Pusher ecosystem has better DX and the client library is more battle-tested; Socket.io requires more custom protocol work
- **Firebase Realtime Database** — Google infrastructure; GDPR complexity; schema-less, hard to audit
### Video
- Upload once, Stream delivers adaptive bitrate (HLS/DASH) to any device
- EU storage and delivery — GDPR compliant
- Access control: signed tokens per video (time-limited, user-specific) — no public video URLs
- Thumbnail generation, trim, per-second seeking
- Webhook on upload completion: trigger AI analysis job (v2)
- Cost: $5/1,000 minutes stored + $1/1,000 minutes delivered — very reasonable for a small elite squad
- Upload to Cloudflare Stream → webhook → queue job (BullMQ + Redis) → run pose estimation / shot detection model → store annotations in PostgreSQL
- Model options: MediaPipe Pose (client-side, privacy-preserving), or a server-side Python microservice with YOLOv8 + custom table tennis detection model
- **Mux** — excellent product but US-based; GDPR data transfer concern for match footage; more expensive than Cloudflare Stream
- **AWS MediaConvert + S3** — complex pipeline, high operational overhead, no EU data guarantee out-of-box
- **Direct R2 video serving** — no transcoding, no adaptive bitrate; breaks on mobile; large files drain bandwidth
- **YouTube (private)** — video data processed by Google; GDPR personal data (player faces); unacceptable for elite sports with minors
### Deployment
- EU-based (Germany/Finland datacenters) — data residency guaranteed
- CX31 instance (4 vCPU, 8GB RAM): ~€13/month — sufficient for initial load
- CX41 (8 vCPU, 16GB RAM): ~€25/month for production
- Hetzner Object Storage: S3-compatible, EU, cheap — alternative to Cloudflare R2 if you want everything on one provider
- Open-source Heroku/Vercel alternative you deploy on your VPS
- One-click deployment from GitHub via Nixpacks or Dockerfile
- Managed PostgreSQL, Redis, Soketi as services
- Automated SSL (Let's Encrypt), reverse proxy (Caddy), backups
- No vendor lock-in; you own all data
- Managed PaaS; EU region available
- Faster to start (no VPS setup)
- More expensive at scale (~$20–50/month for the stack vs ~€15/month on Hetzner)
- Suitable if the team has no DevOps experience
- GitHub Actions for build, test, lint on PR
- Coolify webhook deploys on merge to `main`
- **Vercel** — excellent for Next.js but: (1) function execution data may pass through US edge nodes (GDPR risk); (2) no persistent WebSocket connections (Soketi won't work); (3) Postgres via Neon/external; (4) expensive at scale. Use only if you use Vercel's EU region exclusively and accept the constraints.
- **AWS / GCP / Azure** — correct choice for a large organization but massive operational overhead for a 2–3 person team; cost and complexity unjustified
- **Netlify** — primarily static; poor fit for Next.js App Router with dynamic RSCs and WebSockets
- **Render** — viable but EU region is US-West by default; GDPR data residency requires manual configuration; less control than Coolify
### GDPR
- Store in a separate `medical_records` table, never joined into general queries
- Column-level encryption using `pgcrypto` (`pgp_sym_encrypt`) for diagnosis fields
- Access logged to `audit_log` on every read (not just writes)
- Accessible only to `medical_staff` and `admin` roles — enforced at both tRPC middleware and PostgreSQL RLS
- Store explicit consent records in `consent_log` table: `user_id`, `purpose`, `consented_at`, `withdrawn_at`, `ip_hash`
- Cookie consent: `@consent-manager/react` or a simple custom banner — no third-party consent SaaS needed for an internal platform
- Track: (1) general platform use, (2) medical data processing, (3) video analysis (v2)
- Right of access: build a `/my-data` export endpoint that generates a JSON/PDF of all data held on a user
- Right to erasure: `anonymize_user(user_id)` function in PostgreSQL — replaces PII with pseudonyms, retains statistical data for rankings history
- Right to portability: standard JSON export format
- Implement as admin UI screens, not just theoretical procedures
- `pg_cron` extension: schedule nightly jobs to delete/anonymize records past retention period
- Define retention periods per data category in a `data_retention_config` table (auditable, configurable without code deploy)
- Medical records: retain for legal minimum (Belgium: 30 years for medical records under the Patient Rights Act), then archive to encrypted cold storage
- Every sensitive action (login, data access, data change, export) writes to `audit_log`
- Audit log is append-only (no UPDATE/DELETE permissions for app user on this table)
- Include: `actor_id`, `action`, `resource_type`, `resource_id`, `timestamp`, `ip_address`, `user_agent`
- Implement a `security_incidents` table and an admin screen for logging and tracking incidents
- Belgian DPA (GBA) must be notified within 72 hours of a breach — have the process documented
# No single npm package covers GDPR — implement these patterns:
- Cloudflare R2: sign Cloudflare DPA, enable EU region
- Cloudflare Stream: same DPA
- Hetzner: sign Hetzner DPA (available in German/English)
- GitHub (code only, no personal data): standard DPA
- No personal data in error tracking tools (Sentry) without pseudonymization
## What NOT to Use (and Why)
| Technology | Why NOT |
|-----------|---------|
| **Firebase (any module)** | Google infrastructure; GDPR data residency and processing complexity; vendor lock-in; no SQL = no RLS; realtime DB has no audit capability |
| **Supabase (as primary)** | Good product but adds a managed layer between you and your DB; RLS defined in Supabase dashboard not in code = drift risk; auth tied to Supabase; limits portability |
| **Auth0 / Clerk** | Personal data (emails, names, session data) leaves your infrastructure; US-based primary infrastructure; GDPR Article 46 SCCs required; ongoing SaaS cost |
| **Prisma ORM** | Binary query engine causes cold-start latency in serverless; harder to write raw optimized SQL; migration system less flexible than Drizzle; Drizzle is the 2025 default for new TypeScript projects |
| **MongoDB** | No ACID transactions spanning collections (needed for medical data integrity); no RLS; JOINs for rankings/stats are painful; no column encryption primitive |
| **Vercel (primary hosting)** | No persistent WebSocket support (kills Soketi); US data processing risk on non-EU edges; expensive at scale; less control |
| **Pusher (managed)** | Real-time messages leave your infrastructure; GDPR data processing agreement required; ongoing cost; Soketi gives identical API for free |
| **Mux / Wistia** | US-based video infrastructure; player video (faces, performance data) is personal data under GDPR; SCCs required; cost |
| **React Big Calendar** | Effectively unmaintained; no drag-resize; no rrule; poor locale support; FullCalendar is strictly better |
| **react-i18next** | Heavier than `next-intl` for Next.js App Router; `next-intl` has built-in RSC support and server-side translation |
| **Moment.js** | Deprecated; large bundle; use `date-fns` v3 instead |
| **jQuery** | Not relevant in 2025; not compatible with React component model |
## Key Risks
### 1. GDPR Medical Data Compliance
### 2. Minor Athletes
### 3. Vendor Lock-in for Video (v2)
### 4. Real-time Messaging at Scale
### 5. Next.js Upgrade Velocity
### 6. Single Developer / Small Team Bus Factor
### 7. FullCalendar License
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
