/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Calendar performance budget — RISK-POLYMORPH. Server-side expansion of
 * 200 events + 30 RRULE rows over a one-week range must complete in
 * p95 < 200 ms. The benchmark uses `Date.now()` around `caller.calendar.list`
 * over the seed and asserts the 95th percentile.
 *
 * Reference: 03-RESEARCH.md §Validation Risks (server-side expansion
 *            performance at scale — RISK-POLYMORPH);
 *            03-PATTERNS.md §calendar-perf.test.ts (no direct analog in Phase 1/2);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 3 tRPC `calendar.list` lands and Wave 5 hardens indexes.
 */
import { describe, it, expect } from 'vitest';

describe('Calendar performance — RISK-POLYMORPH', () => {
  it.todo(
    'calendar.list with 200 events + 30 RRULE rows over a week range completes in p95 < 200ms',
  );
});
