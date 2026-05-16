/**
 * Phase 4 — Plan 04-06 unit-coverage for editRecurringInput Zod schema (D-84 + D-85).
 *
 * Asserts the refinement matrix:
 *  - splitDate required for scope ∈ {single, this_and_future}; optional
 *    for scope='all_in_series'.
 *  - BYDAY + non-weekly FREQ → errors.calendar.bymonthdayNotSupported.
 *  - empty BYDAY array → errors.calendar.rruleBydayRequired.
 *  - endsAt > startsAt within edits.
 *
 * These complement the Wave 0 rrule-byday.test.ts (which only asserts the
 * shape of serializeRrule). They lock the Zod contract independently of the
 * router so a regression here surfaces before reaching the integration layer.
 */
import { describe, expect, it } from 'vitest';

import { editRecurringInput } from '@/server/trpc/schemas/calendar';
import { parseRruleToEditorOptions, serializeRrule, splitRRule } from '@/lib/rrule';

// Zod 4 enforces strict UUID v1-v8 format; use a valid v4 fixture.
const validEventId = '11111111-2222-4333-8444-555555555555';

describe('editRecurringInput — Zod refinement matrix (D-84 + D-85)', () => {
  it('rejects scope=this_and_future without splitDate', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'this_and_future',
      edits: { title: 'New' },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message);
      expect(messages).toContain('errors.calendar.splitDateRequired');
    }
  });

  it('rejects scope=single without splitDate', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'single',
      edits: { cancelled: true },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message);
      expect(messages).toContain('errors.calendar.splitDateRequired');
    }
  });

  it('accepts scope=all_in_series without splitDate', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'all_in_series',
      edits: { title: 'Renamed series' },
    });
    expect(res.success).toBe(true);
  });

  it('rejects BYDAY with non-weekly FREQ (D-85 — BYMONTHDAY deferred to v2)', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'all_in_series',
      edits: { byday: ['MO', 'WE'], frequency: 'daily' },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message);
      expect(messages).toContain('errors.calendar.bymonthdayNotSupported');
    }
  });

  it('accepts BYDAY with FREQ=WEEKLY (multi-day-per-week)', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'all_in_series',
      edits: { byday: ['TU', 'TH'], frequency: 'weekly' },
    });
    expect(res.success).toBe(true);
  });

  it('rejects empty BYDAY array', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'all_in_series',
      edits: { byday: [], frequency: 'weekly' },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message);
      // Empty array fails the .min(1) on the byday array; the refine fires
      // only when byday has length >= 1. Either branch is acceptable —
      // we just need the editor to know "you need at least one weekday".
      expect(
        messages.includes('errors.calendar.rruleBydayRequired') ||
          messages.some((m) => m.includes('Array must contain at least 1')),
      ).toBe(true);
    }
  });

  it('rejects endsAt < startsAt within edits', () => {
    const res = editRecurringInput.safeParse({
      eventId: validEventId,
      scope: 'all_in_series',
      edits: {
        startsAt: new Date('2026-05-16T10:00:00Z'),
        endsAt: new Date('2026-05-16T08:00:00Z'),
      },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message);
      expect(messages).toContain('errors.calendar.endBeforeStart');
    }
  });
});

describe('serializeRrule + parseRruleToEditorOptions round-trip (D-85)', () => {
  it('serialize(WEEKLY + BYDAY=TU,TH) emits a string parseRruleToEditorOptions can rehydrate', () => {
    const rruleString = serializeRrule({ freq: 'weekly', byday: ['TU', 'TH'] });
    expect(rruleString).toContain('FREQ=WEEKLY');
    expect(rruleString).toContain('BYDAY=TU,TH');

    // parseRruleToEditorOptions reads origOptions; we pass a harmless
    // dtstart anchor because parseRrule needs one for RFC 5545 resolution.
    const parsed = parseRruleToEditorOptions(
      rruleString,
      new Date('2026-05-01T10:00:00Z'),
    );
    expect(parsed.freq).toBe('weekly');
    expect(parsed.byday).toEqual(['TU', 'TH']);
  });

  it('serialize rejects BYDAY with FREQ=daily (D-85)', () => {
    expect(() =>
      serializeRrule({ freq: 'daily', byday: ['MO'] }),
    ).toThrow(/bymonthdayNotSupported/);
  });

  it('serialize rejects empty BYDAY when supplied', () => {
    expect(() =>
      serializeRrule({ freq: 'weekly', byday: [] }),
    ).toThrow(/rruleBydayRequired/);
  });
});

describe('splitRRule — D-84 edge cases', () => {
  it('preserves BYDAY across the split', () => {
    const result = splitRRule(
      'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20271231T220000Z',
      new Date('2026-06-15T08:00:00Z'),
      new Date('2026-04-01T08:00:00Z'),
    );
    expect(result.oldRruleString).toContain('BYDAY=TU,TH');
    expect(result.newRruleString).toContain('BYDAY=TU,TH');
  });

  it('truncates the old UNTIL to splitDate - 1 day', () => {
    const splitDate = new Date('2026-06-15T08:00:00Z');
    const result = splitRRule(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20271231T220000Z',
      splitDate,
      new Date('2026-04-01T08:00:00Z'),
    );
    // The result UNTIL should be ~24h before splitDate (June 14).
    const newUntilMatch = result.oldRruleString.match(/UNTIL=(\d{8}T\d{6}Z)/);
    expect(newUntilMatch).not.toBeNull();
    if (newUntilMatch) {
      // Date string starts with '20260614' (Brussels June 14)
      expect(newUntilMatch[1]).toMatch(/^20260614T/);
    }
  });

  it('converts COUNT to UNTIL semantics (COUNT discarded)', () => {
    const result = splitRRule(
      'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
      new Date('2026-06-15T08:00:00Z'),
      new Date('2026-04-01T08:00:00Z'),
    );
    expect(result.oldRruleString).not.toContain('COUNT=');
    expect(result.oldRruleString).toContain('UNTIL=');
  });

  it('newDtstart equals the supplied splitDate', () => {
    const splitDate = new Date('2026-06-15T08:00:00Z');
    const result = splitRRule(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20271231T220000Z',
      splitDate,
      new Date('2026-04-01T08:00:00Z'),
    );
    expect(result.newDtstart.toISOString()).toBe(splitDate.toISOString());
  });

  it('new continuation has NO UNTIL/COUNT (caller decides horizon)', () => {
    const result = splitRRule(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20271231T220000Z',
      new Date('2026-06-15T08:00:00Z'),
      new Date('2026-04-01T08:00:00Z'),
    );
    expect(result.newRruleString).not.toContain('UNTIL=');
    expect(result.newRruleString).not.toContain('COUNT=');
  });
});
