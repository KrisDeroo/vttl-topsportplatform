# Phase 4 — Deferred items found during execution


## Pre-existing test failures discovered during Plan 04-01 execution (out of scope)

These tests were already failing before Plan 04-01 changes — they are NOT caused
by Wave 0 RED scaffolding work. Logged here for tracking; not fixed because they
fall outside Plan 04-01's scope per execute-plan SCOPE BOUNDARY rule.

| Test file | Failure summary |
|-----------|-----------------|
| `tests/unit/lookup-codes.test.ts` | 9 of 12 fail — `Symbol.for('drizzle:Columns')` accessor returns undefined; pre-existing Drizzle API drift |
| `tests/unit/magic-bytes.test.ts` | 2 fail — magic-bytes validator API drift on PNG/PDF sniff (assertion shape changed) |
| `tests/unit/medical-schema.test.ts` | 3 fail — same Drizzle column-accessor issue as lookup-codes |
| `tests/unit/player-schemas.test.ts` | 1 fail — Zod i18n key emission mismatch (`errors.field.required`) |
| `tests/unit/timestamps.test.ts` | 1 fail — `tstz` helper return shape mismatch with `mode: 'date'` |
| `tests/unit/trainer-schemas.test.ts` | 2 fail — D-37 field whitelist + i18n key emission mismatch |
| `tests/unit/worker-template.test.ts` | 7 fail — BullMQ queue config + `processConsentVersionBump` idempotency return shape mismatch |

Verified on parent worktree commit `b6d56ce` (Phase 4 planning baseline) — all
of the above also fail there. The Phase 4 RED tests added in Plan 04-01 are the
INTENDED new failures and are NOT listed here.
