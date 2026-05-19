---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
last_updated: "2026-05-19T09:34:12.999Z"
progress:
  total_phases: 8
  completed_phases: 3
  total_plans: 58
  completed_plans: 51
  percent: 88
---

# Project State — VTTL Topsportplatform

## Current Status

Phase: 4
Active Phase: 04-kerndomein (CONTEXT.md captures 4-area implementation discussion; ready for planning)
Last Action: Phase 4 CONTEXT.md committed (2026-05-15, hash f5e6b56). Captures 31 decisions across 4 areas: D-60..D-68 quality score model (1–10 stored / 5-star v1, staff+player+parent visibility, single combined form, 14d absolute wall with no TD override, all-channel intrusive in-app nudging, TD cross-trainer overview); D-69..D-81 tournament results (final ranking + ≥1 match BOTH mandatory atomic entry, 14d player window + asymmetric trainer/TD anytime backfill, TD unconditional overwrite, no edit-history table, no lifecycle, academy-wide visibility for leaderboard energy, TD-only tournament creation+participant registration, add-row-as-needed match entry, set-tally scoring); D-82..D-85 recurring-edit (occurrence_date schema correction on session_participants, past data immutable, all three edit scopes ship, BYDAY only); D-86..D-91 rankings (RISK-02 resolved with completely new model — Belgium hierarchical classification system requires split-column schema value_numeric NULL + value_classification_code NULL with new belgium_classification lookup; annual timeline strip widget for Belgium vs line chart for international; per-type chart with selector; literal RANK-06 for all types; 24-month default range; Rankings tab only with Phase 7 owning dashboard widget).

REQUIREMENTS.md amendments flagged for planner: DOM-RESULT-01 SUPERSEDED (no 48h sub-clock), DOM-RESULT-03 SUPERSEDED (no edit-history table; audit_log is source of truth), DOM-RESULT-04 SUPERSEDED (no draft/confirmed/published lifecycle), TOURN-04 partially superseded (gewonnen/verloren toggle → derived), RANK-01 amended (Belgium ranking is classification, not rangwaarde numeric), RANK-03 partially amended, RISK-02 resolved with new model.

Resume: `/clear` then `/gsd-plan-phase 4` (plan with CONTEXT.md as implementation context).
Artifacts: `.planning/phases/04-kerndomein/04-CONTEXT.md` (gathered 2026-05-15, 31 decisions, 7 REQ amendments); `04-DISCUSSION-LOG.md` (audit trail of alternatives considered).

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** Every player's complete development picture is visible in one place, accessible by the right people, and actionable in daily sports operations.
**Current focus:** Phase 04 — kerndomein

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Fundament | ✅ Complete (18/18 plans, 1 code-review fix cycle, verifier human_needed deferred to UAT) |
| 2 | Identiteit & Bestanden | ✅ Complete (16/16 plans + verifier gap-closure; live on Supabase eu-west-1; 4 UAT items deferred) |
| 3 | Kalender | ✅ Complete (8/8 plans + post-review fix cycle, executed 2026-05-15) |
| 4 | Kerndomein | ◆ CONTEXT gathered (awaiting planning) |
| 5 | Uitgebreid domein | ⬜ Not started |
| 6 | Communicatie | ⬜ Not started |
| 7 | Synthese | ⬜ Not started |
| 8 | Kwaliteit & Release | ⬜ Not started |

## Open Questions

- RISK-01: Medical scan uploads in v1 — include or defer? (scope-spanning: deferred in physical section, required in medical section of brief)
- ~~RISK-02: Ranking direction for Belgium Ranking — confirm whether lower or higher value = better~~ ✅ **RESOLVED 2026-05-15** by Phase 4 D-86/D-87: Belgium ranking is a hierarchical classification system (A1..A_n / B0..B6 / C0..C6 / D0..D6 / E0..E6 / NC), not a numeric ranking — fundamentally different shape than international rankings. New `belgium_classification` lookup; split-column `ranking_entries` schema; distinct timeline-strip chart widget.

## Key Constraints

- Three-language UI: nl (default) / en / fr — full infrastructure built in Phase 1
- GDPR: medical data = Art. 9 special category; Belgian minor consent threshold = 16; consent text versioned per locale
- All data residency in EU (Supabase Pro Frankfurt + Hetzner; Resend EU-region; Sentry EU; Upstash EU)
- Calendar week view (Outlook-style) mandatory for v1
- Lookups: codes in DB, labels via i18n catalogs; proper nouns not translated

---
*Last updated: 2026-05-02 — Wave 1 complete (Next.js bootstrap + wave-0 RED test scaffolding); Wave 2 next.*
