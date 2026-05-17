/**
 * Zod input schemas for ranking.* tRPC procedures (Phase 4 Wave 2 — D-86..D-91).
 *
 * `addEntryInput` uses `z.discriminatedUnion('kind', [...])` to model the
 * split-column XOR shape of `ranking_entries` (D-86 / RANK-01 amended):
 *   - kind='numeric'        → value.value is positive number → DB
 *                             column `value_numeric`
 *   - kind='classification' → value.code is a `belgium_classification.code`
 *                             FK → DB column `value_classification_code`
 *
 * The router cross-checks `value.kind` against `ranking_type.value_shape`
 * (also stored in DB) at request-time — see
 * `src/server/trpc/routers/ranking.ts` addEntry handler step 2.
 *
 * Three-layer defense-in-depth for the XOR invariant (per RESEARCH §Pattern 4):
 *   1. Zod discriminated union — input-shape gate.
 *   2. App-layer `value_shape` cross-check — semantic gate (numeric type
 *      receives numeric value; classification type receives classification).
 *   3. DB-level CHECK constraint `ranking_entries_value_xor` — storage gate.
 *
 * `.strict()` (VALID-06 carry-forward from Phase 2 / Phase 3) — rejects
 * unknown keys, mitigates T-04-XX-INPUT-SMUGGLING-VIA-EXTRA-FIELDS.
 *
 * Every error message is an i18n key (I18N-08 + D-46 from Phase 2); client
 * renders via `useZodErrorMessage`; server logs the raw English key per
 * I18N-11.
 *
 * `_meta.idempotencyKey` on `addEntryInput` is optional and picked up by
 * `idempotencyMiddleware('ranking.addEntry')` per VALID-08 (the same factory
 * already composed onto training.markAttendanceAndScore and
 * tournament.enterResult).
 *
 * Naming: the canonical export is `addEntryInput` (matches plan spec); an
 * alias `rankingAddEntryInput` is also exported to satisfy the Wave 0 RED
 * skeleton `tests/unit/ranking-xor.test.ts` which imports under that name.
 * Two-name export removes a name-divergence-induced false-RED (mirrors the
 * `idempotencyMiddleware`/`withIdempotency` precedent from Plan 04-03).
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-86..D-91
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 4
 *            src/server/trpc/schemas/calendar.ts (Phase 3 — discriminated-union analog)
 */
import { z } from 'zod';

// ─── Discriminated value branches (D-86) ────────────────────────────────

/**
 * Numeric branch — for international ranking types (Senior World, Youth World,
 * Senior European, Youth European). `value` is the rank position: smaller is
 * better for all four (rank #1 is best). DB CHECK
 * `ranking_entries_numeric_positive` enforces `value > 0` at storage.
 */
const numericValueBranch = z
  .object({
    kind: z.literal('numeric'),
    value: z
      .number()
      .positive({ message: 'errors.ranking.mustBePositive' }),
  })
  .strict();

/**
 * Classification branch — for the Belgium hierarchical ranking type.
 * `code` is a FK to `belgium_classification(code)` (A1..A50, B0/B2/B4/B6,
 * C0..C6, D0..D6, E0..E6, NC — 67 codes seeded by 0017). DB FK
 * `ranking_entries.value_classification_code REFERENCES
 * belgium_classification(code)` is the storage backstop.
 */
const classificationValueBranch = z
  .object({
    kind: z.literal('classification'),
    code: z
      .string()
      .min(1, { message: 'errors.ranking.classificationRequired' }),
  })
  .strict();

// ─── addEntry (D-86 split-column XOR + D-89 RBAC + VALID-08 idempotency) ──

/**
 * Add a single ranking entry. The router enforces:
 *   - D-89 RBAC: role ∈ ('player', 'technical_director'); player path further
 *     requires `playerUserId === ctx.scope.userId`.
 *   - D-86 value_shape cross-check: input.value.kind must match
 *     `ranking_type.value_shape` for `rankingTypeCode`.
 *   - VALID-08 idempotency: composed with `idempotencyMiddleware('ranking.addEntry')`.
 *   - GDPR-04 audit: emits `ranking_entry_added` on success.
 */
