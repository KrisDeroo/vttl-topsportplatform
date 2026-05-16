/**
 * Quality score mapping — D-60.
 *
 * v1 UI is 5-star; DB stores smallint 1..10 so v2 (1..10 numeric stepper
 * or half-stars) is zero-migration. Stars map to even values 2,4,6,8,10;
 * v2 will use 1,3,5,7,9 (and full 1..10 range).
 *
 * `mapStarsToDb(0)` returns `null` — the "clear score" affordance per
 * UI4-D05; persists the row in a pending (not-yet-scored) state so the
 * trainer can return to it later within the 14-day window (D-64).
 *
 * `mapDbToStars(null)` returns 0 — used on read-side rendering so the
 * star widget shows an unfilled state for sessions that haven't been
 * scored yet (the trainer's "Te scoren" surface — D-66).
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-60..D-61
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 1
 */

export function mapStarsToDb(
  stars: 0 | 1 | 2 | 3 | 4 | 5,
): number | null {
  if (stars === 0) return null;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error(`quality-score: stars must be 0..5 integer, got ${stars}`);
  }
  return stars * 2;
}

export function mapDbToStars(
  score: number | null | undefined,
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (score === null || score === undefined) return 0;
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw new Error(`quality-score: db value must be 1..10 integer, got ${score}`);
  }
  // Round half up: 1→1, 2→1, 3→2, 4→2, 5→3, 6→3, 7→4, 8→4, 9→5, 10→5.
  // For v1 (only even values 2/4/6/8/10), this collapses cleanly.
  return Math.ceil(score / 2) as 0 | 1 | 2 | 3 | 4 | 5;
}
