# Research Summary — VTTL Topsportplatform

*Synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, and PITFALLS.md — 2026-05-01*

---

## Recommended Stack

| Layer | Choice | Version |
|-------|--------|---------|
| Frontend | Next.js (App Router) | 15.x |
| UI | shadcn/ui + Tailwind CSS | 4.x |
| API | tRPC | 11.x |
| Database | PostgreSQL | 16.x |
| ORM | Drizzle ORM | 0.40.x |
| Auth | Better Auth (self-hosted) | 1.x |
| Calendar | FullCalendar | 6.x |
| File storage | Cloudflare R2 | — |
| Real-time | Soketi (self-hosted) | 1.x |
| Video (v1) | External URL + react-player | — |
| Video (v2) | Cloudflare Stream | — |
| Deployment | Coolify on Hetzner (EU) | — |

**Key stack rationale:**
- Next.js Server Components render sensitive medical data server-side (never leaks to client bundle — GDPR advantage)
- tRPC gives end-to-end TypeScript type safety — eliminates a large class of frontend bugs for a complex 6-role domain
- Better Auth self-hosted: all user data stays in our own PostgreSQL — required for GDPR, no DPA with auth vendor
- Coolify + Hetzner: EU data residency guaranteed, full data control, ~€15/month vs Vercel's US edge risk + cost

---

## Architecture Pattern: Modular Monolith

One deployment, one PostgreSQL database, but strict internal module boundaries. Each module owns its Drizzle models, tRPC router, and service layer. Cross-module calls go through service layers only — no direct cross-module database joins.

**Critical non-negotiables (cannot be retrofitted):**
1. **PostgreSQL RLS** — enforced at DB engine level regardless of application code path (GDPR backstop)
2. **CallerContext in tRPC middleware** — `{ userId, role, academyIds, linkedPlayerIds }` injected into every query
3. **Medical data in separate table family** — `medical_events`, `medical_documents` with own RLS + audit log on every read
4. **`TIMESTAMPTZ` everywhere** — UTC storage, IANA timezone on tournament records
5. **Rankings as pure time series** — never a flat field on the player record
6. **RRULE-based recurring events** — never materialize occurrences in the database
7. **Signed URLs for all file access** — never public bucket URLs, especially for medical documents
8. **Polymorphic calendar** — shared `calendar_events` base + typed extension tables (not single-table inheritance)

---

## Table Stakes (must have or platform fails)

- Role-scoped single login — each role sees a completely different data slice
- Stable player IDs that survive season rollovers
- Ranking history as a chart (not just current value) — coaches check trajectory
- ICS/iCal export for calendar — athletes add events to personal calendars
- Broadcast messaging with read receipts
- Medical data visible as traffic-light injury status to coaches; full record to medical/TD only
- GDPR consent record per user at registration
- Data export (Art. 20) and erasure workflow (Art. 17)
- Attendance tracking per training session

---

## Key Differentiators for This Platform

- **Longitudinal tracking** — ranking trajectory overlaid with training calendar (almost no platform does this)
- **Sparring partner register as discovery** — filterable by playing style (critical for table tennis preparation)
- **Role-specific fixed dashboards** — not generic configurable widgets
- **Two-level tournament results** — per-tournament ranking AND per-match score (linked but separate)
- **Ambition vs. actuals comparison** — per player / per year / per tournament type

---

## Anti-Features: Explicitly Do Not Build

| Anti-Feature | Why |
|---|---|
| Slack-style channels/threads | Broadcast + 1:1 covers 95% of use cases; channels fragment communication |
| Drag-and-drop dashboard customization | High complexity, low value at this scale; curated views are better |
| Public athlete profile pages | VTTL already has public ranking pages; creates GDPR surface area |
| Gamification / badges | Condescending in elite sport; rankings are the real leaderboard |
| In-platform video storage (v1) | Complex + expensive; external URLs (YouTube/Vimeo) are sufficient for v1 |
| AI training plan generation | Requires 2+ seasons of data density; coaches resist; liability risk |
| League standings | VTTL already publishes these |
| In-platform payments | Introduces PCI-DSS scope; separate product |

---

## Critical GDPR Requirements

- **Art. 9 medical data**: separate table, column-level encryption (`pgcrypto`), audit log on every read, explicit consent per player
- **Art. 8 minor consent**: Belgian threshold is 16; parental consent for under-16; `parent_child_links` table is also the consent record
- **Art. 17 erasure**: anonymize (not delete) training/ranking history; full delete for medical records; consent records retained as proof of lawful processing
- **Art. 20 portability**: `/my-data` endpoint generating JSON/PDF export per user
- **Audit log**: append-only, covers medical access, permission changes, erasure requests — targeted, not generic triggers
- **Vendors**: DPA required with Cloudflare (R2 + Stream), Hetzner; no personal data to US-based vendors

---

## 27 Pitfalls to Avoid

**5 critical (cause project failure):**
1. UI-only permission enforcement — enforce at DB layer (RLS) and service layer
2. Medical data co-mingled with profile data — separate table family from day one
3. Hard-coded role checks scattered — centralize in `players_visible_to()` function + policy layer
4. Naive datetime storage — `TIMESTAMPTZ` + UTC + IANA tz on events, always
5. Right to erasure not designed for — anonymize vs. delete distinction in schema from day one

**Domain-specific traps to avoid:**
- Club ≠ academy — separate fields, separate lookups, schema-enforced
- Tournament result entry not API-gated to owning player
- Ranking direction undefined per type (world = lower is better; Belgium = check)
- Ambitions comparison failing when no results exist (LEFT JOIN, show "not yet competed")
- Sparring partner bypassed as free-text on session (junction table only, no text field)
- Age category derived live from DOB (store explicitly, update seasonally)
- Evaluation point scores not versioned (snapshot label at eval creation)

---

## Build Order Summary

| Phase | Focus | Parallel? |
|-------|-------|-----------|
| 1 | Foundation: DB schema, auth, RBAC, lookups | — |
| 2 | Identity: users, player profiles, trainer profiles | — |
| 3 | Infrastructure: file storage, notifications (thin) | Parallel |
| 4 | Calendar engine (central daily surface) | — |
| 5 | Core domain: training, tournaments, rankings | Parallel after P4 |
| 6 | Secondary domain: sparring, ambitions, evaluations, medical, meetings, stages | Parallel after P5 |
| 7 | Communication: messaging | — |
| 8 | Synthesis: player dashboard, player view | — |
| 9 | v2: AI video analysis pipeline | Deferred |

**Day 1 operational target:** Phases 1–6 complete. Calendar populated with all event types, player profiles with evaluations and results, role-scoped access working.

---

*Synthesized: 2026-05-01*
