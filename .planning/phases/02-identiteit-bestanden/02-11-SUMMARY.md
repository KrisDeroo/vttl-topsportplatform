---
phase: 02-identiteit-bestanden
plan: 11
subsystem: i18n
tags: [next-intl, json-catalog, lookup-labels, proper-noun-rule, gdpr-multilingual]

requires:
  - phase: 01-fundament
    provides: "next-intl Phase 1 catalog (auth/consent/common/nav/errors/admin/lookups baseline) + drietalig (nl/en/fr) fail-loud fallback"
provides:
  - "messages/nl.json with 190 scalar leaves (was 105) — +85 keys for Phase 2 surfaces"
  - "messages/en.json with 190 scalar leaves (was 105) — at parity with nl"
  - "messages/fr.json with 190 scalar leaves (was 105) — at parity with nl"
  - "players.*, trainers.*, me.*, files.* top-level namespaces"
  - "lookups.academy extended with 4 new academy codes (academy_brussel, academy_oost_vlaanderen, academy_west_vlaanderen, academy_limburg)"
  - "lookups.ageCategory (7 codes) and lookups.trainerDiploma (5 codes)"
  - "errors.field.* (7 keys) and errors.file.* (7 keys) for Zod-i18n adapter"
  - "players.fields.gender.{label,male,female,x} per WARNING-05 post-planning fix"
  - "docs/i18n-conventions.md — single reference for proper-noun rule, lookup resolver, Zod-i18n adapter, completeness rule, forbidden patterns"
affects:
  - 02-09-trpc-router-file
  - 02-10-trpc-routers-player-trainer
  - 02-13-ui-pages-and-forms
  - 02-12-ui-shared-components
  - 02-15-tests
  - phase-3-kalender
  - phase-8-kwaliteit (I18N-10 CI parity gate)

tech-stack:
  added: []
  patterns:
    - "Proper-noun rule D-45: academy/club/person canonical names duplicated VERBATIM across nl/en/fr (no translation)"
    - "Lookup-label resolver pattern D-44: language-neutral codes in DB (status_a, age_pre_minor), labels via useTranslations('lookups.X')"
    - "Zod error message → i18n key pattern D-46/I18N-08: schemas emit 'errors.field.foo' strings, client adapter resolves"
    - "Catalog completeness rule: every key MUST exist in all 3 catalogs; missing keys fail loud as MISSING_KEY:<locale>.<path> (D-20)"

key-files:
  created:
    - "docs/i18n-conventions.md"
  modified:
    - "messages/nl.json"
    - "messages/en.json"
    - "messages/fr.json"

key-decisions:
  - "Kept the PLURAL 'lookups' root (Phase 1 baseline) — UI-SPEC line 271 reconciliation explicitly retains plural; no rename to 'lookup'"
  - "Added players.fields.gender.{label,male,female,x} to all 3 catalogs (WARNING-05 post-planning fix) — surfaced as plan addendum, executed verbatim with nl=Geslacht/Man/Vrouw/X, en=Gender/Male/Female/X, fr=Genre/Homme/Femme/X"
  - "Academy proper-noun canonical names appear identically in all 3 catalogs (Topsportschool, Academy Antwerpen, Academy Brussel, Academy Oost-Vlaanderen, Academy West-Vlaanderen, Academy Limburg) — D-45 enforced by inline jq parity check"
  - "errors.field.* and errors.file.* placed inside the existing 'errors' object (alongside Phase 1's generic/forbidden/notFound/validationFailed/csrfRejected) rather than as a new top-level namespace — preserves Phase 1 catalog shape"

patterns-established:
  - "Catalog top-level layout: auth, consent, lookups, common, nav, errors, admin, players, trainers, me, files (additive evolution)"
  - "Lookup sub-namespaces stay PLURAL ('lookups' root) — future phases extend `lookups.<categoryCamelCase>` (e.g., lookups.medicalDiagnosis, lookups.evaluationCriterion)"
  - "Error sub-namespaces use flat lowercased domain: errors.field.* (form validation), errors.file.* (uploads)"

requirements-completed:
  - I18N-06
  - I18N-08
  - PLAYER-05
  - PLAYER-07
  - TRAINER-01

duration: 8min
completed: 2026-05-13
---

# Phase 02 Plan 11: i18n Catalog Additions Summary

