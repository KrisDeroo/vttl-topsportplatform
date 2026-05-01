---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-05-01T12:00:00.000Z"
---

# Project State — VTTL Topsportplatform

## Current Status

Phase: 1 — Fundament
Active Phase: 01-fundament
Last Action: Phase 1 context gathered — 20 implementation decisions captured across 6 gray areas

Resume: `.planning/phases/01-fundament/01-CONTEXT.md`

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** Every player's complete development picture is visible in one place, accessible by the right people, and actionable in daily sports operations.
**Current focus:** Phase 1 — Fundament

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Fundament | 🔄 Context gathered (ready to plan) |
| 2 | Identiteit & Bestanden | ⬜ Not started |
| 3 | Kalender | ⬜ Not started |
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
- All data residency in EU (Supabase Pro Frankfurt + Hetzner; Mailgun/SendGrid EU; Sentry EU)
- Calendar week view (Outlook-style) mandatory for v1
- Lookups: codes in DB, labels via i18n catalogs; proper nouns not translated

---
*Last updated: 2026-05-01 after initialization*
