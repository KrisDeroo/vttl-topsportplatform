/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Playwright e2e — mobile single-day view + swipe nav + floating CTA.
 * Pixel-5-class viewport (360×640) forces FullCalendar into `timeGridDay`
 * and the toolbar hides week/year buttons.
 *
 * Reference: CAL-08 (mobile single-day);
 *            03-UI-SPEC.md §Mobile Strategy (lines 484-510);
 *            03-PATTERNS.md §calendar-mobile.spec.ts (no direct analog —
 *            first mobile-viewport e2e spec);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * Implementation lands in Wave 4 — until then test.todo() + test.skip keep
 * the spec parsable.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 360, height: 640 } });

test.describe('Calendar — mobile single-day + swipe (CAL-08)', () => {
  test.skip(true, 'RED scaffold — implementation lands in Wave 4');
  test.todo('< 640px viewport forces timeGridDay; week/year buttons hidden');
  test.todo('horizontal swipe (60px x-delta) calls FullCalendar API .next() / .prev()');
  test.todo('"Nieuwe afspraak" CTA floats bottom-right via fixed positioning');
});
