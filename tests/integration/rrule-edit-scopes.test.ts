/**
 * Phase 4 Wave 0 — RED test stub for recurring-edit scopes (D-84, D-83).
 *
 * Covers three edit scopes:
 *   - single                  (Phase 3 D-54 — calendar_event_exceptions write)
 *   - this_and_future         (D-84 split-and-rewrite — see splitRRule)
 *   - all_in_series           (D-84 in-place base + extension update)
 *
 * AND the immutable-past invariant (D-83): session_participants rows
 * where occurrence_date < edit_date are NEVER mutated, regardless of
 * scope. Past sessions are historical records.
 *
 * Applies to both training_sessions (with per-occurrence session_participants)
 * and meetings (series-level participants only).
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (Phase 3 D-54
 * single-occurrence override).
 *
 * RED: this test is intentionally failing until Plan 04-06 ships
 * calendar.event.editRecurring({scope}).
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('rrule edit — scope: single (Phase 3 D-54 carry-forward)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('writes calendar_event_exceptions row; future occurrences unaffected', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (calendar.event.editRecurring scope=single)');
  });
});

describe('rrule edit — scope: this_and_future (D-84 split-and-rewrite)', () => {
  it('truncates old event UNTIL to splitDate-1d; creates new event from splitDate with cloned participants', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (calendar.event.editRecurring scope=this_and_future)');
  });
  it('past session_participants stay on the old event (D-83 immutable past)', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (D-83 immutable past on split)');
  });
});

describe('rrule edit — scope: all_in_series (D-84 in-place update)', () => {
  it('updates calendar_events + extension fields in place; past session_participants unchanged', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (calendar.event.editRecurring scope=all_in_series)');
  });
  it('rrule change (e.g., TU → TH) leaves past calendar_event_exceptions in place as inert rows', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (D-84 inert-exception policy)');
  });
});

describe('rrule edit — D-83 immutable past invariant (cross-scope)', () => {
  it('session_participants with occurrence_date < edit_date are NEVER mutated by any scope', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (D-83 cross-scope invariant)');
  });

  it.todo('meetings: scope=all_in_series updates series-level participants but not historical attendance');
  it.todo('emits audit code calendar_event_recurring_split (this_and_future) and calendar_event_recurring_updated_all (all_in_series)');
});