**Three drietalig (nl/en/fr) message catalogs extended from 105 to 190 scalar leaves each, in lock-step parity, with proper-noun-canonical academy names and a dedicated docs/i18n-conventions.md anchoring the D-44/D-45/D-46 patterns for downstream Phase 2 + Phase 8 CI consumers.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-13T11:27:38Z
- **Completed:** 2026-05-13T11:35:36Z
- **Tasks:** 4
- **Files modified:** 3 (messages/nl.json, messages/en.json, messages/fr.json)
- **Files created:** 1 (docs/i18n-conventions.md)

## Accomplishments

- Added 85 new scalar-leaf i18n keys per catalog (nl/en/fr), covering Phase 2 UI surfaces: player list/create/detail/edit/sections/fields/ageCategoryChange; trainer list/create/detail/edit; me.profile.title; files.photo.* dropzone/scan/actions/toast/deleteConfirm/errors
- Extended `lookups.academy` from 2 to 6 entries — added academy_brussel, academy_oost_vlaanderen, academy_west_vlaanderen, academy_limburg with canonical proper-noun values verbatim across all 3 catalogs (D-45)
- Added `lookups.ageCategory` (7 entries: age_pre_minor through age_unknown) with localized labels (nl=Preminiemen…, en=Pre-minors…, fr=Préminimes…)
- Added `lookups.trainerDiploma` (5 entries: diploma_none, diploma_a, diploma_b, diploma_a_in_training, diploma_b_in_training) with localized labels
- Added `errors.field.*` (7 keys) and `errors.file.*` (7 keys) for the Zod-i18n adapter (I18N-08, D-46)
- Honored WARNING-05 post-planning fix: `players.fields.gender.{label,male,female,x}` added in all 3 locales (Geslacht/Man/Vrouw/X · Gender/Male/Female/X · Genre/Homme/Femme/X)
- Verified key-set parity across all 3 catalogs: 190 scalar-leaf paths each, identical sorted path lists (`diff` clean)
- Verified proper-noun parity (D-45): all 6 academy canonical names identical across nl/en/fr via inline jq checks
- Documented the i18n contract for future contributors in docs/i18n-conventions.md: proper-noun rule, lookup-label resolver, Zod-i18n adapter, completeness rule, forbidden patterns

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend messages/nl.json with all Phase 2 keys** — `9cf3314` (feat)
2. **Task 2: Extend messages/en.json with parity** — `97bc013` (feat)
3. **Task 3: Extend messages/fr.json with parity** — `01cd917` (feat)
4. **Task 4: Create docs/i18n-conventions.md** — `8643816` (docs)

## Files Created/Modified

- `messages/nl.json` — +155 lines / -2 (Phase 1 keys preserved, new namespaces appended after `admin`, lookup + errors extended in place)
- `messages/en.json` — +155 lines / -2 (mirror nl structure, English copy from UI-SPEC §Copywriting Contract)
- `messages/fr.json` — +155 lines / -2 (mirror nl structure, French copy from UI-SPEC §Copywriting Contract, academy proper-nouns verbatim)
- `docs/i18n-conventions.md` — 85 lines (proper-noun rule, lookup resolver, Zod-i18n adapter, completeness, what-NOT-to-do)

## Verification Results

| Check | Command | Result |
|---|---|---|
| nl.json structural | `jq -e '.players.list.title == "Spelers" and …'` | PASS |
| en.json structural | `jq -e '.players.list.title == "Players" and …'` | PASS |
| fr.json structural | `jq -e '.players.list.title == "Joueurs" and …'` | PASS |
| All 3 valid JSON | `jq . messages/{nl,en,fr}.json` | PASS |
| Key parity | `diff <(jq paths→sort nl) <(... en) <(... fr)` | PASS — 190 paths each, identical sets |
| Proper-noun D-45 | jq each catalog: `lookups.academy.{6 codes}` equal canonical | PASS — all 6 academies identical across nl/en/fr |
| Gender keys parity | `players.fields.gender.{label,male,female,x}` present in nl/en/fr | PASS — Geslacht/Man/Vrouw/X · Gender/Male/Female/X · Genre/Homme/Femme/X |
| Docs anchors | grep I18N-06, I18N-08, D-45, D-46, display_name_nl | PASS — all 5 tokens present |

## Decisions Made

