---
phase: 02-identiteit-bestanden
plan: 13
subsystem: ui
tags: [next.js, react, react-hook-form, zod, trpc, shadcn, server-components, rbac, i18n]

# Dependency graph
requires:
  - phase: 02-identiteit-bestanden
    provides: 02-04 zod-i18n adapter; 02-07 Zod input schemas; 02-09 file router; 02-10 player/trainer routers; 02-11 i18n catalog with players./trainers./me./files. namespaces; 02-12 LookupSelect + PhotoUpload + EmptyState
  - phase: 01-fundament
    provides: createContext + appRouter.createCaller pattern (admin/users); shadcn primitives (Form, Card, Dialog, DropdownMenu, etc.); TrpcProvider in (app) layout; locale-aware routing via next-intl
provides:
  - 7 page-level route surfaces (UI-SPEC §Page Surfaces) — /players, /players/new, /players/[id], /trainers, /trainers/new, /trainers/[id], /me/profile
  - 9 component files — 4 player components (list-table, create-form, edit-form, header) + 4 trainer components + 1 dialog (AgeCategoryChangeDialog)
  - Mode-aware PlayerEditForm (5 modes: td/academyManager/self/parent/readOnly)
  - Mode-aware TrainerEditForm (3 modes: td/self/readOnly)
  - ESLint no-restricted-imports rule blocking server-only modules from Client Components
affects: [02-14 (smoke tests will run against these routes), 02-15 (tests exercise these surfaces), 02-16 (deployment docs reference these page paths)]

# Tech tracking
tech-stack:
  added: []  # No new packages — all primitives shipped in 02-12; RHF / zod / lookup / photo widget pre-existing
  patterns:
    - "Server Component → tRPC server caller → Client component with initialData (mirrors Phase 1 UserTable)"
    - "Mode-aware edit form: single Client Component owns 3–5 modes; Server Component decides mode; server enforces real RBAC"
    - "Read-only fields rendered as styled non-interactive divs with aria-disabled=true (NOT disabled inputs)"
    - "Chain mutation pattern for creation: admin.user.create → role.create (player|trainer) — userId from step 1 feeds step 2"
    - "Pre-fetched lookup codes via Drizzle in Server Component → passed as readonly string[] props (no extra tRPC list endpoint for static data)"

key-files:
  created:
    - "src/components/players/player-list-table.tsx — Client table with TD-only setAgeCategory affordance"
    - "src/components/players/player-create-form.tsx — RHF + zod create form; chains admin.user.create + player.create"
    - "src/components/players/player-edit-form.tsx — 5-mode edit form; D-37 self-update path uses playerSelfUpdateInput whitelist"
    - "src/components/players/player-header.tsx — Server Component with 96×96 Avatar + status/minor/readOnly badges"
    - "src/components/players/age-category-change-dialog.tsx — TD-only dialog wired to player.setAgeCategory (D-32)"
    - "src/components/trainers/trainer-list-table.tsx — diploma + pedagogical qual + comma-joined academies"
    - "src/components/trainers/trainer-create-form.tsx — chains admin.user.create + trainer.create; diplomaCode + hasPedagogicalQualification"
    - "src/components/trainers/trainer-edit-form.tsx — 3-mode edit form; D-38 whitelist (no diploma in self path)"
    - "src/components/trainers/trainer-header.tsx — Server Component with diploma Badge"
    - "src/app/[locale]/(app)/players/page.tsx — Server Component list page; redirects role=player to /me/profile"
    - "src/app/[locale]/(app)/players/new/page.tsx — TD-only; pre-fetches academy + status codes"
    - "src/app/[locale]/(app)/players/[id]/page.tsx — resolves mode per UI-SPEC RBAC table; single signed-URL fetch"
    - "src/app/[locale]/(app)/trainers/page.tsx — Server Component list page; joins academy memberships server-side"
    - "src/app/[locale]/(app)/trainers/new/page.tsx — TD-only; pre-fetches diploma codes"
    - "src/app/[locale]/(app)/trainers/[id]/page.tsx — modes td/self/readOnly"
    - "src/app/[locale]/(app)/me/profile/page.tsx — routes to PlayerEditForm or TrainerEditForm based on which row exists"
  modified:
    - "eslint.config.mjs — added no-restricted-imports rule scoped to src/components/**/*.tsx ONLY (BLOCKER-08 fix)"

