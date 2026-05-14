/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * `calendar_event_exceptions` single-occurrence override per D-54.
 * Covers three exception modes (cancel / move / retitle), the
 * UNIQUE(event_id, occurrence_date) constraint, and FK CASCADE behaviour
 * when the parent event is deleted.
 *
 * Reference: 03-CONTEXT.md D-54 (exception modes);
 *            03-PATTERNS.md analog: age-category-history.test.ts
 *            (sequential INSERT / close-old-row / INSERT verifies series consistency);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 2 migration `drizzle/0009_phase3_calendar_*.sql` creates the
 * `calendar_event_exceptions` table.
 */
import { describe, it, expect } from 'vitest';

describe('calendar_event_exceptions — D-54 single-occurrence override', () => {
  it.todo('cancel: writing cancelled=true skips the occurrence in expansion');
  it.todo('move: overrideStartsAt + overrideEndsAt replace the original times');
  it.todo('retitle: overrideTitle replaces title for that occurrence only');
  it.todo('UNIQUE(event_id, occurrence_date) prevents duplicate exception rows');
  it.todo('FK CASCADE on calendar_events delete drops associated exceptions');
});
