/**
 * Phase 4 Wave 0 — RED test stub for splitRRule() (D-84).
 *
 * Covers: D-84 "Deze en toekomstige" split-and-rewrite math. Given an
 * existing RRULE and a split-date occurrence, the old RRULE's UNTIL must
 * be truncated to (splitDate - 1 day) so the original series ends at the
 * day before the split. A new RRULE is then created starting from the
 * splitDate with the original BYDAY/FREQ rules.
 *
 * Analog: tests/unit/rrule.test.ts (Phase 3 — pure-function RRULE coverage).
 *
 * RED: this test is intentionally failing until Plan 04-06 ships
 * `splitRRule()` in `src/lib/rrule.ts`.
 */
import { describe, it, expect } from 'vitest';

describe('splitRRule — D-84 "Deze en toekomstige" split math', () => {
  it('truncates oldRrule UNTIL to splitDate - 1 day; returns continuation RRULE from splitDate', async () => {
    // RED — the helper does not exist yet (lands in Plan 04-06).
    // `expect.fail` makes the test deliberately fail rather than skip so
    // the Nyquist signal in CI is clear (Wave 0 → Wave 1+ progress).
    let splitRRule: unknown;
    try {
      const mod = await import('@/lib/rrule');
      splitRRule = (mod as Record<string, unknown>).splitRRule;
    } catch {
      splitRRule = undefined;
    }
    expect(
      splitRRule,
      'splitRRule(rrule, splitOccurrence) must be exported from @/lib/rrule (Plan 04-06)',
    ).toBeDefined();
  });

  it.todo(
    'preserves BYDAY across the split (e.g., FREQ=WEEKLY;BYDAY=TU,TH stays TU,TH on both halves)',
  );
  it.todo('returns NULL continuation when splitDate is the very last occurrence in the series');
});