key-decisions:
  - "Player/Trainer creation forms chain two mutations (admin.user.create then player|trainer.create) rather than introducing a combined endpoint, keeping the Phase 1 admin.user.create surface canonical"
  - "Lookup codes (academy/status/ageCategory/trainerDiploma) are pre-fetched in the Server Component via Drizzle and passed as readonly string[] props — no extra tRPC list endpoints for static data (smaller client bundle)"
  - "Avatar signed-URL fetch deferred from list rows to detail page (T-02-13-AVATAR-N+1 mitigation) — initials-only avatars in lists"
  - "ESLint no-restricted-imports rule scoped to src/components/**/*.tsx ONLY (BLOCKER-08); src/app/**/*.tsx contains Server Components that legitimately import @/server/storage/* for signed-URL minting"

patterns-established:
  - "Server Component → tRPC server caller → Client component with initialData (mirrors Phase 1's UserTable)"
  - "Mode prop on edit forms — Server Component owns the decision based on session.role + scope; Client form respects it; server enforces real RBAC via Zod-schema whitelist + RLS UPDATE policy"
  - "Read-only fields rendered as styled non-interactive divs (UI-SPEC line 208 — NOT disabled inputs which some screen readers refuse to read)"

requirements-completed:
  - PLAYER-01
  - PLAYER-02
  - PLAYER-05
  - PLAYER-06
  - PLAYER-07
  - TRAINER-01
  - TRAINER-02
  - TRAINER-03
  - I18N-06
  - I18N-08

# Metrics
duration: 17min
completed: 2026-05-13
---

# Phase 2 Plan 13: UI Pages and Forms Summary

**Shipped 7 page-level route surfaces and 9 component files (4 player + 4 trainer + 1 dialog) — Server Components prefetch via tRPC server caller, Client forms compose RHF + zod + LookupSelect + PhotoUpload; mode-aware edit forms enforce field-level RBAC at the UI layer, with the real RBAC enforced by Zod schema whitelists and RLS UPDATE policies server-side.**

## Performance

- **Duration:** ~17 min (1778674812 → 1778675803 epoch)
- **Started:** 2026-05-13T12:20:12Z
- **Completed:** 2026-05-13T12:36:43Z
- **Tasks:** 5/5
- **Files created/modified:** 17 (16 created + 1 modified)

## Accomplishments

