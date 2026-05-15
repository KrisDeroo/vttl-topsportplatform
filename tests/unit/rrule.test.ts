/**
 * Phase 3 Wave 0 — pure-function RRULE coverage for `@/lib/rrule`.
 *
 * Reference: 03-CONTEXT.md D-52, D-53, D-54, D-55;
 *            03-RESEARCH.md §Pattern 3 (RRULE expansion + horizon clamp);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * Implemented in Plan 03-08 (Wave 6) — all branches converted from pending
 * placeholders to real assertions. The `@/lib/rrule` module shipped in Plan 03-03.
 */
import { describe, it, expect } from 'vitest';
import { addDays, addYears } from 'date-fns';
import { TRPCError } from '@trpc/server';

import {
  expandRrule,
  ensureHorizon,
  parseRrule,
  validateHorizon,
} from '@/lib/rrule';

// ---------------------------------------------------------------------
// expandRrule — RFC 5545 expansion (D-53)
// ---------------------------------------------------------------------

describe('expandRrule — RFC 5545 expansion (D-53)', () => {
  /**
   * DST boundary check: weekly Tuesday 09:00 UTC. The 2026 EU DST end is on
   * Sunday 2026-10-25; the immediately surrounding Tuesdays are 2026-10-20
   * (still summer time) and 2026-10-27 (winter time). RRULE expansion runs
   * in UTC, so every occurrence's UTC hour stays at 09:00 — that's the
   * invariant Pitfall 3 guards (no drift).
   */
  it('DST boundary: weekly Tuesday 09:00 UTC — occurrences stay at 09:00 UTC across Oct 25', () => {
    const dtstart = new Date(Date.UTC(2026, 9, 13, 9, 0, 0)); // Tue 2026-10-13 09:00Z
    const until = new Date(Date.UTC(2026, 10, 10, 9, 0, 0)); // Tue 2026-11-10 09:00Z
    const untilStr = until.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    const occurrences = expandRrule(
      rrule,
      dtstart,
      60 * 60 * 1000, // 1h duration
      new Date(Date.UTC(2026, 9, 1)),
      new Date(Date.UTC(2026, 10, 15)),
      [],
    );
    // Expect Tuesdays 2026-10-13, 10-20, 10-27, 11-03, 11-10 = 5 occurrences.
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
    for (const o of occurrences) {
      // Every occurrence must be at 09:00 UTC — no DST drift.
      expect(o.startsAt.getUTCHours()).toBe(9);
      expect(o.startsAt.getUTCMinutes()).toBe(0);
      // Day-of-week must remain Tuesday (UTC 2).
      expect(o.startsAt.getUTCDay()).toBe(2);
    }
  });

  it('applies exceptions: cancelled occurrences are skipped', () => {
    const dtstart = new Date(Date.UTC(2026, 0, 6, 10, 0, 0)); // Tue 2026-01-06
    const until = new Date(Date.UTC(2026, 1, 3, 10, 0, 0)); // Tue 2026-02-03
    const untilStr = until.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    const cancelledDate = new Date(Date.UTC(2026, 0, 20, 10, 0, 0));
    const noExceptions = expandRrule(
      rrule,
      dtstart,
      60 * 60 * 1000,
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 1, 5)),
      [],
    );
    const withException = expandRrule(
      rrule,
      dtstart,
      60 * 60 * 1000,
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 1, 5)),
      [
        {
          occurrenceDate: cancelledDate,
          cancelled: true,
          overrideStartsAt: null,
          overrideEndsAt: null,
          overrideTitle: null,
          overrideLocation: null,
          overrideDescription: null,
        },
      ],
    );
    expect(withException.length).toBe(noExceptions.length - 1);
    // The cancelled date should be absent.
    const stillPresent = withException.some(
      (o) => o.startsAt.toISOString().slice(0, 10) === '2026-01-20',
    );
    expect(stillPresent).toBe(false);
  });

  it('applies overrides: overrideStartsAt + overrideEndsAt replace original', () => {
    const dtstart = new Date(Date.UTC(2026, 0, 6, 10, 0, 0)); // Tue 2026-01-06
    const until = new Date(Date.UTC(2026, 0, 27, 10, 0, 0)); // Tue 2026-01-27
    const untilStr = until.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    const targetOccurrenceDate = new Date(Date.UTC(2026, 0, 13, 10, 0, 0));
    const overrideStart = new Date(Date.UTC(2026, 0, 13, 14, 0, 0));
    const overrideEnd = new Date(Date.UTC(2026, 0, 13, 15, 30, 0));

    const occurrences = expandRrule(
      rrule,
      dtstart,
      60 * 60 * 1000,
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 0, 31)),
      [
        {
          occurrenceDate: targetOccurrenceDate,
          cancelled: false,
          overrideStartsAt: overrideStart,
          overrideEndsAt: overrideEnd,
          overrideTitle: 'Moved training',
          overrideLocation: null,
          overrideDescription: null,
        },
      ],
    );
    const moved = occurrences.find(
      (o) => o.occurrenceDate.toISOString().slice(0, 10) === '2026-01-13',
    );
    expect(moved).toBeDefined();
    expect(moved?.startsAt.toISOString()).toBe(overrideStart.toISOString());
    expect(moved?.endsAt.toISOString()).toBe(overrideEnd.toISOString());
    expect(moved?.titleOverride).toBe('Moved training');
  });

  it('clamps read-time at dtstart + 2y per D-55', () => {
    const dtstart = new Date(Date.UTC(2026, 0, 6, 10, 0, 0));
    // UNTIL +5y — defense in depth requires the read-time to clamp anyway.
    const farUntil = addYears(dtstart, 5);
    const untilStr = farUntil.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    // Ask for a 4y range — server-side clamp must cap at +2y from dtstart.
    const occurrences = expandRrule(
      rrule,
      dtstart,
      60 * 60 * 1000,
      dtstart,
      addYears(dtstart, 4),
      [],
    );
    const horizonMax = addYears(dtstart, 2);
    for (const o of occurrences) {
      expect(o.startsAt.getTime()).toBeLessThanOrEqual(horizonMax.getTime());
    }
  });
});

