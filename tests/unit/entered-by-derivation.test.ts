/**
 * Phase 4 Wave 0 — RED test stub for entered_by attribution (DOM-RESULT-02).
 *
 * Covers DOM-RESULT-02 + D-73: tournament_results.entered_by is derived
 * from the caller's role at mutation time. Possible values:
 *   - 'player' (player entering their own result, day 0..14)
 *   - 'trainer' (trainer-in-academy backfilling per D-73)
 *   - 'td' (technical_director unconditional overwrite per D-75)
 *
 * Analog: tests/unit/calendar-schemas.test.ts (pure derivation helper).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships
 * `deriveEnteredBy` in `src/lib/tournament-result.ts`.
 */
import { describe, it, expect } from 'vitest';

describe('entered_by derivation (DOM-RESULT-02, D-73)', () => {
  it('exposes deriveEnteredBy(role, isOwn) from @/lib/tournament-result', async () => {
    // Runtime-built path: TS can't statically resolve a module that hasn't shipped.
    const modulePath = ['@', '/lib/tournament-result'].join('');
    let deriveEnteredBy: unknown;
    try {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      deriveEnteredBy = mod.deriveEnteredBy;
    } catch {
      deriveEnteredBy = undefined;
    }
    expect(
      deriveEnteredBy,
      'deriveEnteredBy(role, isOwn) must be exported from @/lib/tournament-result (Plan 04-04)',
    ).toBeDefined();
  });

  it.todo("derives 'player' when caller role is 'player' AND playerUserId === ctx.userId");
  it.todo("derives 'trainer' when caller role is 'trainer' AND playerUserId !== ctx.userId");
  it.todo("derives 'td' when caller role is 'technical_director'");
});
