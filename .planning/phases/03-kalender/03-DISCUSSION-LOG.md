# Phase 3: Kalender - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 03-Kalender
**Areas discussed:** Schema scope + polymorphism + participants; RRULE expansion strategy; Conflict detection rules; Delete + cancel behavior

---

## A. Schema scope + polymorphism + participants

### A.1 Event types CRUD in Phase 3

| Option | Description | Selected |
|--------|-------------|----------|
| Meetings + stages only (TD-only) | Phase 3 ships only the two simplest extension tables; other 4 types render as filter chips but no creatable rows | |
| All 6 types thin-CRUD (TD-only) | All 6 extension tables with minimal columns; Phase 4/5 extend with type-specific fields | ✓ (extended) |
| Only base `calendar_events` (no extensions) | Single table + JSONB metadata; forbidden by ROADMAP "no single-table inheritance" | |
| Meetings only (absolute minimum) | Just one type creatable in v1 demo | |

**User's choice:** All 6 types — but extended beyond "thin": all type-specific domain fields per `REQUIREMENTS.md` (TRAIN-01 etc) must be inputtable at creation time. Create-permissions matrix: TD all; trainer = training + meetings; player = meetings; meetings = anyone.

**Notes:** Deliberate scope shift from ROADMAP-framing (which placed training_sessions/tournaments schema in Phase 4). Phase 4 reduces to operational/result layer (`session_participants`, `tournament_results`, `match_results`, `ranking_entries`) — no schema changes to Phase 3 event tables.

### A.2 Polymorphism strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Class-table inheritance | `calendar_events` base + 6 typed extension tables with 1:1 FK | ✓ |
| Concrete-table per type (no shared base) | 6 root tables; UNION ALL queries; loses shared filter/conflict surface | |
| Single calendar_events with JSONB extension | One table + metadata JSONB; forbidden by ROADMAP | |
| Other | — | |

**User's choice:** Class-table inheritance (recommended).
**Notes:** Honours ROADMAP "polymorphism with typed extension tables — no single-table inheritance". Phase 4 ADDS operational tables alongside; doesn't change Phase 3 schemas.

### A.3 Participant model

| Option | Description | Selected |
|--------|-------------|----------|
| Single polymorphic junction | `calendar_event_participants(event_id, user_id, role_in_event, rsvp_status)` shared across all 6 event types | ✓ |
| Per-event-type junctions | `meeting_invitees`, `stage_participants`, etc; N JOINs/UNIONs per scope query | |
| Organizer-only (no participants table) | `calendar_events.created_by` is the only participant signal in Phase 3 | |
| Other | — | |

**User's choice:** Single polymorphic junction (recommended).
**Notes:** Sparring-partner entity ships in Phase 4 (`sparring_partners` table + `session_sparring_partners` junction); Phase 3 RLS function has a no-op placeholder for `role='sparring_partner'`.

---

## B. RRULE expansion strategy

### B.1 Library + expansion architecture

| Option | Description | Selected |
|--------|-------------|----------|
| `rrule` npm + server-side expansion | Pure-TS RFC 5545 lib; server expands in `calendar.list({from,to})`; FullCalendar gets flat instances | ✓ |
| `@fullcalendar/rrule` plugin + client-side expansion | Client expands from stored RRULE string; less server CPU but server still needs server-side expansion for conflict-detection | |
| Materialize occurrences in DB at create time | Write N rows per recurring series; explicit ROADMAP violation ("niet-gematerialiseerd") | |
| Other | — | |

**User's choice:** `rrule` npm + server-side expansion (recommended).
**Notes:** Single source of truth on server; clients (including mobile + alt front-ends) all get correct data; conflict-detection trivially reuses the expansion logic.

### B.2 Exceptions table timing

| Option | Description | Selected |
|--------|-------------|----------|
| Ship table + full single-occurrence override in Phase 3 | `calendar_event_exceptions` with cancel + move + override fields; UI3-D12 "Deze afspraak" fully wired | ✓ |
| Ship table empty, no UI override in Phase 3 | Table exists but `'Deze afspraak'` silently edits the whole series — UI promise violated | |
| Defer table entirely to Phase 4 | No exceptions table; UI3-D12 "Deze afspraak" radio disabled for recurring events | |
| Other | — | |

**User's choice:** Ship table + full override (recommended).
**Notes:** Phase 4 will add "Deze en toekomstige" + "Alle in de reeks" on top of the same table without schema changes.

### B.3 2-year horizon enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Both write-time and read-time | Validates UNTIL ≤ created_at+2y at create; clamps expansion at read; auto-injects UNTIL on "Never" | ✓ |
| Read-time only | Caps expansion to 2y at every read; trusts arbitrary RRULE on write | |
| Write-time only | Rejects overlong RRULE at create; trusts existing rows | |
| Other | — | |

**User's choice:** Both (recommended).
**Notes:** Defense in depth — crafted RRULE can't bypass read-time gate; policy change can't make old rows blow up.

---

## C. Conflict detection rules

### C.1 Overlap definition

| Option | Description | Selected |
|--------|-------------|----------|
| Per-participant overlap | Any user in calendar_event_participants in both A and B with time overlap | ✓ |
| Per-participant + per-location overlap | Adds free-text location-equality check | |
| Per-creator only | Only `created_by` overlap; misses double-bookings across organizers | |
| Other | — | |