- **7 page surfaces routable** in Next.js App Router (/players, /players/new, /players/[id], /trainers, /trainers/new, /trainers/[id], /me/profile) — all Server Components, all using Phase 1's `createContext()` + `appRouter.createCaller(ctx)` pattern (BLOCKER-03 honoured).
- **9 component files compile** under strict TypeScript + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`. `npx tsc --noEmit` exits 0.
- **PlayerEditForm supports 5 modes** (`td` | `academyManager` | `self` | `parent` | `readOnly`) from a single Client Component; the Server Component decides the mode based on `session.role + scope.linkedPlayerIds + isOwnRow`. D-37 self-update path is structurally narrower (uses `playerSelfUpdateInput`) so a malicious client cannot smuggle sensitive fields.
- **TrainerEditForm supports 3 modes** (`td` | `self` | `readOnly`) with the same pattern. D-38 self-update path omits `diplomaCode` + `hasPedagogicalQualification` (TD-only fields).
- **AgeCategoryChangeDialog** wraps shadcn Dialog and calls `trpc.player.setAgeCategory` (D-32 — SERIALIZABLE transaction handles the history-row bookkeeping server-side).
- **ESLint defense in depth** — `no-restricted-imports` rule scoped to `src/components/**/*.tsx` only blocks `@/server/storage/*`, `@/server/workers/*`, `@/server/db/client` (Pitfall 4 second layer; `'server-only'` directive remains the absolute backstop).

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the 4 player components (list-table, create-form, edit-form, header)** — `a7b5014` (feat)
2. **Task 2: Build AgeCategoryChangeDialog** — `b97e2d5` (feat)
3. **Task 3: Build the 4 trainer components** — `c54b242` (feat)
4. **Task 4: Build 7 page files (Server Components)** — `8bc911d` (feat)
5. **Task 5: Add ESLint restricted-imports rule** — `4ad5fcd` (feat)

## Files Created

| Path | Role | Server/Client |
|------|------|---------------|
| `src/components/players/player-list-table.tsx` | DataTable for /players; hydrates tRPC initialData; TD-only setAgeCategory affordance | Client |
| `src/components/players/player-create-form.tsx` | RHF + zod create form; 5 Card sections (Identity/Sport/Address/Emergency/Photo); chains admin.user.create + player.create | Client |
| `src/components/players/player-edit-form.tsx` | 5-mode unified edit form; D-37 self-update via playerSelfUpdateInput whitelist; read-only divs (NOT disabled inputs) | Client |
| `src/components/players/player-header.tsx` | 96×96 Avatar + H1 + status/minor/readOnly badges + locale-aware back link | Server |
| `src/components/players/age-category-change-dialog.tsx` | TD-only Dialog wrapping LookupSelect + Calendar + Input; calls player.setAgeCategory | Client |
| `src/components/trainers/trainer-list-table.tsx` | DataTable for /trainers; columns include diploma + pedagogical qual + comma-joined academies | Client |
| `src/components/trainers/trainer-create-form.tsx` | RHF + zod; Qualifications section with LookupSelect (trainerDiploma) + Checkbox | Client |
| `src/components/trainers/trainer-edit-form.tsx` | 3-mode edit form; D-38 whitelist (diplomaCode + pedagogicalQualification are TD-only) | Client |
| `src/components/trainers/trainer-header.tsx` | 96×96 Avatar + diploma Badge + locale-aware back link | Server |
| `src/app/[locale]/(app)/players/page.tsx` | List page; redirects role=player to /me/profile; pre-fetches age category codes | Server |
| `src/app/[locale]/(app)/players/new/page.tsx` | TD-only create page; pre-fetches academy + status codes | Server |
| `src/app/[locale]/(app)/players/[id]/page.tsx` | Detail page; resolves mode from session.role + linkedPlayerIds + isOwnRow; mints signed URL for avatar | Server |
| `src/app/[locale]/(app)/trainers/page.tsx` | List page; joins academy_memberships server-side | Server |
| `src/app/[locale]/(app)/trainers/new/page.tsx` | TD-only create page; pre-fetches diploma codes | Server |
| `src/app/[locale]/(app)/trainers/[id]/page.tsx` | Detail page; mode mapping td/self/readOnly | Server |
| `src/app/[locale]/(app)/me/profile/page.tsx` | Routes to PlayerEditForm or TrainerEditForm based on which row exists | Server |

## Files Modified

| Path | Change |
|------|--------|
| `eslint.config.mjs` | Appended a flat-config block scoped to `src/components/**/*.tsx` blocking `@/server/storage/*`, `@/server/workers/*`, `@/server/db/client` imports (BLOCKER-08 — `src/app/**` deliberately excluded) |

## Mode Surface (Edit Forms)

### PlayerEditForm modes (5)

| Mode | Mutation | Field set | Header |
|------|----------|-----------|--------|
| `td` | `player.updateAsTd` | full (`playerUpdateAsTdInput`) | normal |
| `academyManager` | `player.updateAsTd` (RLS narrows scope) | full | normal |
| `self` | `player.updateSelf` | D-37 whitelist (`playerSelfUpdateInput`) | normal; identity + sport rendered read-only |
| `parent` | `player.updateOnBehalfOf` | D-37 whitelist + `playerId` (link-verified server-side) | normal; identity + sport rendered read-only |
| `readOnly` | none | every field as styled non-interactive div | "Alleen-lezen" Badge |

### TrainerEditForm modes (3)

| Mode | Mutation | Field set | Header |
|------|----------|-----------|--------|
| `td` | `trainer.updateAsTd` | full (`trainerUpdateAsTdInput`) | normal |
| `self` | `trainer.updateSelf` | D-38 whitelist (`trainerSelfUpdateInput` — no diplomaCode, no hasPedagogicalQualification) | normal; identity + qualifications rendered read-only |
| `readOnly` | none | every field as styled non-interactive div | "Alleen-lezen" Badge |

## Decisions Made

1. **Two-mutation chain for creation** — `PlayerCreateForm` and `TrainerCreateForm` call `admin.user.create` first to obtain the `userId`, then call `player.create` / `trainer.create` with that id. Rationale: the Zod input schema (02-07) requires `userId: uuid`, and Phase 1's `admin.user.create` is the canonical write-path for the users row + audit_log. If step 2 fails after step 1 succeeds, the users row remains `active=false` and the Phase 1 TD admin UI can resolve it; preferable to a hand-rolled compensating delete.
2. **Pre-fetched lookups via Drizzle** — academy/status/age-category/trainer-diploma codes are read in the Server Component (not via tRPC) and passed as `readonly string[]` props. Smaller client bundle, no extra API endpoint for static data, and Drizzle reads are public-readable per 02-05 RLS.
3. **N+1 avatar mitigation** — list rows render initials-only avatars (T-02-13-AVATAR-N+1). Detail pages mint a single signed URL via `trpc.file.getSignedUrl`. Phase 7 may widen the procedure for a batched read; for now this stays under the UI-SPEC 100-row latency budget.
4. **ESLint scope `src/components/**/*.tsx` ONLY** — BLOCKER-08 — `src/app/**/*.tsx` contains Phase 1 + Plan 02-13 Server Components that legitimately import `@/server/storage/*` and `@/server/db/client` for server-side prefetch and signed-URL minting. Scoping to `src/components/**` keeps the lint rule precise.

## Deviations from Plan

None — the plan executed exactly as written, with one minor extension worth documenting:

- **Plan ambiguity around `playerCreateInput.userId`** — the plan said "On submit: call `trpc.player.create.useMutation().mutateAsync(form.getValues())`" but `playerCreateInput` requires `userId: uuid`. Resolved by chaining `admin.user.create` first (idiomatic Phase 1 path). Same pattern for the trainer form. Documented as Decision 1 above. Not a deviation in the Rule-1..4 sense — just a design choice the plan left open.

**Total deviations:** 0 auto-fixed
**Impact on plan:** None — plan executed as written. The two-mutation chain is an implementation detail of how the form satisfies the `userId: uuid` requirement; it does not introduce new schemas or change the RBAC model.

## Issues Encountered

- **ESLint runtime cannot validate the rule end-to-end** — `npx eslint src/components/` fails with `TypeError: Converting circular structure to JSON` (pre-existing environment issue: ESLint 10.3.0 + `@eslint/eslintrc 3.3.5` + Next.js 15's FlatCompat shim). The rule is structurally correct (verified via `grep` against the plan's verification regex); the runtime error is not a regression from this plan. Per the parallel-execution environment note ("infrastructure constraints, not regressions you need to fix"), this is logged but not fixed in scope.
- **i18n catalog gaps** — Several keys referenced by the forms (e.g., `players.fields.firstName`, `players.fields.dateOfBirth.placeholder`, `players.list.columns.name`, `trainers.fields.diplomaCode.placeholder`) are not yet present in `messages/{nl,en,fr}.json`. The Phase 2 fail-loud fallback (D-20) renders `MISSING_KEY:nl.players.fields.firstName` in dev so the gaps are visually obvious. The plan frontmatter (`files_modified`) does NOT include the messages catalogs — those are owned by plan 02-11. Filing this as a follow-up gap for plan 02-11 (or its successor 02-15 tests) rather than smuggling keys into the catalog from this plan. The components themselves are i18n-correct (no hardcoded labels, all keys flow through `useTranslations`).

## Phase Impact

This plan unblocks:
- **02-14 (blocking-schema-push)** — schema push verification runs against a Next.js dev server; the pages here are routable for smoke tests.
- **02-15 (tests)** — Phase 2 tests can exercise these route surfaces via Playwright / vitest-component.
- **02-16 (deployment-docs)** — deployment runbook references the route inventory.
- Phase 3 (Trainingsplanning) builds on the `/players/[id]` profile container as the entry point for training assignment flows.

## Self-Check: PASSED

**Files verified to exist:**
- `src/components/players/player-list-table.tsx` — FOUND
- `src/components/players/player-create-form.tsx` — FOUND
- `src/components/players/player-edit-form.tsx` — FOUND
- `src/components/players/player-header.tsx` — FOUND
- `src/components/players/age-category-change-dialog.tsx` — FOUND
- `src/components/trainers/trainer-list-table.tsx` — FOUND
- `src/components/trainers/trainer-create-form.tsx` — FOUND
- `src/components/trainers/trainer-edit-form.tsx` — FOUND
- `src/components/trainers/trainer-header.tsx` — FOUND
- `src/app/[locale]/(app)/players/page.tsx` — FOUND
- `src/app/[locale]/(app)/players/new/page.tsx` — FOUND
- `src/app/[locale]/(app)/players/[id]/page.tsx` — FOUND
- `src/app/[locale]/(app)/trainers/page.tsx` — FOUND
- `src/app/[locale]/(app)/trainers/new/page.tsx` — FOUND
- `src/app/[locale]/(app)/trainers/[id]/page.tsx` — FOUND
- `src/app/[locale]/(app)/me/profile/page.tsx` — FOUND
- `eslint.config.mjs` — MODIFIED (rule appended; verified via `grep`)

**Commits verified in git log:**
- `a7b5014` (Task 1 — player components) — FOUND
- `b97e2d5` (Task 2 — AgeCategoryChangeDialog) — FOUND
- `c54b242` (Task 3 — trainer components) — FOUND
- `8bc911d` (Task 4 — 7 page files) — FOUND
- `4ad5fcd` (Task 5 — ESLint rule) — FOUND

**Plan invariants (BLOCKER-03 / BLOCKER-08 / WARNING-11):**
- 0 imports from `@/lib/trpc-server` anywhere — VERIFIED (only a comment reference)
- ESLint rule scope is `src/components/**/*.tsx` ONLY (no `src/app/**`) — VERIFIED
- All redirects locale-aware (`/${locale}/...`) — VERIFIED
- `npx tsc --noEmit` exits 0 — VERIFIED
