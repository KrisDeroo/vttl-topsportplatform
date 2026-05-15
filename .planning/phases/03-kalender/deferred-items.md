# Phase 3 Deferred Items

Out-of-scope discoveries logged during execution — NOT fixed here (per Rule
4 / scope-boundary discipline). Listed for follow-up planning, typically
as a Phase 8 quality/release hardening task or a one-off `/gsd-quick`.

---

## 03-01 — Wave 0 RED scaffolding

### DI-01: Pre-existing failures in `tests/unit/lookup-codes.test.ts`

- **Found during:** 03-01 Task 2 verification (running `pnpm test --run` over
  the Wave 0 file set).
- **Source:** Phase 1 — file shipped in commit-of-record before any Phase 3
  work. Confirmed by checking out `tests/unit/lookup-codes.test.ts` at the
  Phase 3 base commit (`9c93689`) — 9 of 9 assertions in the existing
  `describe('lookup tables — I18N-05')` block already fail with:

  ```
  TypeError: Cannot read properties of undefined (reading 'columns')
   ❯ cols tests/unit/lookup-codes.test.ts:36:63
       return tbl[Symbol.for('drizzle:Columns')]?.columns ?? tbl._.columns;
  ```

  The `cols()` helper assumes Drizzle exposes table columns via either the
  symbol-keyed `Symbol.for('drizzle:Columns')` or the underscore-prefixed
  `_.columns` accessor. Both lookups now resolve to `undefined` against the
  current Drizzle 0.45 API. Likely root cause: Drizzle changed its internal
  table-metadata layout between 0.40 → 0.45.

- **Scope verdict:** Out of scope for Plan 03-01. This is a Phase 1 test
  infrastructure regression, not introduced by FullCalendar or RRULE.
  Fixing it requires either (a) inspecting the Drizzle 0.45 internal API
  to find the new column accessor, or (b) rewriting the assertion to use
  a runtime SQL probe instead of static schema metadata. Both are
  architectural choices that belong to a Phase 1/Phase 8 housekeeping
  pass, not to Wave 0 calendar scaffolding.

- **Impact on Wave 0:** None. My added describe block (`Phase 3 — event_type
  lookup`) passes (1 pass, 2 todo). The pre-existing block continues to
  fail with the same 9 TypeErrors as before.

- **Suggested resolution path:**
  1. Open a Phase 8 quality-pass plan or `/gsd-quick` ticket titled "fix
     lookup-codes static-metadata helper".
  2. Replace the `cols()` helper with `getTableColumns(table)` from
     `drizzle-orm` (the documented API for column introspection on
     Drizzle 0.40+).
  3. Re-run `pnpm test -- lookup-codes` to confirm all 9 pre-existing
     assertions go green.

### DI-02: Eslint peer dependency warnings (existing before my plan)

- **Found during:** `pnpm add` for FullCalendar — pre-existing eslint 10 vs
  `eslint-plugin-import`/`eslint-plugin-react`/`eslint-plugin-jsx-a11y`
  peer-dep mismatch surfaced (those packages cap at eslint <=9).
- **Scope verdict:** Out of scope. Pre-existed at the Phase 3 base commit;
  not caused by Phase 3 deps. ESLint config tidy-up is a Phase 8 release
  hardening task.

---

## 03-04 — Wave 2 i18n + design tokens

### DI-03: `pnpm build` lint/type pipeline fails on unrelated files

- **Found during:** 03-04 Task 2 verification — running `pnpm build` to
  confirm Tailwind v4 + PostCSS parses the new `--cal-event-*` tokens and
  `.fc { ... }` override block.
- **Build status:** CSS / Next.js compile step **succeeds** ("✓ Compiled
  successfully in 9.2s") — the Tailwind v4 pipeline accepts the new tokens
  cleanly. This is the signal that matters for this plan (CSS contract
  ships intact).
- **Failure source 1:** ESLint runner throws
  `Converting circular structure to JSON     --> starting at object with constructor 'Object' ... property 'react' closes the circle`.
  Same pre-existing ESLint 10 vs plugin peer-dep mismatch documented as
  DI-02; ESLint can load the config but cannot serialise it.
- **Failure source 2:** TypeScript error in
  `src/app/[locale]/(app)/admin/users/page.tsx:56:14` —
  ```
  Argument of type '`/${string}/login`' is not assignable to parameter of
  type 'RouteImpl<`/${string}/login`>'.
  ```
  Surfaces because `experimental.typedRoutes` was promoted to top-level
  `typedRoutes: true` in Next.js 15.5 and the build warning explicitly
  flags this drift. Path-literal coercion was looser under the experimental
  flag; promoted typedRoutes enforces stricter `RouteImpl` checks on
  `redirect()` and `Link` `href` arguments.
- **Scope verdict:** Out of scope for Plan 03-04. Pre-existing failure on a
  Phase 1 file (`admin/users/page.tsx`) — not introduced or touched by
  i18n catalog or globals.css edits. The CSS contract this plan delivers
  is unaffected.
- **Suggested resolution path:** Phase 8 release-hardening pass — move
  `typedRoutes` out of `experimental` in `next.config.ts` (per the build
  warning) and either (a) cast the route literal with `as Route` or
  (b) define a typed route helper module that returns
  `RouteImpl<'/${L}/login'>`. The DI-02 ESLint circular-structure issue
  resolves naturally when the eslint peer-dep mismatch is fixed.

---

## 03-07 — Wave 5 write-side UI

### DI-04: Same `pnpm build` typed-routes error still blocks Plan 07 verification

- **Found during:** 03-07 Task 3 verification — running `pnpm build` to
  confirm the new sheets/dialogs/banner compile and the page.tsx mount
  points wire correctly.
- **Build status:** CSS / Next.js compile step **succeeds** ("✓ Compiled
  successfully in 4.3s"). All 10 new Plan 07 components and the
  page.tsx modification compile cleanly. `pnpm typecheck` (the
  `tsc --noEmit` step that runs ahead of Next.js's typed-routes pass)
  passes with exit code 0 across the entire repo.
- **Failure source:** Identical to DI-03 — same line in
  `src/app/[locale]/(app)/admin/users/page.tsx:56:14`. Confirmed
  pre-existing by checking out the Plan 03-07 base commit
  (`9d1b9750ace0ce0be929df5f60dbdc10e50d285c`, "docs(phase-03): update
  tracking after wave 4 (03-06 read-side UI)") and reproducing the
  identical error without any Plan 07 work in the tree.
- **Scope verdict:** Out of scope. Phase 1 file untouched by Plan 07.
  `pnpm typecheck` (the local TS gate) is green; the only outstanding
  failure is the same Next.js typed-routes drift documented in DI-03,
  inherited unchanged from the base commit.
- **Suggested resolution path:** Same as DI-03. When Phase 8 release-
  hardening lands the typed-routes fix, the calendar page.tsx
  `redirect(\`/\${locale}/login\`)` on line 82 (also added in Plan 03-06,
  not touched by 03-07) will also start type-checking under typed routes.
  Both files require the same one-line cast.