**User's choice:** Per-participant overlap. + explicit clarification: never block; always show as warning with "OK to book anyway?" — soft warning only, audit-logged override.
**Notes:** User asked for the warning copy to name the participant explicitly: "Speler A is al geboekt voor event XYZ from 11h to 12h" — captured as D-57b copy override.

### C.2 Cross-scope visibility + redaction

| Option | Description | Selected |
|--------|-------------|----------|
| Conflict scoped to creator's RLS visibility | If creator can't see the conflicting event, no warning; medical privacy fully preserved | (initial proposal — rejected) |
| Cross-scope detection + role-gated redaction (TD-only detail) | All overlaps detected; full title only for TD; redacted "{typeLabel}" for others | (variant — refined) |
| All overlapping events generate warnings regardless of RLS | Bypasses RLS entirely; sanitized text for all roles | |
| Other | — | |

**User's choice:** **Cross-scope detection always fires, but detail-redaction applies role-gated** — TD AND the participant themselves AND the event creator see full detail; all other roles (academy_manager, trainer, parent, sparring_partner) see only the lookup type label ("Medische afspraak", "Toernooi", "Training", etc.) + participant name + time range. Rule applies uniformly across all 6 event types.

**Notes:** User clarified that "the option you described for the TD should be the same for the Academy Manager or the trainer or the player. It should indicate that there is a 'Medical meeting planned' without further detail, only with detail for the TD or the player himself." Operational scheduling correctness wins over title-privacy; existence-privacy is preserved naturally (you can only conflict with someone you're already scheduling with).

### C.3 Soft vs hard conflict

Not asked explicitly — UI-SPEC already locks "soft warning + override + audit log" pattern. Confirmed by user clarification: "an overlap should not prevent from creating the event".

---

## D. Delete + cancel behavior

### D.1 Soft delete vs hard delete

| Option | Description | Selected |
|--------|-------------|----------|
| Soft delete + 30-day TD restore | `deleted_at` column; pg_cron hard-deletes after 30d; matches UI-SPEC copy | (initial proposal — rejected) |
| Hard delete + audit log only | Full row family CASCADE deletes; audit_log JSONB snapshot for forensics | ✓ |
| Soft delete with no TTL (forever) | Rows stay forever | |
| Other | — | |

**User's choice:** Hard delete after confirmation popup. User clarified the distinction between three operations:
- **Globaal verwijderen** (creator + TD only, hard delete with `<AlertDialog>`)
- **Ik kan niet aanwezig zijn** (any participant; sets `rsvp_status='declined'` on own junction row only; event remains global)
- **Cancel single occurrence** (already covered by `calendar_event_exceptions.cancelled=true` from Area B)

**Notes:** This requires removing the "Dit is omkeerbaar binnen 30 dagen via de TD" promise from UI-SPEC's locked `calendar.event.delete.body` copy — captured as D-58b override.

### D.2 Delete rights matrix

| Option | Description | Selected |
|--------|-------------|----------|
| Creator + TD | Most calendar apps' default; balances self-service and governance | ✓ |
| TD only | Heavier governance, no self-service for cancellation | |
| Anyone who can edit (per UI-SPEC RBAC) | Broader delegation including non-creators | |
| Other | — | |

**User's choice:** Creator + TD (recommended).

### D.3 Cascade behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Full cascade | FK CASCADE drops extension row + participants + exceptions; audit captures snapshot first | ✓ |
| Leave exceptions as orphan records | Persist exceptions after series delete; data debt | |
| Other | — | |

**User's choice:** Full cascade (recommended).

---

## Claude's Discretion

User explicitly delegated:
- Exact tRPC router file layout (one file or split)
- Migration grouping (3 migrations suggested, planner free to regroup)
- Filter-combobox query/debounce tuning
- Composite index validation via EXPLAIN ANALYZE
- BullMQ recurring jobs (none needed for Phase 3)
- Locale-loader strategy for FullCalendar (dynamic import details)
- Exact `event_type` lookup table name (`event_type` consistent with `tournament_type`/`training_type`)
- Phase 3 baseline academy_manager event-type RBAC (conservative: meetings only)

## UI-SPEC Overrides Captured Here

Two UI-SPEC locked-copy entries that this CONTEXT.md changes:

1. **D-57b — `calendar.conflict.body` sharpened to name the participant.** New canonical text in nl/en/fr supplied in CONTEXT.md.
2. **D-58b — `calendar.event.delete.body` rewritten** to remove the false "omkeerbaar binnen 30 dagen via de TD" promise. New canonical text in nl/en/fr supplied in CONTEXT.md.

Both overrides require an out-of-band UI-SPEC revision but do NOT block Phase 3 planning — planner ships the new copy directly to `messages/{nl,en,fr}.json`.

## Deferred Ideas

(See `<deferred>` section in CONTEXT.md for the full list; key items:)

- RRULE "deze + toekomstige" + "alle in reeks" scope → Phase 4
- BYDAY/BYMONTHDAY RRULE picker → Phase 4
- TD restore-UI for hard-deleted events → not built; forensic recovery via audit_log JSONB only
- Per-user "hide declined events" toggle → v2
- Location-conflict detection (zaalboeking) → v2
- Sparring-partner entity + RLS extension → Phase 4
- Realtime calendar updates → v2
- ICS / iCal export → Phase 8 (CAL-06)
- Per-user timezone setting → Phase 8
- Right-click context menu → deferred
- Print stylesheet → deferred
- Color customization per user → out of scope
