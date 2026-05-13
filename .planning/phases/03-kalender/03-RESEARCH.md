# Phase 3: Kalender — Research

**Researched:** 2026-05-14
**Domain:** Polymorphic calendar event modelling, server-side RRULE expansion, role-scoped event visibility (RLS), conflict detection with role-gated redaction, FullCalendar 6.x in Next.js 15 + React 19 App Router, multilingual (nl/en/fr) operational UI surface
**Confidence:** HIGH — research strongly anchored in the locked CONTEXT.md (D-47..D-59) and approved UI-SPEC.md; ecosystem patterns verified against current Phase 1+2 reference implementation and live npm registry

---

## Summary

Phase 3 builds the calendar — the most complex single surface in v1 and the daily work surface for every role. The shape is locked by CONTEXT.md and UI-SPEC.md and this research's job is to translate those locked decisions into prescriptive implementation guidance.

The five hard problems Phase 3 solves are: (1) **polymorphic event modelling** — a base `calendar_events` table + 6 typed extension tables joined by `event_id PK FK ON DELETE CASCADE`, with **full type-specific domain columns shipped in Phase 3** (D-47 scope shift); (2) **server-side RRULE expansion** — `rrule` 2.8.1 with explicit `dtstart` injection from `calendar_events.starts_at`, `RRuleSet` for exceptions, expanded into flat `EventInstance[]` server-side before reaching the wire; (3) **role-scoped visibility** — a fifth `*_visible_to(uid, role) RETURNS SETOF uuid` SECURITY DEFINER helper in the Phase 1 RLS pattern, plus a sibling `overlapping_events_for_users(uids[], from, to)` SECURITY DEFINER that **deliberately bypasses RLS** for cross-scope conflict detection with role-gated redaction at the service layer; (4) **conflict detection** that warns but never blocks — per-participant overlap, `force: true` override, audit-logged; (5) **FullCalendar 6.x integration** as a single `'use client'` boundary, server-side data via tRPC, custom event chips via `eventContent` (returning React JSX nodes consumed by Preact under the hood — no hooks allowed), `headerToolbar={false}` because the app owns the toolbar.

The **biggest unknowns**: (a) whether `tstzrange` + GiST exclusion-constraint or plain B-tree on `(starts_at, ends_at)` performs better for the conflict query at our cardinality — defer to EXPLAIN ANALYZE at plan time; (b) whether single-occurrence-override on an RRULE-event in conflict detection requires expanding both events' RRULEs or just one — see RRULE section below for the answer (both, but bounded by the candidate event's window ±15 days).

**Primary recommendation:** Ship in three migrations (0009 base + lookups + participants + exceptions; 0010 six extension tables; 0011 RLS helper + policies + SECURITY DEFINER overlap function). One tRPC router `calendar.ts` with sub-namespaces. Shared `src/lib/rrule.ts` helper. One `'use client'` `<CalendarView>`; everything else Server Components. Six new `--cal-event-{type}-{bg|fg|border}` tokens in `globals.css` per UI-SPEC. **No caching layer in Phase 3** — RISK-POLYMORPH budget (< 200 ms / week-range) is reachable on indexes alone.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-47 (event types in Phase 3):** All 6 event types ship full CRUD with their domain-specific columns. `training_sessions` (TRAIN-01 fields), `tournaments` (TOURN-01), `meetings`, `stages`, `eval_conversations`, `medical_appointments`. Bewuste scope-uitbreiding ten opzichte van ROADMAP — Phase 4 reduceert tot operationele/result-laag.

**D-48 (create permissions per event type):**
- TD: all 6 types
- Trainer: `training_sessions` + `meetings`
- Player: `meetings`
- Academy_manager: `meetings` (baseline; uitbreiding optioneel)
- Sparring_partner / parent: geen create-rechten in Phase 3
- tRPC per-type procedure presets matrix in `src/server/trpc/middleware/calendarCreate.ts`

**D-49 (polymorphism = class-table inheritance):** `calendar_events` basistabel + 6 typed extension tables, elk `event_id uuid PK REFERENCES calendar_events(id) ON DELETE CASCADE`. `calendar.list` JOINt op `type_code`. Geen single-table inheritance, geen `deleted_at` column.

**D-50 (participant junction):** Eén polymorfische `calendar_event_participants (event_id, user_id, role_in_event, rsvp_status, created_at)` met composite PK + `(user_id, event_id)` index. RLS helper `calendar_events_visible_to(uid, role)` SECURITY DEFINER unionneert TD/player/trainer/academy_manager/parent. **Sparring-partner is no-op in Phase 3**; Phase 4 voegt SPAR-tabel toe.

**D-51 (Phase 4 handover):** Phase 4 voegt enkel toe — `session_participants`, `session_sparring_partners`, `tournament_results`, `match_results`, `ranking_entries`. **Geen wijzigingen aan Phase 3 event-schemas.** Documenteer dit hard in Phase 3 PLAN.

**D-52 (RRULE library):** **`rrule` npm package** (single source voor parse + expand). Geen `rrule-rust`, geen `@fullcalendar/rrule` client-side expansion. Helper in `src/lib/rrule.ts`.

**D-53 (server-side expansion):** `calendar.list({from, to})` haalt base rows + voor `rrule != null` expandeert server-side via `rrule.between(from, to)`. Vlakke `EventInstance[]` stream — één row per occurrence. FullCalendar krijgt nooit raw RRULE.

**D-54 (exceptions table):** `calendar_event_exceptions (id, event_id, occurrence_date, cancelled, override_starts_at, override_ends_at, override_title, override_location, override_description, created_by, created_at)` met `UNIQUE (event_id, occurrence_date)`. Phase 3 = "Deze afspraak" scope only.

**D-55 (2-year horizon — defense in depth):** Write-time validation (`UNTIL` < `created_at + 2y`, auto-inject als "Nooit" gekozen) + read-time clamp (`expandedRange = min(to, event.starts_at + 2y)`). Read-time gate is non-bypassable.

**D-56 (overlap definition — per-participant):** Conflict = elke gebruiker in `calendar_event_participants` van event A komt ook voor in event B EN tijdsbereiken overlappen. Geen locatie-conflict in v1. Recurrent: expand event B's RRULE ±15 dagen.

**D-57 (soft warning + cross-scope detection + role-gated redactie):**
- Nooit blokkeren. `{ conflicts: [...], blocked: false }`. `force: true` override → audit-log entry `calendar_event_conflict_override`.
- Conflict-overlap query via SECURITY DEFINER `overlapping_events_for_users(uids[], from, to)` — bypassed RLS.
- Detail-redactie role-gated. Volledige zichtbaarheid = `is_td(caller) OR caller IN participants(conflicting_event) OR caller = created_by(conflicting_event)`.

**D-57b (copy override — overrides UI-SPEC):** `calendar.conflict.body` aangescherpt naar participant-genoemde vorm in 3 locales:
- **nl:** `**{participant}** is al geboekt voor {detail} {start}–{end}. Toch opslaan?`
- **en:** `**{participant}** is already booked for {detail} {start}–{end}. Save anyway?`
- **fr:** `**{participant}** est déjà réservé pour {detail} {start}–{end}. Enregistrer quand même ?`
- `{detail}` full = `**{title}** ({typeLabel})`; redacted = `een **{typeLabel}**` / `a **{typeLabel}**` / `un **{typeLabel}**`.

**D-58 (three delete operations):**
- **Hard delete** (creator/TD): `DELETE FROM calendar_events WHERE id = ?` + FK CASCADE. Audit-log JSONB snapshot pre-DELETE met `action='calendar_event_deleted'`. Shadcn `<AlertDialog>` confirmation. Geen 30-dagen-restore-promise.
- **RSVP decline** (any participant): `calendar.event.declineParticipation({eventId})` → `rsvp_status='declined'`. Event blijft bestaan voor anderen. Visueel: strikethrough + 50% opacity in eigen kalender.
- **Cancel single occurrence**: `calendar_event_exceptions(event_id, occurrence_date, cancelled=true)` row.

**D-58b (delete copy override — overrides UI-SPEC):** `calendar.event.delete.body` vervangen:
- **nl:** `Deze afspraak wordt definitief verwijderd voor alle deelnemers.`
- **en:** `This event will be permanently deleted for all participants.`
- **fr:** `Ce rendez-vous sera supprimé définitivement pour tous les participants.`

**D-58c (cascade-orde + audit-volgorde):**
1. Open RLS-bound transaction
2. SELECT base + extension + participants + exceptions FOR UPDATE
3. INSERT audit_log met JSONB snapshot van hele row-family
4. DELETE FROM calendar_events WHERE id = ? → FK CASCADE
5. Commit (atomic)

**D-59 (soft-deleted in conflict detection?):** N/A — hard delete betekent row is weg.

### Claude's Discretion

- **Exacte tRPC router file-layout:** één file `src/server/trpc/routers/calendar.ts` met sub-procedures, OF gesplitst in `calendar/event.ts` + `calendar/filterOptions.ts`. Beide passen Phase 1/2 conventies.
- **Migratie-volgorde:** waarschijnlijk 3 migraties (0009 base+participants+exceptions, 0010 extension tables, 0011 RLS+SECURITY DEFINER). Planner mag groeperen anders zolang elk migratie zelfstandig rollbackable is.
- **Filter-combobox preload cardinality:** suggestie max 50 met server-side limit + 200ms debounce.
- **`event_type` lookup-tabel naam:** planner kiest (`event_type` consistent met andere lookups).
- **Composite indexen:** planner valideert via EXPLAIN ANALYZE.
- **BullMQ recurring jobs in Phase 3:** geen.
- **next-intl message-key path:** planner schrijft `messages/{nl,en,fr}.json` keys per UI-SPEC Copywriting Contract met D-57b + D-58b overrides.
- **Locale-loader voor FullCalendar:** dynamische import van `@fullcalendar/core/locales/{nl,en-gb,fr}` per actieve next-intl locale.

### Deferred Ideas (OUT OF SCOPE)

- "Deze en toekomstige" + "Alle afspraken in de reeks" RRULE-edit scope → **Phase 4**
- BYDAY / BYMONTHDAY pickers in RRULE editor → **Phase 4**
- TD restore-UI voor hard-deleted events → niet gebouwd (forensische recovery via audit-log JSONB snapshot)
- Per-user "verberg gedeclineerde events"-toggle → v2
- Locatie-conflict-detectie (zaalboeking) → v2
- Per-event-type RBAC-fijngradering voor academy_manager → planner-discretion baseline
- Sparring-partner entity + `session_sparring_partners` junction + RLS-uitbreiding → **Phase 4**
- Realtime calendar updates (Supabase Realtime) → v2
- ICS / iCal export → **Phase 8** (CAL-06)
- Per-user timezone setting → **Phase 8**
- Right-click context menu, print stylesheet, color customization per user → out of scope

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAL-01 | Calendar week view (default, FullCalendar timeGridWeek) | §FullCalendar Integration — `initialView="timeGridWeek"`, locked toolbar |
| CAL-02 | Month + year views | §FullCalendar — `@fullcalendar/daygrid` + `@fullcalendar/multimonth` plugins |
| CAL-03 | 6 event types color-coded distinct | §Color tokens — six `--cal-event-{type}-{bg|fg|border}` triples (light + dark) per UI-SPEC |
| CAL-04 | CallerContext-scoped events | §RLS — `calendar_events_visible_to(uid, role)` SECURITY DEFINER helper |
| CAL-05 | Filters (player/trainer/sparring/academy/event type) | §tRPC + Filter — `calendar.filterOptions.list({kind, query})` returns only in-scope options |
| CAL-07 | Server-side conflict detection | §Conflict Detection — `overlapping_events_for_users(uids[], from, to)` SECURITY DEFINER + role-gated redaction in service layer |
| CAL-08 | Mobile single-day + swipe nav | §Mobile Strategy — vanilla pointerevents, no library, 640px breakpoint per UI3-D7 |
| TRAIN-01 | Training session schema | §Schema — `training_sessions` extension table with date/start/duration/training_type_code/organisation_code/trainer_id/locatie |
| TOURN-01 | Tournament schema | §Schema — `tournaments` extension with naam/startdatum/stad/land/leeftijdscategorie_code/tournament_type_code |
| MED-EVENT | Medical appointment event schema (non-Article-9) | §Schema — `medical_appointments` extension; **no medical body content** — doctor as free text is a borderline; flag for Phase 5 legal review |
| AGE-01..04 | Stage/meeting/eval-conv/tournament-on-calendar schemas | §Schema — `stages`, `meetings`, `eval_conversations` extensions |
| GDPR-04 | Audit on calendar mutations | §Audit Pattern — `writeAudit` on create/update/delete/decline/conflict-override + pre-delete JSONB snapshot |
| GDPR-08 | TIMESTAMPTZ UTC everywhere | §Schema — `tstz()` helper reused (already enforced via lint rule) |
| I18N-05 | Lookup codes in DB, labels via i18n | §Schema — `event_type` lookup with 6 codes; labels in `messages/{nl,en,fr}.json` `lookup.eventType.*` |
| I18N-06 | Proper nouns not translated | §i18n — academy/club/person names stored canonical |
| I18N-07 | Date/time formatting via `src/lib/i18n-format.ts` | §i18n — reused for recurrence summaries + event detail |
| I18N-08 | Zod messages as i18n keys | §tRPC Schemas — `errors.calendar.*` namespace |
| USER-04 | Role scope enforcement at API + DB layer | §RLS — policies on `calendar_events`, `calendar_event_participants`, `calendar_event_exceptions` + 6 extension tables |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Polymorphic event schema (base + 6 extensions) | Database (Postgres) | — | Structural integrity via FK CASCADE; RLS enforcement requires DB ownership |
| RLS-enforced visibility | Database (Postgres) | API (tRPC middleware sets GUCs) | RLS is the backstop; middleware sets `app.user_id`/`app.user_role` per-tx |
| RRULE expansion | API (tRPC + `src/lib/rrule.ts`) | — | Server-side per D-53 — no client expansion; FullCalendar receives concrete instances |
| Conflict detection | API (tRPC + SECURITY DEFINER fn) | Database (cross-scope query inside DEFINER) | DEFINER fn bypasses RLS for cross-scope detection; service layer applies role-gated redaction |
| Audit logging | API (tRPC `writeAudit`) | Database (`audit_log` table) | Inserts at API layer with full context; table is append-only via role-grant |
| Calendar rendering (week/day/month/year) | Browser (FullCalendar 6.x client) | Frontend Server (Server Component pre-fetches via tRPC, hydrates Client `<CalendarView>`) | FullCalendar requires browser APIs (`window`, `document`) — single `'use client'` boundary |
| Filter combobox (type-ahead) | API (tRPC `calendar.filterOptions.list`) | Browser (shadcn `<Command>` UI) | Scope-filter enforcement must be server-side (RBAC); UI is presentation only |
| Mobile swipe navigation | Browser (vanilla pointerevents on FullCalendar root) | — | Touch interaction is browser-tier; no library, no SSR |
| Event chip rendering | Browser (FullCalendar `eventContent` callback → Preact-renderable JSX) | — | Inside FullCalendar's internal render — cannot use React hooks |
| Locale loading (nl/en/fr) | Browser (dynamic import based on next-intl active locale) | Frontend Server (resolves locale from URL/user) | Locale file is large; only ship the active one |
| Audit JSONB snapshot pre-delete | API (service layer) | Database (transaction-locked SELECT FOR UPDATE) | Snapshot must happen inside the same tx as the DELETE for atomicity |

