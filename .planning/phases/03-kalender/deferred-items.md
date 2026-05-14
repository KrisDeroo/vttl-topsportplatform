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