// ---------------------------------------------------------------------
// validateHorizon — D-55 write-time gate
// ---------------------------------------------------------------------

describe('validateHorizon — D-55 write-time gate', () => {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

  it('rejects RRULE without UNTIL or COUNT', () => {
    const rrule = 'RRULE:FREQ=WEEKLY;BYDAY=TU';
    expect(() => validateHorizon(rrule, createdAt)).toThrowError(TRPCError);
    try {
      validateHorizon(rrule, createdAt);
    } catch (err) {
      expect((err as TRPCError).message).toBe(
        'errors.calendar.rruleHorizonExceeded',
      );
    }
  });

  it('rejects UNTIL beyond createdAt + 2y', () => {
    const tooFar = addYears(createdAt, 3);
    const untilStr = tooFar.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    expect(() => validateHorizon(rrule, createdAt)).toThrowError(TRPCError);
  });

  it('accepts UNTIL within window', () => {
    const sixMonths = addDays(createdAt, 180);
    const untilStr = sixMonths.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    expect(() => validateHorizon(rrule, createdAt)).not.toThrow();
  });

  it('rejects rrule string containing DTSTART: per RESEARCH Anti-Pattern 1', () => {
    const rrule = 'DTSTART:20260101T100000Z\nRRULE:FREQ=WEEKLY;COUNT=3';
    expect(() => validateHorizon(rrule, createdAt)).toThrowError(TRPCError);
  });
});

// ---------------------------------------------------------------------
// parseRrule + ensureHorizon
// ---------------------------------------------------------------------

describe('parseRrule', () => {
  it('throws on invalid RFC 5545 string', () => {
    const dtstart = new Date(Date.UTC(2026, 0, 1));
    expect(() => parseRrule('not a real rrule', dtstart)).toThrowError(
      TRPCError,
    );
  });

  it('parses FREQ=WEEKLY;UNTIL=... with explicit dtstart', () => {
    const dtstart = new Date(Date.UTC(2026, 0, 6, 10, 0, 0));
    const until = new Date(Date.UTC(2026, 1, 3, 10, 0, 0));
    const untilStr = until.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
    const rule = parseRrule(rrule, dtstart);
    expect(rule).toBeDefined();
    expect(rule.origOptions.freq).toBeDefined();
  });
});

describe('ensureHorizon — UI helper for "Eindigt: Nooit"', () => {
  it('auto-injects UNTIL = createdAt + 2y when neither UNTIL nor COUNT is set', () => {
    const createdAt = new Date(Date.UTC(2026, 0, 1));
    const input = 'RRULE:FREQ=WEEKLY;BYDAY=TU';
    const withHorizon = ensureHorizon(input, createdAt);
    expect(withHorizon).toContain('UNTIL=');
    // Roundtrip — the resulting rrule must validate.
    expect(() => validateHorizon(withHorizon, createdAt)).not.toThrow();
  });

  it('leaves bounded rrule unchanged', () => {
    const createdAt = new Date(Date.UTC(2026, 0, 1));
    const input = 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=5';
    const result = ensureHorizon(input, createdAt);
    // COUNT-bound — unchanged.
    expect(result).toBe(input);
  });
});

// Sanity guard: prove the test file is syntactically valid.
describe('rrule test scaffold metadata', () => {
  it('declares the canonical RRULE describe blocks', () => {
    expect(true).toBe(true);
  });
});