- **Plural `lookups` root retained.** Phase 1 used `lookups.<category>`; UI-SPEC line 271 explicitly reconciles the plural-vs-singular question by keeping plural. No mass rename performed.
- **`players.fields.gender.*` added in all 3 catalogs** per the WARNING-05 post-planning fix surfaced in the executor prompt. Values chosen as the standard short-form FR/NL/EN labels (no neutral "Homme/Femme" debate raised in research).
- **`errors.field` and `errors.file` placed under the existing `errors` namespace** (alongside Phase 1's generic/forbidden/notFound) rather than as new top-level namespaces — preserves Phase 1 catalog top-level shape and matches I18N-08's flat `errors.<domain>.<code>` convention.

## Deviations from Plan

None — plan executed exactly as written. The only addition (gender keys) was a planned post-planning amendment surfaced in the executor prompt, not a Rule 1-3 auto-fix.

**Note on accidental side-effect during execution:** The first Write of nl.json went to the main worktree's `/Users/kris/Documents/Claude Code/VTTL Topsport/messages/nl.json` (parent of the worktree) before being redirected to the correct worktree path. The accidental change to the main worktree's working tree file was reverted to its committed baseline before any commits were made; no git history was affected and no commit was ever made in the wrong location. The correct worktree file is what was committed in `9cf3314`.

## Issues Encountered

- **Wrong working-tree path on first write.** The Write tool resolves absolute paths and I initially used the canonical project path instead of the agent worktree path. Caught immediately by the Task 1 jq verification (returned `null` for `.players.list.title`). Fix: re-wrote to the correct worktree path and restored the main worktree file to its committed baseline. No data lost, no commits affected.
- **Bash sandboxing limitations.** Several verification commands using `python3 -c` heredocs and `cd /tmp` redirects were denied by the sandbox. Worked around by using `jq -e` with compound predicates and writing temp diff files into the worktree's own `.tmp-check/` directory (then deleting it before commit).

## User Setup Required

None — no external service configuration required. Catalogs are static JSON files loaded by `next-intl` from the existing Phase 1 i18n infrastructure.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: missing_key | messages/{nl,en,fr}.json | Phase 8 CI gate (I18N-10) must enforce key-set parity across all 3 catalogs; Phase 2 unit test (planned in 02-15) should assert this in pre-commit. |
| threat_flag: proper_noun_drift | messages/{nl,en,fr}.json (`lookups.academy.*`) | A future contributor could accidentally translate an academy name in fr.json. Phase 8 CI should add a `lookups.academy.*` parity assertion (already in the verify block of this plan as a one-shot guard). |

## Known Stubs

None. All keys are populated with their final UI-SPEC strings. The 4 new academy canonical names (`academy_brussel`, `academy_oost_vlaanderen`, `academy_west_vlaanderen`, `academy_limburg`) are placeholders pending Technical Director confirmation per RESEARCH A1 — this is documented in the threat register (T-02-11-WRONG-CANONICAL-NAME: accept). If TD confirms different names, an UPDATE migration + a verbatim catalog update will replace them in all 3 catalogs simultaneously.

## Next Phase Readiness

- All Phase 2 UI plans (02-12 ui-shared-components, 02-13 ui-pages-and-forms) can now consume `players.*`, `trainers.*`, `files.*`, `me.*` keys via `useTranslations()` / `getTranslations()`.
- All Phase 2 tRPC schema plans (already merged in base — 02-07) can resolve `errors.field.*` and `errors.file.*` keys through the Zod-i18n adapter pattern documented in docs/i18n-conventions.md.
- Phase 2 seed plan (02-08 migration-0008-lookup-seed, sibling wave) can rely on the lookup codes being i18n-resolvable for `academy`, `ageCategory`, `trainerDiploma` lookups.
- Phase 8 (Kwaliteit & Release) inherits two concrete CI tasks:
  1. Catalog key-parity assertion (I18N-10 gate)
  2. `lookups.academy.*` proper-noun parity assertion (D-45 enforcement)

## Self-Check: PASSED

- `messages/nl.json` — FOUND, 190 scalar leaves, valid JSON
- `messages/en.json` — FOUND, 190 scalar leaves, valid JSON
- `messages/fr.json` — FOUND, 190 scalar leaves, valid JSON
- `docs/i18n-conventions.md` — FOUND, all 5 required tokens (I18N-06, I18N-08, D-45, D-46, display_name_nl) present
- Commit `9cf3314` (Task 1: nl.json) — FOUND in `git log`
- Commit `97bc013` (Task 2: en.json) — FOUND in `git log`
- Commit `01cd917` (Task 3: fr.json) — FOUND in `git log`
- Commit `8643816` (Task 4: docs) — FOUND in `git log`

---
*Phase: 02-identiteit-bestanden*
*Plan: 02-11-i18n-catalog-additions*
*Completed: 2026-05-13*
