---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 3 UI-SPEC approved — awaiting CONTEXT / planning
last_updated: "2026-05-13T22:30:00.000Z"
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 34
  completed_plans: 34
  percent: 100
---

# Project State — VTTL Topsportplatform

## Current Status

Phase: 3 — Kalender ◆ UI-SPEC approved
Active Phase: 03-kalender (UI design contract locked; awaiting CONTEXT / planning)
Last Action: Phase 3 UI-SPEC approved (6/6 dimensions pass on pass 3 of 3; 1 non-blocking FLAG on `calendar.filters.apply` fr = "Appliquer" single-word, idiomatic). Locks visual + interaction contracts: FullCalendar 6 (timeGridWeek default, timeGridDay mobile <640px), six event-type color tokens (CAL-03), right-side `<Sheet>` for event detail + create/edit, inline `<Alert>` conflict UI with audit-logged "Save anyway" override, URL-persisted view/date/filter state. 12 default design decisions flagged in spec for user override before planning.

Resume: `/gsd-discuss-phase 3` (gather CONTEXT for planning — 12 spec defaults to confirm or override) OR `/gsd-plan-phase 3` (skip discussion, plan directly with UI-SPEC as design context).
Artifacts: `.planning/phases/03-kalender/03-UI-SPEC.md` (875 lines, status: approved)

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** Every player's complete development picture is visible in one place, accessible by the right people, and actionable in daily sports operations.
**Current focus:** Phase 3 — Kalender (next)

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Fundament | ✅ Complete (18/18 plans, 1 code-review fix cycle, verifier human_needed deferred to UAT) |
| 2 | Identiteit & Bestanden | ✅ Complete (16/16 plans + verifier gap-closure; live on Supabase eu-west-1; 4 UAT items deferred) |
| 3 | Kalender | ◆ UI-SPEC approved (awaiting CONTEXT / planning) |
| 4 | Kerndomein | ⬜ Not started |
| 5 | Uitgebreid domein | ⬜ Not started |
| 6 | Communicatie | ⬜ Not started |
| 7 | Synthese | ⬜ Not started |
| 8 | Kwaliteit & Release | ⬜ Not started |

## Open Questions

- RISK-01: Medical scan uploads in v1 — include or defer? (scope-spanning: deferred in physical section, required in medical section of brief)
- RISK-02: Ranking direction for Belgium Ranking — confirm whether lower or higher value = better

## Key Constraints

- Three-language UI: nl (default) / en / fr — full infrastructure built in Phase 1
- GDPR: medical data = Art. 9 special category; Belgian minor consent threshold = 16; consent text versioned per locale
- All data residency in EU (Supabase Pro Frankfurt + Hetzner; Resend EU-region; Sentry EU; Upstash EU)
- Calendar week view (Outlook-style) mandatory for v1
- Lookups: codes in DB, labels via i18n catalogs; proper nouns not translated

---
*Last updated: 2026-05-02 — Wave 1 complete (Next.js bootstrap + wave-0 RED test scaffolding); Wave 2 next.*