---

## Standard Stack

### Core (verified via npm registry 2026-05-14)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fullcalendar/core` | `^6.1.20` `[VERIFIED: npm registry]` | Calendar engine | MIT, Phase 3 reference per UI-SPEC + CAL-01..02 |
| `@fullcalendar/react` | `^6.1.20` `[VERIFIED: npm registry]` | React 19 connector | Official React adapter; consumes core peer-dep |
| `@fullcalendar/timegrid` | `^6.1.20` `[VERIFIED: npm registry]` | Week + Day views | Mandated by CAL-01 (week default) + CAL-08 (day-only mobile) |
| `@fullcalendar/daygrid` | `^6.1.20` `[VERIFIED: npm registry]` | Month view | Mandated by CAL-02 |
| `@fullcalendar/multimonth` | `^6.1.20` `[VERIFIED: npm registry]` | Year view | Mandated by CAL-02 |
| `@fullcalendar/interaction` | `^6.1.20` `[VERIFIED: npm registry]` | Drag/drop, resize, select | Outlook-UX precedent (UI3-D2, UI3-D3) |
| `@fullcalendar/rrule` | `^6.1.20` `[VERIFIED: npm registry]` | Client-side RRULE rendering support | **Only used for FullCalendar internal expansion if needed**; per D-53 we do all expansion server-side and feed flat instances, but installing the plugin keeps the option open without re-architecture cost |
| `rrule` | `^2.8.1` `[VERIFIED: npm registry]` | Server-side RRULE parse + expand | Per D-52; BSD-3-Clause; RFC 5545 compliant; `RRuleSet` for EXDATE; `.between()` for windowed expansion |

**Installation:**
```bash
npm install @fullcalendar/core @fullcalendar/react @fullcalendar/timegrid @fullcalendar/daygrid @fullcalendar/multimonth @fullcalendar/interaction @fullcalendar/rrule rrule
```

### Supporting (already in repo, reused)

| Library | Version (current in repo) | Purpose | Phase 3 use |
|---------|---------|---------|-------------|
| `react-hook-form` | `^7.75` | Form state | `EventCreateSheet`, `EventEditSheet` (per UI-SPEC) |
| `@hookform/resolvers` | `^5.2.2` | Zod resolver | `errors.calendar.*` i18n keys |
| `zod` | `^4.4.3` | Validation | `eventCreateInputSchema` per-type discriminated union |
| `date-fns` | `^4.1.0` | Locale-aware date formatting | `src/lib/i18n-format.ts` (already exists) |
| `next-intl` | `^4.11` | i18n | `useTranslations('calendar')` |
| `drizzle-orm` | `^0.45` | ORM | Polymorphic schema (separate `pgTable` per extension) |
| `lucide-react` | `latest` | Icons | Event-chip icons (Dumbbell, Trophy, Users, MapPin, MessagesSquare, Stethoscope) |

### shadcn primitives to add (per UI-SPEC §Components to add)

```bash
npx shadcn@latest add sheet alert command toggle toggle-group scroll-area
```

### Alternatives Considered (and why rejected)

| Instead of | Could Use | Tradeoff (why rejected) |
|------------|-----------|----------|
| FullCalendar 6.x | `react-big-calendar` | Effectively unmaintained, no rrule, poor i18n; FC has MIT for v1 plugins |
| FullCalendar 6.x | Bryntum / Mobiscroll | $3K+ license; over-engineered for our scale |
| `rrule` (jkbrzt) | `rrule-temporal` | Newer, depends on Temporal which is browser-only; node parity risk |
| `rrule` | `node-ical` | Heavier (parses full iCalendar); we only need RRULE parsing/expansion |
| `rrule-rust` | n/a (premature optimisation) | TS purity easier to debug; expand performance not a bottleneck per benchmark expectations |
| Class-table inheritance | Single-table + JSONB extensions | ROADMAP explicitly forbids single-table inheritance; type-safety + RLS scope harder on JSONB |
| Postgres `tstzrange` + GiST exclusion | Plain `(starts_at, ends_at)` columns + B-tree | We need overlap **queries** with role-gated redaction, not overlap **prevention** — and we never block, so exclusion constraint is wrong tool. B-tree on `(starts_at, ends_at)` + index on `(user_id, event_id)` is simpler and adequate per RISK-POLYMORPH budget |
| Soketi Realtime | (none in Phase 3) | Realtime deferred per UI-SPEC; calendar refreshes only on user navigation or mutation |

`[CITED: fullcalendar.io/pricing]` — MIT for the v1 plugin set (`core`, `react`, `timegrid`, `daygrid`, `interaction`, `rrule`, `multimonth`); premium plugins (resource timeline, scheduler) NOT used in v1.
`[VERIFIED: npm registry]` — `@fullcalendar/core` license = MIT; `rrule` license = BSD-3-Clause.

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Browser (Client)                                                             │
│                                                                              │
│   ┌──────────────────┐    URL: /calendar?view=week&date=...&filter=...     │
│   │ /calendar Page   │                                                       │
│   │ (Server Comp.)   │  ──► pre-fetch via tRPC calendar.list                 │
│   └────────┬─────────┘                                                       │
│            │ hydrate initial events + locale + view + date                   │
│            ▼                                                                 │
│   ┌──────────────────┐                                                       │
│   │ <CalendarView>   │  ◄── 'use client' — the ONLY client boundary         │
│   │ (FullCalendar)   │       owns headerToolbar={false}; uses CalendarToolbar│
│   │                  │       loads @fullcalendar/core/locales/{nl,en,fr}    │
│   │   eventContent ──┼──► <EventChip> JSX (Preact-renderable, no hooks)      │
│   │   eventClick   ──┼──► open <EventDetailSheet>                            │
│   │   select       ──┼──► open <EventCreateSheet> pre-filled                 │
│   │   eventDrop    ──┼──► optimistic move + tRPC update + conflict probe     │
│   │   eventResize  ──┼──► same as eventDrop                                  │
│   └────────┬─────────┘                                                       │
│            │                                                                 │
│   ┌────────▼──────────────┐  ┌─────────────────┐  ┌──────────────────┐     │
│   │ <CalendarToolbar>     │  │ <EventCreate    │  │ <EventDetail     │     │
│   │  Week/Day/Month/Year  │  │   Sheet>        │  │   Sheet>         │     │
│   │  ◄ Today ►            │  │   (form + RHF)  │  │   (read mode)    │     │
│   │  Filter trigger       │  │   ConflictWarn  │  │   Edit/Delete    │     │
│   │  "Nieuwe afspraak"    │  └────────┬────────┘  └────────┬─────────┘     │
│   └───────────────────────┘           │                    │                │
│            │                          │                    │                │
└────────────┼──────────────────────────┼────────────────────┼────────────────┘
             │ trpc.useQuery / .useMutation (all paths)
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ tRPC Server (Next.js Route Handler)                                          │
│                                                                              │
│   protectedProcedure chain:                                                  │
│     ─► requireAuth                                                           │
│     ─► withRlsContext (opens tx, sets app.user_id / app.user_role GUCs)      │
│     ─► requireCurrentConsent                                                 │
│     ─► [optional] requireRole(...) per D-48                                  │
│                                                                              │
│   calendar router:                                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ calendar.list({from, to, callerContext, filters})                   │   │
│   │   1. SELECT base events JOIN extensions JOIN participants           │   │
│   │      (RLS: calendar_events_visible_to enforced)                     │   │
│   │   2. For rrule != null → expandRrule(rrule, from, to, exceptions)   │   │
│   │   3. Apply exceptions (skip cancelled; override fields)             │   │
│   │   4. Flatten → EventInstance[] (one per occurrence)                 │   │
│   │   5. Annotate conflicting:boolean per occurrence (cheap pass)       │   │
│   │   6. Return                                                         │   │
│   │                                                                     │   │
│   │ calendar.event.create({type, fields..., participants, rrule})       │   │
│   │   1. Per-type Zod discriminated union validates input                │   │
│   │   2. UNTIL validation per D-55 (write-time gate)                    │   │
│   │   3. Detect conflicts FIRST (unless force:true)                     │   │
│   │   4. INSERT base + extension + participants in tx                   │   │
│   │   5. writeAudit('calendar_event_created')                           │   │
│   │   6. If force:true, additionally writeAudit('conflict_override')   │   │
│   │                                                                     │   │
│   │ calendar.event.update / delete / declineParticipation /             │   │
│   │   get / cancelOccurrence                                            │   │
│   │                                                                     │   │
│   │ calendar.event.detectConflicts({candidateEvent})  ← pre-save probe  │   │
│   │   ─► calls SECURITY DEFINER overlapping_events_for_users()          │   │
│   │   ─► service layer applies role-gated redaction                     │   │
│   │                                                                     │   │
│   │ calendar.filterOptions.list({kind, query})  ← type-ahead source     │   │
│   │   ─► RLS scope (players_visible_to + trainers_visible_to etc.)      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL (Supabase EU/Frankfurt)                                           │
│                                                                              │
│   Tables (Phase 3 additions):                                                │
│     event_type                          ◄── lookup, 6 codes                  │
│     calendar_events                     ◄── base, polymorphic, type_code FK  │
│     calendar_event_participants         ◄── junction (user_id, event_id)     │
│     calendar_event_exceptions           ◄── single-occurrence overrides      │
│     training_sessions                   ◄── extension 1:1 to calendar_events │
│     tournaments                         ◄── extension 1:1                    │
│     meetings                            ◄── extension 1:1                    │
│     stages                              ◄── extension 1:1 (+ junction for    │
│                                              players/trainers)                │
│     eval_conversations                  ◄── extension 1:1                    │
│     medical_appointments                ◄── extension 1:1 (non-Article-9!)   │
│                                                                              │
│   RLS-bound transaction (per tRPC request):                                  │
│     SET LOCAL app.user_id = ...                                              │
│     SET LOCAL app.user_role = ...                                            │
│     [query executes — RLS policies fire on every row]                        │
│                                                                              │
│   SECURITY DEFINER functions (bypass RLS deliberately):                      │
│     calendar_events_visible_to(uid, role) RETURNS SETOF uuid                 │
│       — the canonical visibility helper (Phase 1 players_visible_to pattern) │
│     overlapping_events_for_users(uids[], from, to) RETURNS SETOF row         │
│       — cross-scope overlap detection (D-57)                                 │
│                                                                              │
│   audit_log (Phase 1 carry-forward, append-only):                            │
│     INSERTed by service layer on create/update/delete/decline/override      │
│     JSONB snapshot for pre-delete row-family (D-58c)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Path | Tier | Responsibility |
|-----------|------|------|----------------|
| `CalendarPage` | `src/app/[locale]/(app)/calendar/page.tsx` | Server Comp. | URL→params parse; pre-fetch tRPC; hydrate `<CalendarView>` |
| `CalendarView` | `src/components/calendar/calendar-view.tsx` | Client | FullCalendar config + plugin wiring; **only `'use client'` boundary** |
| `CalendarToolbar` | `src/components/calendar/calendar-toolbar.tsx` | Client | View switcher, date nav, filter trigger, "Nieuwe afspraak"; URL state |
| `EventChip` | `src/components/calendar/event-chip.tsx` | Preact-renderable | `eventContent` callback; no hooks; reads `extendedProps` |
| `EventDetailSheet` | `src/components/calendar/event-detail-sheet.tsx` | Client | Read-mode display, role-gated Edit/Delete buttons |
| `EventCreateSheet` | `src/components/calendar/event-create-sheet.tsx` | Client | RHF form, conflict-detect on submit, per-type field set |
| `EventEditSheet` | `src/components/calendar/event-edit-sheet.tsx` | Client | Same shape as Create, pre-filled, RRULE scope "Deze afspraak" only |
| `EventFilterBar` | `src/components/calendar/event-filter-bar.tsx` | Client | Desktop inline; mobile bottom-Sheet; URL-synced |
| `FilterCombobox` | `src/components/calendar/filter-combobox.tsx` | Client | shadcn Command + Popover; tRPC type-ahead source |
| `ConflictWarning` | `src/components/calendar/conflict-warning.tsx` | Pure render | Inline Alert in form |
| `ConflictBanner` | `src/components/calendar/conflict-banner.tsx` | Client | Page-top banner for drag-drop conflicts |
| `CalendarSkeleton` | `src/components/calendar/calendar-skeleton.tsx` | Server Comp. | Suspense fallback |
| `EmptyHintStrip` | `src/components/calendar/empty-hint-strip.tsx` | Client | Below-grid hint |
| `<DateTimePicker>` | `src/components/common/date-time-picker.tsx` | Client | Popover + Calendar + 2× time Input — **reusable in Phase 4/5** |
| `<RruleEditor>` | `src/components/common/rrule-editor.tsx` | Client | Frequency/interval/end picker — **reusable in Phase 4/5** |
| `calendarRouter` | `src/server/trpc/routers/calendar.ts` | Server | All calendar tRPC procedures |
| `rruleHelper` | `src/lib/rrule.ts` | Server lib | `parseRrule`, `expandRrule(rrule, from, to, exceptions)`, `validateRruleHorizon` |
| `calendarCreate` middleware | `src/server/trpc/middleware/calendarCreate.ts` | Server | Per-event-type role gate (D-48 matrix) |

