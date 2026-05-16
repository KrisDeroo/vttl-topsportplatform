/**
 * Phase 4 Wave 0 — RED test stub for BYDAY multi-day RRULE (D-85).
 *
 * Covers TRAIN-03 + D-85: RRULE editor supports multi-day BYDAY selection
 * (e.g., "Tuesday + Thursday") with FREQ=WEEKLY. Most elite training plans
 * need 2–3 sessions per week on fixed weekdays. BYMONTHDAY remains v2
 * (deferred).
 *
 * Analog: tests/unit/rrule.test.ts (Phase 3 pure-function RRULE coverage).
 *
 * RED: this test is intentionally failing until Plan 04-06 ships the
 * extended `parseRrule`/`serializeRrule` BYDAY handling in @/lib/rrule.
 */
import { describe, it, expect } from 'vitest';

describe('RRULE BYDAY multi-day (D-85)', () => {
  it('exposes serializeRrule helper that emits BYDAY=TU,TH from {byweekday: [TU,TH], freq: WEEKLY}', async () => {
    let serializeRrule: unknown;
    try {
      const mod = await import('@/lib/rrule');
      serializeRrule = (mod as Record<string, unknown>).serializeRrule;
    } catch {
      serializeRrule = undefined;
    }
    expect(
      serializeRrule,
      'serializeRrule({byweekday, freq, until}) must be exported from @/lib/rrule (Plan 04-06)',
    ).toBeDefined();
  });

  it.todo('round-trip: parse(serialize({byweekday:[TU,TH]})) === {byweekday:[TU,TH]}');
  it.todo('Zod schema rejects FREQ=WEEKLY without BYDAY with errors.calendar.rruleBydayRequired');
  it.todo('BYMONTHDAY remains rejected at the Zod layer (deferred to v2)');
});
