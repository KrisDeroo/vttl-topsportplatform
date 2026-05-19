/**
 * tournament-result — D-73/D-75/DOM-RESULT-02 pure helpers.
 *
 * Phase 4 Plan 04-04 inlined `deriveEnteredBy` as a closure inside the
 * tournament router. The Wave 0 unit test
 * (`tests/unit/entered-by-derivation.test.ts`) expects the helper as a
 * standalone export from `@/lib/tournament-result` so the derivation
 * can be tested in isolation without spinning up the tRPC stack.
 *
 * Re-exported and re-used by the router so a single source of truth is
 * preserved.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-73 + D-75
 *            .planning/phases/04-kerndomein/04-04-SUMMARY.md (inline derivation
 *            now exported here for testability).
 */

/**
 * Three buckets for `tournament_results.entered_by` (DOM-RESULT-02 enum-via-CHECK):
 *   - 'player'  — the player themselves (own row, within 14d window)
 *   - 'trainer' — trainer-in-same-academy backfill (D-73 — no wall)
 *   - 'td'      — technical_director unconditional overwrite (D-75 — no wall)
 *
 * Other roles (sparring_partner, parent, medical_staff, academy_manager)
 * are rejected by the router's first-line role gate BEFORE this helper is
 * invoked — TypeScript narrows them away here.
 */
export type EnteredByRole = 'player' | 'trainer' | 'technical_director';
export type EnteredByValue = 'player' | 'trainer' | 'td';

/**
 * Derive the `entered_by` column value from the caller's role.
 *
 * The `isOwn` parameter is reserved for v2 — currently the role is the
 * only signal because the router pre-validates the own-row gate for the
 * player branch BEFORE calling this helper (errors.tournament.notOwnPlayer
 * for cross-player attempts). Accepting `isOwn` lets future flows
 * differentiate "TD enters their own result" if the TD ever holds a
 * player role concurrently — a Phase 5+ concern.
 */
export function deriveEnteredBy(
  role: EnteredByRole,
  _isOwn: boolean = true,
): EnteredByValue {
  if (role === 'player') return 'player';
  if (role === 'technical_director') return 'td';
  return 'trainer';
}