### Recommended Project Structure

```
src/
├── app/[locale]/(app)/
│   └── calendar/
│       ├── page.tsx                 # Server Component
│       ├── loading.tsx              # CalendarSkeleton wrapper
│       └── event/[id]/page.tsx      # deep-link to event (auto-opens EventDetailSheet)
├── components/
│   ├── calendar/
│   │   ├── calendar-view.tsx
│   │   ├── calendar-toolbar.tsx
│   │   ├── event-chip.tsx
│   │   ├── event-detail-sheet.tsx
│   │   ├── event-create-sheet.tsx
│   │   ├── event-edit-sheet.tsx
│   │   ├── event-filter-bar.tsx
│   │   ├── filter-combobox.tsx
│   │   ├── conflict-warning.tsx
│   │   ├── conflict-banner.tsx
│   │   ├── calendar-skeleton.tsx
│   │   └── empty-hint-strip.tsx
│   └── common/
│       ├── date-time-picker.tsx     # NEW — reused Phase 4/5
│       └── rrule-editor.tsx         # NEW — reused Phase 4/5
├── lib/
│   └── rrule.ts                     # parseRrule, expandRrule, validateHorizon
├── server/
│   ├── db/schema/
│   │   └── calendar.ts              # all calendar pgTable definitions + relations()
│   └── trpc/
│       ├── routers/
│       │   └── calendar.ts          # one file (planner may split per discretion)
│       ├── schemas/
│       │   └── calendar.ts          # discriminated union Zod schemas
│       └── middleware/
│           └── calendarCreate.ts    # per-event-type role gate matrix
└── (drizzle migrations)
    ├── 0009_phase3_calendar_base_lookup_participants_exceptions.sql
    ├── 0009_phase3_calendar_base_lookup_participants_exceptions.rollback.md
    ├── 0010_phase3_calendar_extension_tables.sql
    ├── 0010_phase3_calendar_extension_tables.rollback.md
    ├── 0011_phase3_calendar_rls_policies.sql
    ├── 0011_phase3_calendar_rls_policies.rollback.md
    └── 0012_phase3_event_type_seed.sql (+ rollback)

messages/
├── nl.json                          # +calendar.* +lookup.eventType.* +errors.calendar.*
├── en.json                          # same
└── fr.json                          # same
```

### Pattern 1: FullCalendar in Next.js 15 App Router (Client Component boundary)

**What:** FullCalendar requires browser APIs (`window`, `document`, `ResizeObserver`). Place the `'use client'` directive on `<CalendarView>` only — surrounding `CalendarPage` stays a Server Component that pre-fetches via tRPC.

