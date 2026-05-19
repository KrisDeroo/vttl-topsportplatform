/**
 * match-result — D-81 derived won/lost helpers.
 *
 * TOURN-04 PARTIALLY-SUPERSEDED-BY D-81: there is NO boolean `won` column
 * on `match_results`. The gewonnen/verloren display indicator is derived
 * at query time from `sets_won > sets_lost`. v2 may add `score_sets jsonb`
 * for set-by-set detail without migrating sets_won/sets_lost.
 *
 * Phase 4 Plan 04-04 left the derivation inline (UI surfaces compute it
 * on render). The Wave 0 unit test
 * (`tests/unit/match-derived-won.test.ts`) expects the helper as a
 * standalone export from `@/lib/match-result` so the derivation can be
 * exercised in isolation.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-81;
 *            src/server/db/schema/tournament.ts (match_results CHECK 0..4 +
 *            cross-row CHECK 1..7).
 */

export interface MatchSets {
  setsWon: number;
  setsLost: number;
}

/**
 * Compute the win/draw/loss tri-state from the set tally.
 *
 * Belgian table tennis matches are best-of-5 or best-of-7 — typically
 * one side reaches the threshold before the other (3-x or 4-x). The
 * special-case 3-3 / 4-4 cannot occur in regulation but the helper
 * returns 'draw' as a defensive value so downstream UI can render a
 * neutral marker rather than crash on the boundary case.
 *
 * Inputs are pre-validated by the schema (CHECK 0..4 per side) and the
 * Zod refine (total 1..7) — the helper is pure and side-effect-free.
 */
export function deriveMatchOutcome(
  match: MatchSets,
): 'won' | 'lost' | 'draw' {
  if (match.setsWon > match.setsLost) return 'won';
  if (match.setsWon < match.setsLost) return 'lost';
  return 'draw';
}

/**
 * Convenience predicate — `true` when the player won the match.
 * UI surfaces that only care about the binary distinction use this.
 */
export function isMatchWon(match: MatchSets): boolean {
  return deriveMatchOutcome(match) === 'won';
}
