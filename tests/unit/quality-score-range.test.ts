/**
 * Phase 4 Wave 0 — RED test stub for quality_score range + 5-star mapping (D-60).
 *
 * Covers:
 *   - DB-level CHECK constraint quality_score BETWEEN 1 AND 10 (D-60)
 *   - 5-star UI input → DB integer mapping: ★(1)=2, ★★(2)=4, ★★★(3)=6,
 *     ★★★★(4)=8, ★★★★★(5)=10. v2 can swap to half-stars (odd 1/3/5/7/9)
 *     without a migration since the column already accepts 1..10.
 *
 * Analog: tests/unit/calendar-schemas.test.ts (Zod boundary assertions).
 *
 * RED: this test is intentionally failing until Plan 04-03 ships the
 * `mapStarsToDb` helper in `src/lib/quality-score.ts`.
 */
import { describe, it, expect } from 'vitest';

describe('quality_score range + 5-star mapping (D-60)', () => {
  it('exposes mapStarsToDb(stars: 1..5) → 2|4|6|8|10 from @/lib/quality-score', async () => {
    // String built at runtime so TS doesn't statically resolve a module that
    // hasn't been written yet (Plan 04-03 lands the module + helper).
    const modulePath = ['@', '/lib/quality-score'].join('');
    let mapStarsToDb: unknown;
    try {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      mapStarsToDb = mod.mapStarsToDb;
    } catch {
      mapStarsToDb = undefined;
    }
    expect(
      mapStarsToDb,
      'mapStarsToDb(stars) helper must be exported from @/lib/quality-score (Plan 04-03)',
    ).toBeDefined();
  });

  it.todo('rejects stars outside 1..5 at the helper level');
  it.todo('Zod schema rejects quality_score outside 1..10 with errors.training.qualityScoreOutOfRange');
});
