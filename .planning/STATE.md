---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 3 CONTEXT gathered — ready for planning
last_updated: "2026-05-14T00:15:00.000Z"
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 34
  completed_plans: 34
  percent: 100
---

# Project State — VTTL Topsportplatform

## Current Status

Phase: 3 — Kalender ◆ CONTEXT gathered
Active Phase: 03-kalender (UI design contract locked; CONTEXT.md captures 4-area implementation discussion; ready for planning)
Last Action: Phase 3 CONTEXT.md committed (2026-05-14, hash 404eceb). Captures: D-47..D-51 schema scope (all 6 event types with full domain-specific fields in Phase 3; class-table inheritance; polymorphic `calendar_event_participants` junction; Phase 4 reduces to operational/result layer only); D-52..D-55 RRULE (server-side expansion with `rrule` npm; `calendar_event_exceptions` table with full single-occurrence override; 2y horizon enforced at write + read time); D-56..D-57b conflict detection (per-participant overlap, soft warning only, cross-scope detection via SECURITY DEFINER bypass + role-gated detail-redaction uniform across all 6 types, participant-named copy override); D-58..D-58c delete model (hard delete + AlertDialog + audit-log JSONB snapshot; three distinct operations: globaal verwijderen / Ik kan niet aanwezig zijn / cancel single occurrence; UI-SPEC delete copy override drops 30-day restore promise).

Resume: `/clear` then `/gsd-plan-phase 3` (plan with UI-SPEC + CONTEXT as design + implementation context).
Artifacts: `.planning/phases/03-kalender/03-UI-SPEC.md` (875 lines, approved 2026-05-13); `03-CONTEXT.md` (~360 lines, gathered 2026-05-14); `03-DISCUSSION-LOG.md` (audit trail).

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** Every player's complete development picture is visible in one place, accessible by the right people, and actionable in daily sports operations.
**Current focus:** Phase 3 — Kalender (next)

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Fundament | ✅ Complete (18/18 plans, 1 code-review fix cycle, verifier human_needed deferred to UAT) |
| 2 | Identiteit & Bestanden | ✅ Complete (16/16 plans + verifier gap-closure; live on Supabase eu-west-1; 4 UAT items deferred) |
| 3 | Kalender | ◆ UI-SPEC approved + CONTEXT gathered (awaiting planning) |
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