export const addEntryInput = z
  .object({
    playerUserId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    rankingTypeCode: z
      .string()
      .min(1, { message: 'errors.field.required' }),
    /**
     * When the federation actually published the ranking. The recorded_at
     * timestamp anchors the time-series for getHistory; the DB column is
     * TIMESTAMPTZ (GDPR-08).
     */
    recordedAt: z.coerce.date(),
    /**
     * DOM-RANK-01 — v1 accepts both codes but only 'manual' is set by app
     * paths (no federation-sync feature in v1). 'federation_official' is
     * reserved for v2 sync against KBTTB / ETTU / ITTF APIs.
     */
    source: z
      .enum(['manual', 'federation_official'])
      .default('manual'),
    /** D-86 — exactly one of the two value shapes; Zod enforces shape, router
     *  enforces semantic match against ranking_type.value_shape. */
    value: z.discriminatedUnion('kind', [
      numericValueBranch,
      classificationValueBranch,
    ]),
    /** VALID-08 idempotency key — picked up by `idempotencyMiddleware`. */
    _meta: z
      .object({
        idempotencyKey: z.string().min(8).max(128).optional(),
      })
      .optional(),
  })
  .strict();
export type AddEntryInput = z.infer<typeof addEntryInput>;

/**
 * Alias for the Wave 0 RED skeleton `tests/unit/ranking-xor.test.ts`, which
 * imports `rankingAddEntryInput`. Canonical export is `addEntryInput`;
 * both names point to the same schema. Mirrors the
 * `idempotencyMiddleware`/`withIdempotency` two-name pattern shipped by
 * Plan 04-03 — keeps Wave 0 tests hermetic to their own files (no edits
 * to RED skeletons from Wave 2 plans).
 */
export const rankingAddEntryInput = addEntryInput;

// ─── getHistory (D-87 / D-88 / D-90 per-type time series read) ──────────

/**
 * Read the time series for a (player, ranking_type) pair, optionally
 * bounded by `[from, to]` recorded_at range. Returns rows ascending by
 * recorded_at (D-88 chart shape: line/timeline strip).
 *
 * RLS via `ranking_entry_visible_to` (0018) is the only scoping gate —
 * the router does not add an app-layer filter. Out-of-scope subjects
 * return an empty array.
 *
 * The default 24-month range (D-90) is applied client-side by the chart
 * component; this endpoint accepts any range so the dashboard widget
 * (Phase 7 / VIEW-03) and the range-pills (1m / 6m / 1y / 2y / all) can
 * all reuse it.
 */
export const getHistoryInput = z
  .object({
    playerUserId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    rankingTypeCode: z
      .string()
      .min(1, { message: 'errors.field.required' }),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
export type GetHistoryInput = z.infer<typeof getHistoryInput>;

// ─── getCurrentByType (RANK-05 latest-only) ─────────────────────────────

/**
 * Return the latest ranking entry for a (player, type) pair —
 * ORDER BY recorded_at DESC LIMIT 1. Per RANK-05, the current ranking is
 * never stored as a flat field on `players`; it is always derived from the
 * tail of the time series. This procedure surfaces that derivation.
 */
export const getCurrentByTypeInput = z
  .object({
    playerUserId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    rankingTypeCode: z
      .string()
      .min(1, { message: 'errors.field.required' }),
  })
  .strict();
export type GetCurrentByTypeInput = z.infer<typeof getCurrentByTypeInput>;

// ─── listEntries (audit/correction table view) ──────────────────────────

/**
 * Audit/correction view of every ranking entry for a player (all types) or
 * a single (player, type). Used by the Rankings tab secondary tab where
 * the player or staff sees the raw row history (date + value + source +
 * entered_by) sorted recent-first. Sorting and per-row metadata enable
 * cross-checking and (TD-only) correction workflows.
 */
export const listEntriesInput = z
  .object({
    playerUserId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    rankingTypeCode: z.string().min(1).optional(),
  })
  .strict();
export type ListEntriesInput = z.infer<typeof listEntriesInput>;
