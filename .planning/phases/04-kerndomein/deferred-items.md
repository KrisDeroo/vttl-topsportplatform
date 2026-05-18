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

## Pre-existing build failure discovered during Plan 04-08 execution (out of scope)

Running `pnpm build` (Next.js production build) on the worktree's base commit
`2cea984` fails with a `typedRoutes` TypeScript error in
`src/app/[locale]/(app)/admin/users/page.tsx:56` — `redirect(`/${locale}/login`)`
fails because Next.js 15's `typedRoutes: true` no longer accepts dynamically-
constructed route strings (it expects literal routes registered in the route tree).

**Verified pre-existing**: same error appears running `pnpm build` in the parent
worktree at commit `2cea984` (the base of this worktree). Plan 04-08 introduces
several `redirect(`/${locale}/...`)` calls in new routes (dashboard, tournaments,
players/[id]/rankings, etc.) following the same idiom Phase 1 used — these will
also fail if `typedRoutes` linting is enabled on top of TS strict.

Resolution path (not done here per scope-boundary rule):
1. Either cast as `Route` from `next` in each redirect call site (per-file fix), OR
2. Set `typedRoutes: false` in `next.config.ts` (single-line workspace-wide fix), OR
3. Use `redirect(`/${locale}/login` as never)` / `as any` cast at each call.

The Plan 04-08 deliverables compile cleanly under `pnpm typecheck` (which runs
`tsc --noEmit` without the Next.js typedRoutes lint layer); the build-time
failure is a downstream tooling concern that predates this plan and affects all
locale-prefixed redirects in the codebase.