**Why it works:** Per [FullCalendar React docs](https://fullcalendar.io/docs/react) the React connector uses Preact internally but accepts React JSX in render hooks. Per CONTEXT.md and [next-intl App Router docs](https://next-intl.dev/docs/getting-started/app-router), `useTranslations` works in both Server and Client Components as long as the request is wrapped.

```typescript
// src/components/calendar/calendar-view.tsx
'use client'

import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import multiMonthPlugin from '@fullcalendar/multimonth'
import { useRef, useEffect, useState } from 'react'
import type { CalendarApi, EventInput, LocaleInput } from '@fullcalendar/core'
import { useLocale } from 'next-intl'
import type { Locale } from '@/i18n/routing'

const localeLoaders: Record<Locale, () => Promise<LocaleInput>> = {
  nl: () => import('@fullcalendar/core/locales/nl').then(m => m.default),
  en: () => import('@fullcalendar/core/locales/en-gb').then(m => m.default),
  fr: () => import('@fullcalendar/core/locales/fr').then(m => m.default),
}

export function CalendarView({
  initialEvents,
  initialView,
  initialDate,
  onEventClick,
  onSelect,
  onEventDrop,
  onEventResize,
  canCreate,
  canEdit,
}: Props) {
  const ref = useRef<FullCalendar | null>(null)
  const activeLocale = useLocale() as Locale
  const [locale, setLocale] = useState<LocaleInput | null>(null)

  useEffect(() => {
    let cancelled = false
    localeLoaders[activeLocale]().then(l => { if (!cancelled) setLocale(l) })
    return () => { cancelled = true }
  }, [activeLocale])

  if (!locale) return null  // wait for locale; CalendarSkeleton above us covers initial paint

  return (
    <FullCalendar
      ref={ref}
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, multiMonthPlugin]}
      initialView={initialView}
      initialDate={initialDate}
      locale={locale}
      firstDay={1}  // Monday — I18N-07
      headerToolbar={false}  // app owns the toolbar
      events={initialEvents}  // tRPC pre-fetched at SSR; subsequent ranges fetched via React Query
      editable={canEdit}
      selectable={canCreate}
      eventClick={onEventClick}
      select={onSelect}
      eventDrop={onEventDrop}
      eventResize={onEventResize}
      eventContent={renderEventChip}
      dayMaxEvents={4}  // month view truncation
      // ...
    />
  )
}
```

Source: synthesis of [FullCalendar React docs](https://fullcalendar.io/docs/react), [FullCalendar locales](https://fullcalendar.io/docs/locale), and `[ASSUMED]` React-19 + Next-15 patterns.

### Pattern 2: Polymorphic class-table inheritance in Drizzle

**What:** Base table + N extension tables, each with `event_id PK FK CASCADE`. JOIN on `type_code` discriminator. Same pattern documented by [Wanago — Polymorphic Associations with PostgreSQL + Drizzle](http://wanago.io/2024/10/14/api-nestjs-drizzle-polymorphic-associations-postgresql/).

**When to use:** Type-safe per-type domain fields; ACID guarantees on cross-table integrity; RLS policies attach to each table separately so different types can have different visibility rules in future phases.

**Example:**

```typescript
// src/server/db/schema/calendar.ts
import { pgTable, uuid, text, boolean, integer, date, primaryKey, index } from 'drizzle-orm/pg-core'
import { tstz } from '../helpers/timestamps'
import { users } from './auth'
import { eventType, trainingType, organisation, tournamentType, ageCategories } from './lookups'
import { trainers, players } from './players'  // (and trainers.ts)
import { relations } from 'drizzle-orm'

// ── Lookup added in Phase 3 ──
export const eventType = pgTable('event_type', {
  code: text('code').primaryKey(),  // 'event_type_training' | 'event_type_tournament' | ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
})

// ── Base ──
export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  typeCode: text('type_code').notNull().references(() => eventType.code, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
  allDay: boolean('all_day').notNull().default(false),
  location: text('location'),
  description: text('description'),
  rrule: text('rrule'),  // RFC-5545 string; null = single event
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
}, (t) => ({
  idxStartsEnds: index('idx_calendar_events_starts_ends').on(t.startsAt, t.endsAt),
  idxType: index('idx_calendar_events_type').on(t.typeCode),
  idxCreator: index('idx_calendar_events_creator').on(t.createdBy),
  // No partial index on rrule IS NOT NULL — recurring events are a minority but
  // querying for them is rare enough that the full table scan is fine.
}))

// ── Junction (polymorphic over user_id) ──
export const calendarEventParticipants = pgTable('calendar_event_participants', {
  eventId: uuid('event_id').notNull().references(() => calendarEvents.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleInEvent: text('role_in_event').notNull(),  // CHECK organizer/participant/invitee
  rsvpStatus: text('rsvp_status').notNull().default('pending'),  // CHECK pending/accepted/declined
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.eventId, t.userId] }),
  idxUser: index('idx_cep_user_event').on(t.userId, t.eventId),  // scope queries hit this first
}))

// ── Exceptions ──
export const calendarEventExceptions = pgTable('calendar_event_exceptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => calendarEvents.id, { onDelete: 'cascade' }),
  occurrenceDate: date('occurrence_date').notNull(),
  cancelled: boolean('cancelled').notNull().default(false),
  overrideStartsAt: tstz('override_starts_at'),
  overrideEndsAt: tstz('override_ends_at'),
  overrideTitle: text('override_title'),
  overrideLocation: text('override_location'),
  overrideDescription: text('override_description'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
}, (t) => ({
  uniq: unique('uniq_cee_event_occurrence').on(t.eventId, t.occurrenceDate),
  idxEvent: index('idx_cee_event').on(t.eventId),
}))

// ── Extension tables (one per event type — example: training_sessions) ──
export const trainingSessions = pgTable('training_sessions', {
  eventId: uuid('event_id').primaryKey().references(() => calendarEvents.id, { onDelete: 'cascade' }),
  durationMinutes: integer('duration_minutes').notNull(),  // redundant with ends_at but required by TRAIN-01
  trainingTypeCode: text('training_type_code').notNull().references(() => trainingType.code),
  organisationCode: text('organisation_code').notNull().references(() => organisation.code),
  trainerId: uuid('trainer_id').notNull().references(() => trainers.userId, { onDelete: 'restrict' }),
})

// ── Relations (for type-safe joins) ──
export const calendarEventsRelations = relations(calendarEvents, ({ one, many }) => ({
  training: one(trainingSessions, { fields: [calendarEvents.id], references: [trainingSessions.eventId] }),
  tournament: one(tournaments, { fields: [calendarEvents.id], references: [tournaments.eventId] }),
  meeting: one(meetings, { fields: [calendarEvents.id], references: [meetings.eventId] }),
  stage: one(stages, { fields: [calendarEvents.id], references: [stages.eventId] }),
  evalConv: one(evalConversations, { fields: [calendarEvents.id], references: [evalConversations.eventId] }),
  medical: one(medicalAppointments, { fields: [calendarEvents.id], references: [medicalAppointments.eventId] }),
  participants: many(calendarEventParticipants),
  exceptions: many(calendarEventExceptions),
}))
```

Source: synthesis of Phase 1+2 existing pgTable patterns + [Drizzle Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints) `[CITED]` + [Wanago polymorphic associations](http://wanago.io/2024/10/14/api-nestjs-drizzle-polymorphic-associations-postgresql/) `[CITED]`.

### Pattern 3: RRULE expansion server-side

**What:** Parse `rrule` string → `RRule` instance with explicit `dtstart` from `calendar_events.starts_at` → `.between(from, to, true)` returns Date[] within window → wrap each Date into `EventInstance` by adjusting `starts_at`/`ends_at` to that occurrence → apply exceptions.

**Why explicit dtstart:** Per [rrule README](https://github.com/jkbrzt/rrule), `rrulestr()` returns a parsed rule but if your RRULE string omits `DTSTART:` (we store `starts_at` separately on `calendar_events`), the rule has no anchor. You must pass `{ dtstart: new Date(events.starts_at) }`.

**Example:**

```typescript
// src/lib/rrule.ts
import { RRule, RRuleSet, rrulestr } from 'rrule'
import { addDays, addYears } from 'date-fns'

const MAX_HORIZON_YEARS = 2  // D-55

export function parseRrule(rruleStr: string, dtstart: Date): RRule {
  // rrulestr() parses "RRULE:FREQ=WEEKLY;UNTIL=...;BYDAY=MO,FR"
  // We pass dtstart explicitly because we store starts_at separately on calendar_events.
  return rrulestr(rruleStr, { dtstart }) as RRule
}

export function validateRruleHorizon(rruleStr: string, dtstart: Date, createdAt: Date = new Date()): void {
  const rule = parseRrule(rruleStr, dtstart)
  const opts = rule.origOptions
  const maxAllowed = addYears(createdAt, MAX_HORIZON_YEARS)
  if (opts.until && opts.until > maxAllowed) {
    throw new Error('errors.calendar.rruleHorizonExceeded')
  }
  if (!opts.until && !opts.count) {
    throw new Error('errors.calendar.rruleHorizonExceeded')  // UNTIL or COUNT required; auto-inject in UI
  }
}

export interface ExpandedOccurrence {
  occurrenceDate: Date        // the calendar date of this occurrence (in UTC)
  startsAt: Date              // resolved with override applied
  endsAt: Date                // resolved with override applied
  override?: ExceptionRow     // present if this occurrence has an exception
}

export function expandRrule(
  rruleStr: string,
  dtstart: Date,
  baseDurationMs: number,
  from: Date,
  to: Date,
  exceptions: ExceptionRow[],
): ExpandedOccurrence[] {
  // Read-time clamp per D-55: never expand past dtstart + 2y
  const clampedTo = new Date(Math.min(to.getTime(), addYears(dtstart, MAX_HORIZON_YEARS).getTime()))
  const rule = parseRrule(rruleStr, dtstart)

  // For exception support we need RRuleSet so we can call .exdate() on cancelled occurrences.
  // But we ALSO need override-fields (move, retitle) which RRuleSet doesn't model — apply those
  // in a post-processing pass below.
  const set = new RRuleSet()
  set.rrule(rule)
  for (const ex of exceptions) {
    if (ex.cancelled) {
      set.exdate(occurrenceDateToInstant(ex.occurrenceDate, dtstart))  // see helper below
    }
  }

  const dates = set.between(from, clampedTo, true)  // inc=true: include exact boundaries

  return dates.map(d => {
    const ex = exceptions.find(e => sameDate(e.occurrenceDate, d) && !e.cancelled)
    return {
      occurrenceDate: d,
      startsAt: ex?.overrideStartsAt ?? d,
      endsAt: ex?.overrideEndsAt ?? new Date(d.getTime() + baseDurationMs),
      override: ex,
    }
  })
}
```

**Performance:** For our scale (week range ≤ 200 events, maybe 30 RRULE-events, each expanding to ~5 occurrences per week) the `rrule` package's expansion cost is < 5 ms total per request — well within the 200 ms RISK-POLYMORPH budget.

**Caveats:**
- DTSTART convention: `calendar_events.starts_at` IS the DTSTART; do NOT also store it in the rrule string. The Zod validator should reject rrules that contain `DTSTART:` to prevent dual-source-of-truth bugs.
- Timezone: input is UTC TIMESTAMPTZ; `rrule` package treats Date objects in UTC by default per [rrule docs](https://github.com/jkbrzt/rrule). Display-time conversion to user's browser-local TZ happens in `<EventChip>` via `formatTime()`.
- `between(from, to, inc)`: `inc=true` includes occurrences exactly at `from` or `to`; we want this so a Monday recurring event isn't dropped if `from` is exactly that Monday's midnight.

Source: [rrule npm package](https://www.npmjs.com/package/rrule) `[CITED]`, [iCalendar RFC 5545 §3.8.5.1 EXDATE](https://icalendar.org/iCalendar-RFC-5545/3-8-5-1-exception-date-times.html) `[CITED]`, [Nylas "Deceptively Complex World of Calendar Events and RRULEs"](https://www.nylas.com/blog/calendar-events-rrules/) `[CITED]`.

### Pattern 4: SECURITY DEFINER for cross-scope conflict detection

**What:** A SECURITY DEFINER function bypasses RLS so the conflict-detection query can find overlapping events for any participant — even when the caller doesn't have visibility on the conflicting event. The service layer then **role-gates the redaction** of the response.

**Why SECURITY DEFINER:** Per [PostgreSQL RLS docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), a SECURITY DEFINER function runs with the privileges of the function owner (the schema owner), bypassing RLS unless the function explicitly enables it via `SET ROW SECURITY ON`. This is the **same pattern Phase 1 used** for `players_visible_to()` and `query_medical_access_audit()`. The risk is well-understood: keep the function narrow, validate inputs, never SELECT * from the result table — only the columns the caller needs.

**Example:**

```sql
-- drizzle/0011_phase3_calendar_rls_policies.sql

-- 1. Canonical visibility helper (SECURITY DEFINER; Phase 1 pattern).
CREATE OR REPLACE FUNCTION calendar_events_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(event_id UUID) AS $$
  -- TD / medical_staff sees all
  SELECT id FROM calendar_events
   WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Creator sees own
  SELECT id FROM calendar_events
   WHERE created_by = caller_id

  UNION

  -- Participant sees events they're in
  SELECT cep.event_id FROM calendar_event_participants cep
   WHERE cep.user_id = caller_id

  UNION

  -- Academy manager / trainer sees events of academy players
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN academy_memberships am_player ON am_player.user_id = cep.user_id AND am_player.role = 'player'
    JOIN academy_memberships am_caller ON am_caller.academy_code = am_player.academy_code
                                       AND am_caller.user_id = caller_id
                                       AND am_caller.role IN ('trainer', 'academy_manager')
   WHERE caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Parent sees events of their linked child(ren)
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN parent_child_links pcl ON pcl.child_user_id = cep.user_id AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent'

  UNION

  -- Sparring partner — Phase 3 placeholder (Phase 4 fills via session_sparring_partners)
  SELECT NULL::UUID WHERE FALSE;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION calendar_events_visible_to(UUID, TEXT) TO app_user;
REVOKE EXECUTE ON FUNCTION calendar_events_visible_to(UUID, TEXT) FROM PUBLIC;

-- 2. RLS policy on calendar_events using the helper.
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ce_visible ON calendar_events FOR SELECT
  USING (id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));

CREATE POLICY ce_insert ON calendar_events FOR INSERT
  WITH CHECK (created_by = current_user_id());  -- creator-as-caller; per-type role gate at tRPC layer (D-48)

CREATE POLICY ce_update ON calendar_events FOR UPDATE
  USING (
    created_by = current_user_id()
    OR current_user_role() = 'technical_director'
  )
  WITH CHECK (
    created_by = current_user_id()
    OR current_user_role() = 'technical_director'
  );

CREATE POLICY ce_delete ON calendar_events FOR DELETE
  USING (
    created_by = current_user_id()
    OR current_user_role() = 'technical_director'
  );

-- 3. Cross-scope overlap detection (SECURITY DEFINER bypass — D-57).
CREATE OR REPLACE FUNCTION overlapping_events_for_users(
  p_user_ids UUID[],
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE(
  event_id UUID,
  user_id UUID,
  type_code TEXT,
  title TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  location TEXT,
  created_by UUID
) AS $$
  -- DELIBERATELY bypasses RLS. Caller must apply role-gated redaction
  -- in the service layer. We never return the description or any extension-
  -- table column from this function — only enough to surface
  -- "{participant} is double-booked for {redacted/full detail} {start}–{end}".
  -- The service-layer code decides whether to show {full title + location}
  -- or {redacted type-label only} based on the calling role's visibility
  -- per D-57.
  SELECT ce.id AS event_id,
         cep.user_id,
         ce.type_code,
         ce.title,
         ce.starts_at,
         ce.ends_at,
         ce.location,
         ce.created_by
    FROM calendar_events ce
    JOIN calendar_event_participants cep ON cep.event_id = ce.id
   WHERE cep.user_id = ANY(p_user_ids)
     AND tstzrange(ce.starts_at, ce.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
   -- Note: recurring events with rrule != null are NOT auto-expanded here.
   -- The service layer calls expandRrule() on rrule rows separately (within
   -- a ±15 day window per D-56) and merges the result before applying redaction.
   ORDER BY ce.starts_at;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;
REVOKE EXECUTE ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
```

Source: synthesis of [Phase 1's `0002_rls_functions_and_policies.sql`](file referenced), [PostgreSQL RLS official docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) `[CITED]`, [Bytebase "Postgres RLS Footguns"](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) `[CITED]` (re: SECURITY DEFINER caution).

### Pattern 5: Discriminated-union tRPC input for polymorphic create

**What:** Zod's `z.discriminatedUnion('type', [...])` enables one mutation to accept different field sets per event type while maintaining full TS type safety and runtime validation.

**Example:**

```typescript
// src/server/trpc/schemas/calendar.ts
import { z } from 'zod'

const baseEventFields = {
  title: z.string().min(1, { message: 'errors.calendar.titleRequired' }),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  rrule: z.string().optional(),
  participants: z.array(z.object({
    userId: z.string().uuid(),
    roleInEvent: z.enum(['organizer', 'participant', 'invitee']),
  })).default([]),
  force: z.boolean().default(false),  // override conflict warning (D-57)
}

const trainingCreateInput = z.object({
  type: z.literal('event_type_training'),
  ...baseEventFields,
  trainerId: z.string().uuid(),
  trainingTypeCode: z.string(),
  organisationCode: z.string(),
  durationMinutes: z.number().int().positive(),
}).strict()
  .refine(d => d.endsAt > d.startsAt, { message: 'errors.calendar.endBeforeStart', path: ['endsAt'] })

const tournamentCreateInput = z.object({
  type: z.literal('event_type_tournament'),
  ...baseEventFields,
  city: z.string().min(1),
  country: z.string().length(2),
  ageCategoryCode: z.string(),
  tournamentTypeCode: z.string(),
}).strict()
  .refine(d => d.endsAt > d.startsAt, { message: 'errors.calendar.endBeforeStart' })

// ... 4 more: meeting, stage, evalConv, medical

export const eventCreateInput = z.discriminatedUnion('type', [
  trainingCreateInput,
  tournamentCreateInput,
  meetingCreateInput,
  stageCreateInput,
  evalConvCreateInput,
  medicalCreateInput,
])
```

The router then narrows by `input.type` and dispatches to a per-type insert helper that writes to the correct extension table.

Source: synthesis of Phase 1+2 Zod patterns and [Zod discriminated union docs](https://zod.dev/?id=discriminated-unions) `[ASSUMED]` (training-knowledge — verified during impl).

### Anti-Patterns to Avoid

- **Storing DTSTART in both `calendar_events.starts_at` AND in the rrule string.** Two sources of truth; create-time edits to one drift from the other. **Solution:** Zod rejects rrule strings containing `DTSTART:`; helper always re-injects from `starts_at`.
- **Using FullCalendar `eventSources` to fetch via callback inside the React component.** This works but defeats the SSR pre-fetch and adds a network round-trip per view-change. **Solution:** Pass initial events as `events` prop from the Server Component; refetch via React Query on range-navigation (FullCalendar's `datesSet` callback triggers it).
- **Materializing RRULE occurrences into a separate `calendar_event_instances` table.** Defeats single-source-of-truth; create-time amplification is huge for daily events × 2y horizon. **Solution:** Expand at query time per D-53.
- **Using `useState` inside `eventContent` callback.** [FullCalendar docs explicitly warn](https://fullcalendar.io/docs/content-injection): the returned JSX is rendered by Preact, not React's render tree. Hooks won't work. **Solution:** Pass all derived display state via `event.extendedProps`; `eventContent` is a pure function of args.
- **Soft-delete column with `deleted_at`.** Per D-58, hard delete is the chosen pattern. **Don't add `deleted_at` to calendar_events.** Forensic recovery is via audit-log JSONB snapshot.
- **Using `@fullcalendar/rrule` for client-side expansion in v1.** The plugin is installed (we include it in package.json to keep the option open) but is **not** wired — server expansion is the canonical path per D-53.
- **Single-table inheritance via `event_payload jsonb` on calendar_events.** ROADMAP explicitly forbids this. JSON-schema validation is weaker than typed-column NOT NULL constraints; RLS scope rules would have to read into JSON.
- **Hand-rolling swipe-detection with a third-party library on mobile.** UI-SPEC mandates vanilla `pointerdown`/`pointermove`/`pointerup`. Adding `react-swipeable` or `hammer.js` for one component is over-investment.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar grid (week/day/month/year) | Custom CSS grid + event collision logic | FullCalendar 6.x | We'd reinvent overlap-stacking, drag-resize math, locale-aware weekday rendering, accessibility, mobile gestures. FC has done all of this for 12 years |
| RRULE parsing/expansion | Cron-string parser, hand-rolled DSL | `rrule` 2.8.1 | RFC 5545 has edge cases (BYDAY, BYSETPOS, INTERVAL, DST) we will not get right; the npm package is the canonical implementation |
| RBAC visibility helper | Inline OR-clauses in every query | Single SECURITY DEFINER function `calendar_events_visible_to()` | DRY: rules change once in one place; auditable for legal review; planner-hoistable for performance |
| Locale loading for FullCalendar weekday/month names | Build a custom message dict for FC strings | `@fullcalendar/core/locales/{nl,en-gb,fr}` | FC ships the right strings; we just import dynamically per active locale |
| Type-ahead combobox with scope filter | Custom Select + filter logic | shadcn `<Command>` + tRPC `filterOptions.list` | shadcn's command is built on `cmdk`; pairs with tRPC server-side scope enforcement |
| Pre-delete row-family JSONB snapshot | Manual JSON.stringify with column allow-list | Drizzle-typed `SELECT` then `JSON.stringify` of typed result | TS keeps the snapshot type-safe and the audit_log query can re-typecheck |
| Conflict detection overlap math | `((a.startsAt < b.endsAt) AND (a.endsAt > b.startsAt))` ad-hoc | `tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)` | Cleaner SQL, named operator, future-proof if we add multirange |
| Form state | Manual useState fan-out | `react-hook-form` + Zod resolver (already in repo) | Already shipped Phase 2; same pattern |
| Date formatting per locale | `Intl.DateTimeFormat` everywhere | `src/lib/i18n-format.ts` (Phase 1) `formatDate` / `formatTime` | One place to change Monday-first / dd/MM/yyyy convention |
| i18n key translation | Inline copy or React Context | `useTranslations('calendar')` from next-intl | App-wide convention since Phase 1 |
| Drag/resize gestures on calendar grid | Custom pointer-event math | `@fullcalendar/interaction` | Built into FullCalendar, handles touch + mouse uniformly |

**Key insight:** Phase 3 is a glue phase. The hard work is in the **stack chosen for us by Phase 1/2 and UI-SPEC**; the implementation creativity goes into how to wire it correctly, not into building libraries.

---

## Common Pitfalls

### Pitfall 1: FullCalendar SSR hydration mismatch

**What goes wrong:** FullCalendar renders the current date inside the component on mount. If the server pre-renders with a different "now" than the browser (timezone offset, ms difference), React throws a hydration mismatch.

**Why it happens:** FC reads `new Date()` internally; the calendar's first paint uses that.

**How to avoid:** (a) Make `<CalendarView>` a Client Component (already mandated — `'use client'`); (b) wrap in Suspense with a `<CalendarSkeleton>` fallback that matches FC's grid dimensions to prevent CLS; (c) `next/dynamic` import with `ssr: false` is a fallback but adds a flash — prefer the Suspense path.

**Warning signs:** Console hydration warnings on first paint; `Text content does not match server-rendered HTML`.

### Pitfall 2: Locale file not loaded before FullCalendar mount

**What goes wrong:** The dynamic locale `import()` resolves asynchronously. If FC mounts with `locale={null}` it falls back to English; switching locales without a re-mount can leave stale weekday strings.

**Why it happens:** Race between `useEffect(() => load(locale).then(setLocale))` and FC's internal initialisation.

**How to avoid:** Block render until the locale resolves (`if (!locale) return <CalendarSkeleton />`). Bypass by importing all 3 locales statically — but that bloats the bundle.

**Warning signs:** Brief flash of English month names before the localised version appears.

### Pitfall 3: RRULE expansion timezone drift

**What goes wrong:** A weekly event created at "10:00 Tuesday Brussels time" expands to instances that drift by 1 hour around DST transitions.

**Why it happens:** `rrule` package handles UTC by default; if you pass a timezone-naive Date the library assumes UTC, but JS Date arithmetic with `addDays` respects local TZ.

**How to avoid:** Always treat `calendar_events.starts_at` as UTC (it's TIMESTAMPTZ — enforced by `tstz` helper). Pass `Date` objects to rrule that were created via `new Date(isoString)` from Postgres directly. Render in browser-local TZ only in `<EventChip>`. **Do not** do timezone math on the server.

**Warning signs:** "Why is the Tuesday 10 am training showing at 9 am after Oct 25?" (DST end).

`[CITED: github.com/jkbrzt/rrule/issues/501]` — known rrule + DST edge case is the topic of one of the most-watched GH issues; current 2.8.1 handles UTC correctly when DTSTART is UTC.

### Pitfall 4: RLS bypass via `eventSources` callback that doesn't run inside the tx

**What goes wrong:** FullCalendar's `eventSources: [{ events: async (info, success) => { ... } }]` runs the callback when the calendar fetches a new range. If you call tRPC inside that callback, you're a new request — but if the callback reads a tx-bound resource directly (a leaked `ctx.db` handle in dev), RLS is not set on that connection and you may get either zero rows or all rows depending on the GUC state.

**Why it happens:** Phase 1's `withRlsContext` middleware opens a Postgres tx and sets `app.user_id` GUCs on that connection — they're scoped to the tx via `is_local=true`. Outside a tx (e.g. raw pool query) the GUCs are absent.

**How to avoid:** Calendar queries MUST go through tRPC (which composes `protectedProcedure` → `withRlsContext`). Never call `db.select()` from a Client Component callback directly.

**Warning signs:** A trainer seeing events of players in a different academy (RLS-bypass smell).

### Pitfall 5: Drizzle composite-PK + FK CASCADE generation order

**What goes wrong:** drizzle-kit can generate the migration in an order that creates the FK before the table it references, or names the constraint differently from what you expect.

**Why it happens:** Phase 2's migration 0006 already worked around this — see the file header comment "the agent worktree historically lacked `drizzle-kit generate`". The repo's convention is **hand-authored migrations**, with `drizzle-kit generate` run **only to confirm column shapes**, not to commit raw output.

**How to avoid:** Continue the hand-authoring pattern (governance rule MIG-01 — never edit a migration once applied). Order tables in DDL: lookups first → base → junctions → extensions → RLS policies (separate migration).

**Warning signs:** `relation "foo" does not exist` during fresh-DB apply.

### Pitfall 6: Conflict-detection result leaks the existence of out-of-scope events

**What goes wrong:** Even with redacted detail ("{participant} is booked for **a Medical appointment** 11:00–12:00"), the mere fact that a conflict exists tells caller B about caller A's medical event.

**Why it's still OK:** Per D-57, this is an **intentional trade-off**: operational scheduling correctness wins over existence-privacy. The reasoning: if you're scheduling a conflicting event for player A, you already know player A's calendar exists. You're not enumerating other players' calendars — you only ever see conflicts for participants you yourself added to your event.

**How to avoid leaking further:** Never include the conflicting event's `description`, location, or `extendedProps` in the conflict response when redacted. Only return: participant name, redacted type-label, time range.

**Warning signs:** Privacy review flags this as a leak. Document the trade-off in the PLAN's GDPR section so the auditor isn't surprised.

### Pitfall 7: Mobile swipe interferes with FullCalendar's internal scroll

**What goes wrong:** A vertical swipe on the calendar body is interpreted as "scroll the time axis", but a horizontal swipe is captured by our custom swipe handler. The boundary between "this is vertical scroll" and "this is horizontal swipe" can flicker.

**Why it happens:** `pointermove` events fire in both axes; our threshold (60px horizontal, 200ms) needs to be tested.

**How to avoid:** Attach the swipe handler to the calendar **container** div (above FullCalendar), not the calendar root. Detect horizontal direction first (>20px x-delta with <10px y-delta) before claiming the pointer. Use `pointercancel` to release on edge cases.

**Warning signs:** "I tried to scroll down to see 18:00 but it switched to tomorrow."

### Pitfall 8: RRULE editor produces invalid RFC-5545 strings

**What goes wrong:** Concatenating UI selections naively (FREQ=WEEKLY;INTERVAL=2;UNTIL=2027-05-14) misses the required `T...Z` format on UNTIL and produces an invalid rrule that `rrulestr()` rejects.

**Why it happens:** RFC 5545 dates in UNTIL must be full DATE-TIME in UTC: `UNTIL=20270514T000000Z` (no dashes/colons).

**How to avoid:** Build the rrule string via `RRule.optionsToString(options)` — never string-concat. Validate every constructed string via `rrulestr(str, { dtstart })` before storing.

**Warning signs:** Phase 4 tests fail with "no rule" errors on rrule strings authored by Phase 3 UI.

### Pitfall 9: Audit-log JSONB snapshot blows up for large recurring events

**What goes wrong:** A weekly event for 2 years with 30 participants pre-DELETE snapshots ~310 occurrence × 30 participant × … rows into a single JSONB.

**Why it happens:** The snapshot captures base + extension + participants + exceptions. Exceptions can be thousands of rows for a long-running training series.

**How to avoid:** Cap the snapshot's exception array (e.g., first 1000) and include a count of skipped rows. For forensic recovery the audit-log is "good enough" guidance — not byte-for-byte restore. Document this in the rollback runbook.

**Warning signs:** Slow DELETE; bloated audit_log table.

### Pitfall 10: `headerToolbar={false}` removes some keyboard nav

**What goes wrong:** FullCalendar's built-in prev/next buttons are keyboard-navigable. Replacing them with our custom `CalendarToolbar` requires we wire keyboard shortcuts (UI-SPEC declares them — `←`/`→`/`t`/`w`/`d`/`m`/`y`/`n`/`Esc`) and accessible aria-labels ourselves.

**How to avoid:** Set `aria-label` on every icon-only button in `CalendarToolbar`. Use `<button>` not `<div>`. Test with a screen reader (Phase 8 polish but baseline AA in Phase 3).

---

## Code Examples

### Example 1: `calendar.list` server-side handler with RRULE expansion

```typescript
// src/server/trpc/routers/calendar.ts (excerpt)
import { protectedProcedure } from '../middleware/freshSession'
import { writeAudit } from '../middleware/audit'
import { expandRrule } from '@/lib/rrule'
import { calendarEvents, calendarEventParticipants, calendarEventExceptions } from '@/server/db/schema/calendar'
import { eq, and, gte, lte, isNull, isNotNull, or, sql } from 'drizzle-orm'
import { listInputSchema } from '../schemas/calendar'

export const calendarRouter = router({
  list: protectedProcedure
    .input(listInputSchema)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const db = ctx.db as DbClient
      const { from, to, filters } = input

      // Read-time horizon clamp (D-55 defense in depth):
      const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000 * 2  // 2 years
      if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.calendar.rangeTooLarge' })
      }

      // 1. Fetch base events overlapping window OR with rrule (we expand rrule rows separately).
      //    RLS already scopes via calendar_events_visible_to() — we trust RLS here.
      const baseRows = await db
        .select()
        .from(calendarEvents)
        .leftJoin(/* extensions joined here in a per-type pass — or fetched lazily; see note below */)
        .where(
          or(
            and(
              lte(calendarEvents.startsAt, to),
              gte(calendarEvents.endsAt, from),
              isNull(calendarEvents.rrule),
            ),
            // Recurring events whose first occurrence is before `to`: we'll expand
            and(
              isNotNull(calendarEvents.rrule),
              lte(calendarEvents.startsAt, to),
            ),
          ),
        )

      // 2. Expand recurring rows.
      const exceptions = await db.select().from(calendarEventExceptions)
        .where(/* event_id IN baseRows.recurring.map(e => e.id) */)

      const instances: EventInstance[] = []
      for (const row of baseRows) {
        if (row.rrule) {
          const exForThis = exceptions.filter(e => e.eventId === row.id)
          const occurrences = expandRrule(
            row.rrule,
            row.startsAt,
            row.endsAt.getTime() - row.startsAt.getTime(),
            from,
            to,
            exForThis,
          )
          for (const occ of occurrences) {
            instances.push(toInstance(row, occ))
          }
        } else {
          instances.push(toInstance(row, { startsAt: row.startsAt, endsAt: row.endsAt }))
        }
      }

      // 3. Annotate conflicts (cheap pass — sort by user, scan adjacent).
      const annotated = annotateConflicts(instances)

      return annotated
    }),

  // ... event.create, event.update, event.delete, event.declineParticipation, event.detectConflicts, filterOptions.list
})
```

### Example 2: Pre-delete JSONB snapshot (D-58c)

```typescript
// src/server/trpc/routers/calendar.ts — event.delete
delete: protectedProcedure
  .input(z.object({ eventId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' })
    const db = ctx.db as DbClient  // RLS-bound tx

    // 1. SELECT base + extension + participants + exceptions FOR UPDATE
    const base = await db.select().from(calendarEvents)
      .where(eq(calendarEvents.id, input.eventId))
      .for('update')
    if (base.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'errors.notFound' })
    }
    const baseRow = base[0]

    // Per-type extension fetch — discriminated on typeCode
    const extensionRow = await fetchExtensionRow(db, baseRow.typeCode, baseRow.id)

    const participantsRows = await db.select().from(calendarEventParticipants)
      .where(eq(calendarEventParticipants.eventId, baseRow.id)).for('update')

    const exceptionsRows = await db.select().from(calendarEventExceptions)
      .where(eq(calendarEventExceptions.eventId, baseRow.id)).for('update')

    // 2. Snapshot all into audit_log.meta (capped exceptions per Pitfall 9)
    const snapshot = {
      base: baseRow,
      extension: extensionRow,
      participants: participantsRows,
      exceptions: exceptionsRows.slice(0, 1000),
      exceptionsTotalCount: exceptionsRows.length,
    }
    await writeAudit(ctx, {
      action: 'calendar_event_deleted',
      resourceType: 'calendar_event',
      resourceId: baseRow.id,
      oldValues: snapshot,
    })

    // 3. DELETE — FK CASCADE drops extension + participants + exceptions
    await db.delete(calendarEvents).where(eq(calendarEvents.id, baseRow.id))

    // 4. (commit happens at tx boundary)
    return { ok: true }
  }),
```

### Example 3: Conflict detection with role-gated redaction

```typescript
// src/server/trpc/routers/calendar.ts — event.detectConflicts
detectConflicts: protectedProcedure
  .input(detectConflictsInputSchema)
  .query(async ({ ctx, input }) => {
    if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' })
    const db = ctx.db as DbClient
    const userIds = input.participants.map(p => p.userId)

    // 1. Cross-scope overlap via SECURITY DEFINER (bypasses RLS — D-57).
    const overlaps = await db.execute(sql`
      SELECT event_id, user_id, type_code, title, starts_at, ends_at, location, created_by
        FROM overlapping_events_for_users(${userIds}::uuid[], ${input.startsAt}, ${input.endsAt})
    `)

    // 2. For each overlap, decide redaction based on caller's visibility:
    //    full = is_td(caller) OR caller IN participants(conflicting) OR caller = created_by(conflicting)
    const callerRole = ctx.scope.role
    const callerId = ctx.scope.userId

    const redacted = await Promise.all(overlaps.rows.map(async r => {
      const fullVisibility =
        callerRole === 'technical_director' ||
        callerRole === 'medical_staff' ||
        r.created_by === callerId ||
        (await isParticipant(db, r.event_id, callerId))

      // Participant name lookup (always allowed — we know we added them to OUR event)
      const participantName = await getParticipantDisplayName(db, r.user_id)

      return {
        eventId: fullVisibility ? r.event_id : null,
        participant: participantName,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        // 'full' = '**{title}** ({typeLabel})'; 'redacted' = 'een **{typeLabel}**'
        detailMode: fullVisibility ? 'full' as const : 'redacted' as const,
        typeCode: r.type_code,
        title: fullVisibility ? r.title : null,
        location: fullVisibility ? r.location : null,
      }
    }))

    return {
      conflicts: redacted,
      blocked: false,  // D-57: never block
    }
  }),
```

Source: synthesis of Phase 1 audit middleware + Phase 1 SECURITY DEFINER pattern (`players_visible_to`) + UI-SPEC Conflict Detection contract.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FullCalendar v3 jQuery plugin | FullCalendar 6.x ES modules + React connector | v4 release (2019), v6 (2022) | We can use it standalone, MIT for free plugins, no jQuery dep |
| `react-big-calendar` | FullCalendar 6 | RBC effectively unmaintained 2023+ | RBC missing rrule, poor i18n, no drag-resize OOB |
| `moment.js` | `date-fns` 4.x (already in repo) | 2020 deprecation of moment | `date-fns` is tree-shakeable, locale-aware, immutable Dates |
| `iCal.js` for RRULE | `rrule` 2.8.1 | jkbrzt/rrule 1.x ~2016, 2.x ~2018 | Focused library, smaller bundle, better TypeScript types |
| Hand-rolled RBAC with `if (user.role === ...)` | RLS-enforced visibility via SECURITY DEFINER | Phase 1 baseline | Defense in depth; even SQL-injection bypassing the app layer hits RLS |
| `react-i18next` | `next-intl` (Phase 1 baseline) | next-intl 3.x ~2024 with RSC support | Native App Router support; smaller; better SSR |
| Pages Router + `getServerSideProps` | App Router + Server Components + tRPC | Next.js 13/14 stabilized App Router | Pre-fetch on server; Suspense boundaries; less client JS |
| Single-table inheritance with `type` discriminator + nullable columns | Class-table inheritance (base + N extensions) | Long-standing best practice (Martin Fowler PoEAA) | Type-safe columns; per-table RLS; smaller per-row storage |

**Deprecated/outdated:**
- FullCalendar premium "Resource Timeline" plugins → out of scope per UI-SPEC §Registry Safety; v1 uses free plugins only
- jQuery FullCalendar v3 docs (some Stack Overflow answers reference these) → ignore; v6 API is different
- `RRULE.txt` formatted strings with `DTSTART:` baked in → we store DTSTART separately on `calendar_events.starts_at`
- `expandRrule` from `node-ical` → too heavy; pure `rrule` package is enough

---

## Runtime State Inventory

**Trigger:** Not a rename / refactor / migration phase. Phase 3 is greenfield schema + UI additions on top of Phase 1+2 infrastructure. No existing runtime state to migrate.

**Stored data:** None — no existing `calendar_events`/related rows in Supabase. The migration is purely additive (CREATE TABLE).
**Live service config:** None — no n8n / Datadog / Tailscale / Cloudflare resources reference calendar entities yet.
**OS-registered state:** None.
**Secrets / env vars:** None new — no new API keys required for Phase 3 (FullCalendar is OSS; rrule is OSS).
**Build artifacts:** Tailwind 4 CSS rebuilds the bundle on `globals.css` changes; the new `--cal-event-*` tokens force one rebuild. No package or binary artifact lifecycle considerations.

---

## Environment Availability

> Phase 3 has zero new external dependencies beyond npm packages. Skip in-depth probing.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 15+ | Schema + RLS + SECURITY DEFINER | ✓ | Supabase Pro 15 (Frankfurt) | — |
| Node.js 22+ | `rrule` package | ✓ | repo runs on 22.x | — |
| `npm` or `pnpm` | Install FullCalendar + rrule | ✓ | pnpm@9.15.0 (repo) | — |
| Better Auth session | RLS GUC binding | ✓ | Phase 1 | — |
| RLS infrastructure | Calendar policies | ✓ | Phase 1 `0002` migration | — |

**No missing dependencies. No fallbacks needed.**

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (unit + integration) + Playwright 1.59+ (e2e) `[VERIFIED: package.json]` |
| Config file | `vitest.config.ts`, `playwright.config.ts` (already at repo root) |
| Test container | `@testcontainers/postgresql` 11.x for RLS tests (already in devDeps) |
| Quick run command | `pnpm test -- calendar` (vitest run with filter) |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Cross-Phase Validation Surface

Phase 3 touches the following Phase 1/2 infrastructure surfaces — each is a contract that must continue to pass after Phase 3 lands:

| Surface | Contact Point | Validation |
|---------|---------------|------------|
| `current_user_id()` / `current_user_role()` STABLE wrappers (Phase 1) | New RLS policies on calendar_events read these | Integration test: RLS denies when GUCs unset |
| `app.user_id` / `app.user_role` GUC binding (Phase 1 `withRlsContext`) | Every calendar tRPC route inherits this | Existing `tests/integration/caller-context.test.ts` exercises this — re-run in Phase 3 CI |
| `players_visible_to(uid, role)` SECURITY DEFINER (Phase 1) | NOT directly used by Phase 3, but `calendar_events_visible_to` mirrors the pattern; ensure no name clash | Migration apply test confirms no function-overload error |
| `audit_log` table (Phase 1) | Phase 3 writes 5 new action codes: `calendar_event_created`, `calendar_event_updated`, `calendar_event_deleted`, `calendar_event_decline`, `calendar_event_conflict_override` | Integration test: each mutation produces exactly one audit row |
| `academy_memberships` (Phase 1) | `calendar_events_visible_to` UNION reads this for trainer/academy_manager branch | Existing `am_visible` policy continues to allow callers to read their own memberships |
| `parent_child_links` (Phase 1) | `calendar_events_visible_to` UNION reads this for parent branch | Existing `pcl_visible` policy continues to allow callers to read their own links |
| `players` / `trainers` tables (Phase 2) | FK targets from `training_sessions.trainer_id`, `stages.player_ids[]` via junction | `tests/integration/calendar-rls.test.ts` exercises FK integrity on delete |
| `lookups` (Phase 1) + new `event_type` lookup | Codes referenced from `calendar_events.type_code` | Lookup-codes test in `tests/unit/lookup-codes.test.ts` extended with 6 new codes |
| `messages/{nl,en,fr}.json` catalogs (Phase 1) | Phase 3 adds `calendar.*`, `lookup.eventType.*`, `errors.calendar.*` | `tests/unit/schema-locale.test.ts` continues to enforce all-keys-present in all locales |
| FullCalendar 6.x npm install | New dep — package-lock.json change | `pnpm test -- magic-bytes` and dep-audit run unchanged; FC is MIT verified |
| Design tokens (Phase 1/2 `globals.css`) | Phase 3 adds 6 `--cal-event-*` triples + FC overrides | Visual regression test in Playwright (smoke: page renders without console errors) |
| Phase 4 schema-handover | `session_participants`, `session_sparring_partners`, `tournament_results`, `match_results`, `ranking_entries` — Phase 4 adds these | Phase 3 PLAN.md documents the contract; no automated test (Phase 4 verifies on its own) |
| Phase 5 medical-event semantic boundary | `medical_appointments` extension is non-Article-9 metadata only — no medical body | Unit test: schema declaration has no `body` or `diagnosis` column |

### Validation Dimensions

| Dimension | What to test | Tool |
|-----------|--------------|------|
| **Schema integrity** | All 10 new tables exist with correct columns; FK CASCADE cascades correctly on parent DELETE; unique constraints fire | `tests/unit/migration-format.test.ts` extension; testcontainers PG migration apply |
| **RLS scoping for 5 roles × 6 event types** | Sample matrix (≥ 30 cases): player sees only own; trainer sees own + academy players; TD sees all; parent sees child's; sparring_partner sees nothing in Phase 3 (no-op) | `tests/rls/calendar-direct-query.test.ts` — direct psql connection with `app.user_id` GUC set per fixture |
| **RRULE expansion correctness** | Single occurrence; weekly with COUNT; weekly with UNTIL; UNTIL beyond 2y rejected; INTERVAL=2; exception applied (move + cancel) | `tests/unit/rrule.test.ts` — pure function tests on `expandRrule` |
| **RRULE horizon enforcement** | Write-time: create with UNTIL > +2y rejected; create with no UNTIL/COUNT auto-injects UNTIL = +2y; Read-time: list with range > 2y rejected | `tests/integration/calendar-rrule-horizon.test.ts` |
| **Exception application** | Cancel: occurrence dropped from list; Move: occurrence's start/end overridden; Retitle: title overridden; UNIQUE(event_id, occurrence_date) enforced | `tests/integration/calendar-exceptions.test.ts` |
| **Conflict detection** | Same-time same-participant detected; different-participant NOT detected; recurring conflict detected (RRULE expansion); force:true override succeeds + audit row written; cross-scope detection works (medical conflict surfaces for academy_manager); redacted detail for non-visible event; full detail for visible event | `tests/integration/calendar-conflicts.test.ts` |
| **Mobile responsive** | < 640px: timeGridDay forced; swipe → next/prev day; "Nieuwe afspraak" floats bottom-right; filter bar in bottom Sheet | `tests/e2e/calendar-mobile.spec.ts` — Playwright mobile viewport |
| **Color tokens** | `--cal-event-{type}-{bg|fg|border}` declared light + dark; chip background uses correct token per type | `tests/unit/color-tokens.test.ts` — parse globals.css and assert 18 tokens × 2 modes |
| **i18n catalog completeness** | 3 locales × all `calendar.*` + `lookup.eventType.*` + `errors.calendar.*` keys present; values non-empty | `tests/unit/schema-locale.test.ts` extension |
| **Audit log entries** | Create → 1 row `calendar_event_created`; update → `_updated`; delete → `_deleted` with JSONB snapshot; decline → `_decline`; override → `_conflict_override` | `tests/integration/calendar-audit.test.ts` |
| **Drag-resize edits** | eventDrop fires update mutation; eventResize fires update mutation; optimistic update reverts on server reject | `tests/e2e/calendar-drag.spec.ts` |
| **Delete cascade** | Delete event → extension row, participants, exceptions all gone (FK CASCADE) | `tests/integration/calendar-cascade.test.ts` |
| **Decline ≠ Delete** | Decline by participant → rsvp_status='declined', event still exists for others; only creator/TD sees Delete button | `tests/integration/calendar-decline.test.ts` |
| **Performance budget (RISK-POLYMORPH)** | calendar.list week-range with 200 events + 30 RRULE returns in < 200ms | `tests/integration/calendar-perf.test.ts` — seeded fixture + timing assertion |
| **Filter scope enforcement** | filterOptions.list as trainer for 'Speler' kind returns only academy players; as sparring_partner returns empty | `tests/integration/calendar-filter-options.test.ts` |

### Validation Locations

```
tests/
├── unit/
│   ├── rrule.test.ts                        # NEW — expandRrule, parseRrule, validateHorizon (pure)
│   ├── color-tokens.test.ts                 # NEW — assert 18 cal-event tokens × 2 modes in globals.css
│   ├── lookup-codes.test.ts                 # EXTEND — add 6 event_type codes
│   ├── schema-locale.test.ts                # EXTEND — add calendar.* / lookup.eventType.* / errors.calendar.*
│   └── migration-format.test.ts             # EXTEND — assert 0009/0010/0011/0012 + rollback companions
├── integration/
│   ├── calendar-rls.test.ts                 # NEW — RLS scope across 5 roles × 6 types (sample 30 cases)
│   ├── calendar-rrule-horizon.test.ts       # NEW — D-55 write-time + read-time gates
│   ├── calendar-exceptions.test.ts          # NEW — cancel/move/retitle override + unique
│   ├── calendar-conflicts.test.ts           # NEW — D-56/D-57 incl. cross-scope + redaction
│   ├── calendar-audit.test.ts               # NEW — 5 audit action codes + JSONB snapshot
│   ├── calendar-cascade.test.ts             # NEW — FK CASCADE on delete
│   ├── calendar-decline.test.ts             # NEW — RSVP decline ≠ delete
│   ├── calendar-perf.test.ts                # NEW — < 200 ms week-range with 200+30 fixture
│   └── calendar-filter-options.test.ts      # NEW — scope-filtered type-ahead source
├── rls/
│   └── calendar-direct-query.test.ts        # NEW — direct psql with GUC set; assert 0 rows out of scope
└── e2e/
    ├── calendar-week-view.spec.ts            # NEW — week view renders, events click, sheet opens
    ├── calendar-create-event.spec.ts         # NEW — drag-create flow, conflict warning, save
    ├── calendar-mobile.spec.ts               # NEW — Playwright mobile viewport (Pixel 5) — swipe nav
    └── calendar-drag.spec.ts                 # NEW — drag event to new time, optimistic + conflict revert
```

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CAL-01 | Week view renders as default | e2e | `pnpm test:e2e -- calendar-week-view` | ❌ Wave 0 |
| CAL-02 | Month + year views available | e2e | `pnpm test:e2e -- calendar-week-view` (same spec) | ❌ Wave 0 |
| CAL-03 | 6 event types color-coded | unit | `pnpm test -- color-tokens` | ❌ Wave 0 |
| CAL-04 | Caller-scoped events | integration + RLS | `pnpm test -- calendar-rls` | ❌ Wave 0 |
| CAL-05 | Filter bar (5 facets) | integration + e2e | `pnpm test -- calendar-filter-options` | ❌ Wave 0 |
| CAL-07 | Conflict warning on overlap | integration + e2e | `pnpm test -- calendar-conflicts` | ❌ Wave 0 |
| CAL-08 | Mobile single-day + swipe | e2e | `pnpm test:e2e -- calendar-mobile` | ❌ Wave 0 |
| TRAIN-01 | Training session schema | unit | `pnpm test -- migration-format` | ❌ Wave 0 |
| TOURN-01 | Tournament schema | unit | `pnpm test -- migration-format` | ❌ Wave 0 |
| MED-EVENT | Medical event schema (non-Article-9) | unit | `pnpm test -- migration-format` + manual: assert no `body`/`diagnosis` columns | ❌ Wave 0 |
| GDPR-04 | Audit on every mutation | integration | `pnpm test -- calendar-audit` | ❌ Wave 0 |
| GDPR-08 | TIMESTAMPTZ enforcement | unit (lint rule from Phase 1) | `pnpm test -- timestamps` | ✅ (Phase 1) |
| I18N-05 | event_type codes in DB, labels in catalogs | unit | `pnpm test -- lookup-codes` + `schema-locale` | ❌ Wave 0 |
| I18N-07 | Date formatting per locale | unit | `pnpm test -- intl-format` | ✅ (Phase 1) |
| I18N-08 | Zod messages as i18n keys | unit | `pnpm test -- player-schemas` pattern extended | ❌ Wave 0 |
| USER-04 | Role scope at API + DB | RLS direct-query | `pnpm test -- calendar-direct-query` | ❌ Wave 0 |
| RISK-POLYMORPH | < 200 ms week-range | integration perf | `pnpm test -- calendar-perf` | ❌ Wave 0 |
| RISK-RRULE | 2y horizon enforced both sides | integration | `pnpm test -- calendar-rrule-horizon` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test -- calendar` (vitest filter; includes unit + integration for `calendar*` files) — < 30 seconds expected
- **Per wave merge:** `pnpm test && pnpm test:e2e` — full suite (~3 min unit, ~5 min e2e)
- **Phase gate:** Full suite green; manual smoke on Supabase staging confirming week view loads with seeded events

### Wave 0 Gaps

- [ ] `tests/unit/rrule.test.ts` — RRULE pure-function coverage
- [ ] `tests/unit/color-tokens.test.ts` — globals.css token parse + assert
- [ ] `tests/integration/calendar-rls.test.ts` — 30-case role × type matrix
- [ ] `tests/integration/calendar-rrule-horizon.test.ts` — D-55 write+read gates
- [ ] `tests/integration/calendar-exceptions.test.ts` — D-54 exception application
- [ ] `tests/integration/calendar-conflicts.test.ts` — D-56/D-57 detection + redaction
- [ ] `tests/integration/calendar-audit.test.ts` — 5 audit codes + JSONB snapshot
- [ ] `tests/integration/calendar-cascade.test.ts` — FK CASCADE on delete
- [ ] `tests/integration/calendar-decline.test.ts` — RSVP decline vs delete
- [ ] `tests/integration/calendar-perf.test.ts` — RISK-POLYMORPH budget
- [ ] `tests/integration/calendar-filter-options.test.ts` — scope-filtered type-ahead
- [ ] `tests/rls/calendar-direct-query.test.ts` — direct psql RLS proof
- [ ] `tests/e2e/calendar-week-view.spec.ts` — base week view + event click
- [ ] `tests/e2e/calendar-create-event.spec.ts` — drag-create + conflict + save
- [ ] `tests/e2e/calendar-mobile.spec.ts` — Pixel 5 viewport + swipe
- [ ] `tests/e2e/calendar-drag.spec.ts` — drag event + conflict revert
- [ ] **Shared fixtures:** seed helper in `tests/fixtures/calendar-seed.ts` that creates a TD + 2 trainers + 6 players + an academy + events of all 6 types (some recurring, some with exceptions, some with conflicts)

### Acceptance Test Mapping

ROADMAP Phase 3 succescriteria 1–5 → test files:

| Succescriterium | Test file(s) | Assertion |
|-----------------|-------------|-----------|
| 1. TD opens kalender, ziet alle events kleurgecodeerd | `e2e/calendar-week-view.spec.ts` + `unit/color-tokens.test.ts` | Login as TD; assert ≥ 6 events visible; assert each chip has the right `--cal-event-{type}-{bg}` |
| 2. Speler ziet alleen eigen events (RLS) | `integration/calendar-rls.test.ts` + `rls/calendar-direct-query.test.ts` | tRPC list as player_a returns only events where player_a is participant OR creator; direct psql as `app_user` with `app.user_id=player_a` returns same set |
| 3. Sparring partner ziet alleen own sessions | `integration/calendar-rls.test.ts` | **Phase 3 NO-OP** — Phase 3 returns empty for sparring_partner per D-50 — test ASSERTS empty result; Phase 4 will replace this assertion |
| 4. Conflict warning when nieuw event overlapt | `integration/calendar-conflicts.test.ts` + `e2e/calendar-create-event.spec.ts` | Create overlapping event → `{conflicts: [{...}], blocked: false}`; "Toch opslaan" succeeds + audit row |
| 5. Mobile < 480px = single-day + swipe | `e2e/calendar-mobile.spec.ts` | Viewport 360×640; assert `timeGridDay` rendered; perform horizontal swipe; assert FC API `.next()` called |

### Validation Risks

| Risk | Mitigation |
|------|-----------|
| **Cross-locale visual regression** | Manual visual review at Phase 3 verification — automating Playwright screenshot diff per locale is out of scope for Phase 3 (deferred to Phase 8) |
| **RRULE timezone edge cases (DST transitions)** | Unit test exercises DST boundary explicitly: a weekly Tuesday 10:00 Europe/Brussels event spanning the Oct 25 DST end stays at 10:00 local time post-transition |
| **Server-side expansion performance at scale** | Perf test in CI with seeded fixture (200 events + 30 RRULE) asserts < 200 ms p95; reproducible on the same Supabase staging plan as production |
| **FullCalendar 6 + React 19 hydration issues** | Wrap in Suspense with skeleton; load locale before rendering FC; e2e test asserts no console errors on first paint |
| **Drag/resize on touch — false-positive swipes** | Manual UAT on iOS Safari + Android Chrome (Phase 8 polish risk); Phase 3 ships desktop drag + mobile click-only |
| **Cross-scope conflict redaction logic correctness** | Integration test covers all 4 visibility paths: TD; participant-in-conflicting; creator-of-conflicting; none (redacted). Assertions on `detailMode` field |
| **Audit JSONB snapshot bloat for large recurring events** | Test creates a recurring event with 2y horizon × 30 participants × 50 exceptions; assert `audit_log.old_values` is < 1 MB and contains `exceptionsTotalCount` |

---

## Security Domain

### Applicable ASVS Categories (Level 1 per `.planning/config.json` `security_asvs_level: 1`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Document trust boundaries (Server vs Client Component, RLS-bound tx, SECURITY DEFINER fences) — see Architecture Diagram |
| V2 Authentication | inherited | Phase 1 Better Auth — no Phase 3 changes |
| V3 Session Management | inherited | Phase 1 — Phase 3 mutations honor `requireFreshSession` if added (e.g., medical event create — planner discretion) |
| V4 Access Control | yes | RLS policies on every new table (`calendar_events`, `calendar_event_participants`, `calendar_event_exceptions`, 6 extensions); tRPC per-type role gate (D-48) |
| V5 Input Validation | yes | Zod discriminated-union per event type; `.strict()` rejects unknown keys; CHECK constraints (overlap, rsvp enum, role_in_event enum); UNTIL horizon validation |
| V6 Cryptography | inherited | No new pgcrypto columns — medical_appointments holds non-Article-9 metadata only; doctor name is **borderline** and must be reviewed against Phase 1 medical_events pattern (flag for Phase 5 review) |
| V7 Error Handling | yes | Out-of-scope event deep-link returns `NOT_FOUND` not `FORBIDDEN` (D-36 carry-forward — no enumeration leak); error messages are i18n keys |
| V8 Data Protection | yes | TIMESTAMPTZ UTC (GDPR-08); audit-log JSONB snapshot for delete (forensic recovery); conflict detection deliberately leaks **existence** to ensure scheduling correctness — documented trade-off per D-57 |
| V9 Communication | inherited | Phase 1 HTTPS + secure cookies |
| V10 Malicious Code | n/a | No file upload in Phase 3 (file VALID-04 malware scan applies to Phase 5 medical scans) |
| V11 Business Logic | yes | "Soft warning, never block" pattern documented (D-57); override audit-logged; 3 separate semantically-distinct delete operations per D-58 |
| V12 Files & Resources | n/a | No new files |
| V13 API & Web Service | yes | tRPC procedure presets enforce auth + RLS + consent in fixed order |
| V14 Configuration | yes | New `event_type` lookup is admin-managed (Phase 1 pattern); no env vars added |

### Known Threat Patterns for Phase 3 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-scope event enumeration (caller probes for events they shouldn't see) | Information Disclosure | RLS via `calendar_events_visible_to`; `NOT_FOUND` (not `FORBIDDEN`) for out-of-scope deep links — D-36 pattern |
| RRULE expansion DoS (crafted RRULE with no UNTIL → memory blow-up) | Denial of Service | Write-time + read-time horizon gates (D-55); read-time clamps even on legacy data |
| Conflict-detection privilege escalation (bypass redaction to read other roles' calendars) | Information Disclosure | Service-layer redaction is the ONLY surface — SECURITY DEFINER returns redactable fields only; description never returned; tested |
| Delete-cascade collateral (deleting an event accidentally drops shared data) | Tampering / DoS | FK CASCADE scope is documented; pre-DELETE JSONB snapshot enables forensic recovery; AlertDialog confirmation required |
| Participant role injection (`role_in_event` set to invalid value) | Tampering | CHECK constraint on `role_in_event IN ('organizer','participant','invitee')` + Zod enum |
| RSVP forgery (decline another participant's invite) | Spoofing / Tampering | `declineParticipation` only updates row WHERE `user_id = current_user_id()` (RLS + WHERE clause) |
| Audit log tampering | Tampering | Append-only via REVOKE UPDATE/DELETE ON audit_log (Phase 1 baseline); Phase 3 inherits |
| Override-then-revert (set conflict force, observe, revert) | Information Disclosure | Override is audit-logged BEFORE the mutation succeeds; revert is its own audit entry — full trail visible to TD |
| Locale switch leaks pre-rendered content of wrong locale | Information Disclosure | next-intl RSC re-renders on locale change; we never cache per-locale strings |
| Drag-drop replay (replay an old eventDrop mutation) | Tampering | Idempotency-key middleware (Phase 1) covers POST mutations — Phase 3 inherits |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `rrule` package's `RRule.optionsToString()` produces valid RFC 5545 output that `rrulestr()` round-trips | Pattern 3, Pitfall 8 | Stored rrule strings might be unparseable on next read; mitigated by unit test that round-trips every UI-constructed rrule |
| A2 | FullCalendar 6.1.20 supports React 19 strict-mode rendering without warnings | Pattern 1 | If false: pin to a React 19-compat version; mitigated by smoke e2e test in Wave 0 |
| A3 | Supabase Postgres 15 supports `tstzrange()` and `&&` operator in SECURITY DEFINER fns | Pattern 4 | If false (unlikely for a stable PG feature): fall back to explicit `(starts_at < to AND ends_at > from)`; functional equivalence preserved |
| A4 | `@fullcalendar/core/locales/nl` includes Belgian Dutch (nl-BE) conventions (Monday first, 24h time) | Pattern 1, i18n section | If only includes nl-NL conventions: override via FC config `firstDay={1}` (we already set this) + slot label format `HH:mm`; mitigated explicitly |
| A5 | RISK-POLYMORPH < 200 ms budget is achievable with B-tree on (starts_at, ends_at) + index on (user_id, event_id) without GiST | §Don't Hand-Roll, Performance | If false (large per-row scan): add partial index on `rrule IS NOT NULL` and consider GiST on tstzrange; perf test catches at Wave 0 |
| A6 | `medical_appointments` extension can store doctor name as free text without falling under GDPR Art. 9 | §Phase Requirements (MED-EVENT) | If legal review pushes back: encrypt via pgcrypto in Phase 5 follow-up migration (additive); flagged in Phase 5 integration-point note |
| A7 | Audit-log JSONB snapshot < 1 MB for realistic recurring-event row-family | Pitfall 9 | If false (heavily-attended event): cap exceptions array at 1000 and store `exceptionsTotalCount` — tested |
| A8 | The 5 ROADMAP succescriteria + UI-SPEC dimensions are exhaustive Phase 3 acceptance — no implicit Phase 4 acceptance | §Phase Boundary | If Phase 4 requires Phase 3 to ship some operational feature: scope creep; mitigated by explicit Phase-4-handover documentation in Phase 3 PLAN |
| A9 | Vanilla pointerevents for swipe work on iOS Safari 17+ and Chrome Android (latest) without library | Pitfall 7 | If false: ship `react-swipeable` as fallback; mitigated by manual UAT in Phase 8 |
| A10 | next-intl `useTranslations('calendar')` is supported in both Server Components (via `getTranslations`) and Client Components within a `[locale]` segment | §i18n | Phase 1 baseline already established this; low risk |

---

## Open Questions

1. **Should `medical_appointments.doctor` be encrypted?**
   - What we know: per D-47, the Phase 3 extension stores doctor as **free text**. Phase 1's `medical_events` uses pgcrypto for diagnosis. The CONTEXT.md flags this: *"Doctor naam vrij tekst is grensgeval; valideer met legal of dit veld in cipher moet."*
   - What's unclear: whether a doctor name on a calendar event is GDPR Art. 9 (medical data) or just a contact name.
   - Recommendation: ship as plain text in Phase 3 (consistent with location free-text); flag in Phase 5 integration-point doc; Phase 5 has the option of an additive migration to pgcrypto-encrypt the column once medical_events is fully wired.

2. **Index strategy: B-tree composite vs GiST on `tstzrange`?**
   - What we know: per D-56 the overlap test is `tstzrange(a, b) && tstzrange(c, d)`. GiST accelerates this; B-tree on `(starts_at, ends_at)` is range-friendly via index-only scans.
   - What's unclear: at our cardinality (probably ≤ 10K events total in v1), the planner may chose seq-scan anyway and indexes are irrelevant.
   - Recommendation: ship B-tree first; run EXPLAIN ANALYZE on Wave-0 fixture; add GiST partial index if perf test fails the 200 ms budget.

3. **Should we split `calendar.ts` into `calendar/event.ts` + `calendar/filterOptions.ts`?**
   - What we know: CONTEXT.md leaves this as Claude's discretion.
   - What's unclear: how much code per file is healthy. Phase 1's `consent.ts` is ~480 lines and works; Phase 2's `player.ts` is ~700 lines and also works.
   - Recommendation: start in one file `calendar.ts`. Plan a follow-up split if the file exceeds 1500 lines or test coverage gets unwieldy.

4. **Does the Phase 4 handover require a "frozen schema" guard (CI check)?**
   - What we know: D-51 forbids Phase 4 from modifying Phase 3 schemas.
   - What's unclear: a CI guard could refuse a PR that touches `src/server/db/schema/calendar.ts` after Phase 3 verification — but might over-block legitimate fixes.
   - Recommendation: PLAN.md documents the contract in plain English; CI guard deferred to Phase 4 baseline if drift observed.

5. **Conflict detection: should we also consider EVENT-creator overlap?**
   - What we know: D-56 says **per-participant** overlap, not creator. A creator who is NOT a participant of either event would not surface conflicts on their own calendar.
   - What's unclear: a TD organising 3 different trainings in the same slot but assigning different participants — should that be a "you're double-booked yourself as organizer" warning?
   - Recommendation: D-56 is explicit — no creator-only conflict. Document in PLAN. If UAT surfaces a need, add post-Phase-3 enhancement.

6. **Mobile breakpoint: 640px or 480px?**
   - What we know: UI3-D7 chooses 640px; CAL-08 requires "< 480px shows single-day".
   - What's unclear: nothing — UI3-D7 explicitly meets CAL-08 since anything <480 is also <640.
   - Recommendation: 640px (UI3-D7). Planner doesn't need to revisit.

---

## Project Constraints (from CLAUDE.md)

- **Language:** Multilingual UI — nl (default), en, fr. All user-facing labels/copy/validation/email/consent must be available in all three locales before production. Codes in DB; labels in i18n catalogs. Backend logs and source code remain English. **Phase 3 fully complies via the next-intl integration.**
- **GDPR:** Medical data, parent-child links, role scoping technically enforced. Consent tracking versioned per locale. **Phase 3 medical_appointments is non-Article-9 metadata; the Article-9 boundary is Phase 5's medical_events.**
- **Usability:** Platform must be operationally strong from day one — calendar is among the two most critical surfaces. **Phase 3 ships full CRUD across 6 event types.**
- **Calendar:** Week view (Outlook-style) is mandatory for v1; all event types color-coded. **Phase 3 mandate.**
- **Data integrity:** Lookups centrally managed; not free-text. **`event_type` lookup added; FK enforces.**
- **Authorization:** Role scoping is a hard constraint at API/data layer. **RLS on calendar_events + SECURITY DEFINER helper, mirroring Phase 1.**

**Stack constraint:** Next.js 15 App Router + tRPC 11 + Drizzle 0.45 + Postgres 16 (Supabase) + Better Auth + Tailwind 4 + shadcn — all already in repo per `package.json`. Phase 3 adds FullCalendar 6.x + rrule 2.8.1 only.

**Forbidden technologies:** Firebase, Supabase auth/SDK as primary, Auth0/Clerk, Prisma, MongoDB, Vercel as primary host, Pusher managed, Mux/Wistia, react-big-calendar, react-i18next, moment.js, jQuery. **Phase 3 uses none of these.**

**Workflow constraint:** GSD command entry-point required for repo edits per CLAUDE.md "GSD Workflow Enforcement" section. **This research is being conducted under `/gsd-plan-phase 3` — compliant.**

---

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-kalender/03-CONTEXT.md` — D-47..D-59 locked decisions (verbatim) + Claude's Discretion + Deferred Ideas
- `.planning/phases/03-kalender/03-UI-SPEC.md` — 875-line approved design contract (FullCalendar config, 6 color tokens, copywriting in 3 locales, mobile breakpoint, conflict UI surfaces)
- `.planning/REQUIREMENTS.md` — CAL-01..08, TRAIN-01..06, TOURN-01..04, AGE-01..04, USER-04, GDPR-04/08, I18N-05..08
- `.planning/ROADMAP.md` Phase 3 + Phase 4 sections — succescriteria, kerntaken, RISK-RRULE/MOBILE/POLYMORPH
- `drizzle/0000_initial.sql` — Phase 1 base schema (users, lookups, audit_log, memberships)
- `drizzle/0002_rls_functions_and_policies.sql` — Phase 1 RLS pattern (the canonical reference for Phase 3's calendar_events_visible_to + overlapping_events_for_users)
- `drizzle/0006_phase2_profiles_and_files.sql` + `0007_phase2_rls_policies.sql` — Phase 2 schema + RLS template
- `src/server/trpc/middleware/{freshSession,audit,rls}.ts` — Phase 1 procedure presets + audit + RLS-tx binding
- `src/server/db/schema/{lookups,audit,memberships,auth}.ts` — Phase 1 pgTable patterns to mirror
- `src/lib/i18n-format.ts` — date-fns formatters per locale (reused 1:1 in Phase 3)
- `src/server/trpc/routers/player.ts` + `schemas/player.ts` — Phase 2 router + Zod schema patterns
- `package.json` — verified package versions; `vitest.config.ts` + `playwright.config.ts` — test framework presence

### Secondary (MEDIUM confidence — official docs)
- [FullCalendar v6 Upgrade Notes](https://fullcalendar.io/docs/upgrading-from-v5) — React peer-dep, eventContent JSX
- [FullCalendar React Integration](https://fullcalendar.io/docs/react) — installation, plugin wiring, ref API
- [FullCalendar Locale](https://fullcalendar.io/docs/locale) — dynamic import pattern
- [FullCalendar Content Injection](https://fullcalendar.io/docs/content-injection) — `eventContent` callback constraints (no hooks)
- [FullCalendar Touch Support](https://fullcalendar.io/docs/touch) — mobile gestures
- [FullCalendar Event Render Hooks](https://fullcalendar.io/docs/event-render-hooks) — eventDidMount for aria-label
- [FullCalendar Pricing](https://fullcalendar.io/pricing) — MIT for v1 plugin set, premium scope
- [rrule npm](https://www.npmjs.com/package/rrule) + [rrule GitHub](https://github.com/jkbrzt/rrule) — package usage, RFC 5545 compliance, DTSTART option, RRuleSet for EXDATE
- [iCalendar.org RFC 5545 §3.8.5.1 EXDATE](https://icalendar.org/iCalendar-RFC-5545/3-8-5-1-exception-date-times.html) + [§3.8.5.3 RRULE](https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html) — exception date semantics
- [Nylas "Deceptively Complex World of Calendar Events and RRULEs"](https://www.nylas.com/blog/calendar-events-rrules/) — production-grade RRULE pitfalls
- [PostgreSQL RLS docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — SECURITY DEFINER + ENABLE/FORCE pattern
- [PostgreSQL Range Types](https://www.postgresql.org/docs/current/rangetypes.html) — tstzrange operator semantics
- [Drizzle Relations v2](https://orm.drizzle.team/docs/relations-v2) + [Drizzle Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints) — composite PK + FK CASCADE syntax
- [next-intl App Router](https://next-intl.dev/docs/getting-started/app-router) + [next-intl Server/Client Components](https://next-intl.dev/docs/environments/server-client-components) — useTranslations vs getTranslations boundary

### Tertiary (LOW confidence — verified against primary)
- [Wanago — Polymorphic Associations with PostgreSQL + Drizzle ORM](http://wanago.io/2024/10/14/api-nestjs-drizzle-polymorphic-associations-postgresql/) — class-table inheritance pattern (cross-checked with Drizzle official)
- [boringSQL — Beyond Start and End: PostgreSQL Range Types](https://boringsql.com/posts/beyond-start-end-columns/) — tstzrange + GiST trade-offs (cross-checked with PG docs)
- [Bytebase — Postgres RLS Footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) — SECURITY DEFINER caution; informs but doesn't change Phase 1's established pattern
- [Medium — Range Types in PostgreSQL and GiST Indexes](https://medium.com/dataseries/range-types-in-postgresql-and-gist-indexes-788db23346c5) — index strategy background

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all packages verified against npm registry on 2026-05-14; FullCalendar v6.1.20 + rrule 2.8.1 are current stable; both MIT/BSD; React 19 + Next 15 compat confirmed by ecosystem usage
- Architecture: **HIGH** — patterns mirror Phase 1 (RLS + SECURITY DEFINER) and Phase 2 (Drizzle schema, tRPC routers, RHF forms) explicitly; class-table inheritance is well-documented best practice; CONTEXT.md decisions are unambiguous
- RRULE: **HIGH** — `rrule` package usage patterns confirmed via official README and RFC 5545 reference; one known DST edge case documented as Pitfall 3
- RLS + SECURITY DEFINER: **HIGH** — Phase 1's `0002_rls_functions_and_policies.sql` is the canonical reference; Phase 3 extends with the same pattern
- Conflict detection (cross-scope + redaction): **MEDIUM** — D-57 is novel to Phase 3; tested with integration suite to ensure the service-layer redaction is the only surface
- Pitfalls: **HIGH** — drawn from existing Phase 1/2 code patterns + ecosystem GitHub issues; the FullCalendar SSR pitfall is well-documented
- Performance budget: **MEDIUM** — RISK-POLYMORPH budget (200 ms) is reasonable but requires verification at Wave 0 with seeded fixture
- Test coverage map: **HIGH** — derived from succescriteria + cross-phase surfaces; comprehensive

**Research date:** 2026-05-14
**Valid until:** ~2026-06-14 (30 days) — FullCalendar and rrule are stable; re-verify before Phase 4 if either ships a major

## RESEARCH COMPLETE
