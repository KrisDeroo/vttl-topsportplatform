/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Playwright e2e — week view base + event click + view switcher.
 *
 * Reference: CAL-01 (week view default), CAL-02 (month/year views), CAL-03
 *            (event-type color coding);
 *            03-UI-SPEC.md §Calendar week view;
 *            03-PATTERNS.md analog: tests/e2e/photo-upload.spec.ts;
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * Implementation lands in Wave 4 — until then test.todo() and test.skip(true,
 * 'RED scaffold') keep the spec parsable and out of the runner.
 */
import { test, expect } from '@playwright/test';

test.describe('Calendar — week view (CAL-01, CAL-03)', () => {
  test.skip(true, 'RED scaffold — implementation lands in Wave 4');
  test.todo('TD login → /nl/calendar loads, week view is the default, 6 event-type colors are visible');
  test.todo('clicking an event opens EventDetailSheet with title + type chip + time range');
  test.todo('Month + Year view buttons in toolbar switch the visible view (CAL-02)');
});
