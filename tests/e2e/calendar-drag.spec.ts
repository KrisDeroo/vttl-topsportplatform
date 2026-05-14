/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Playwright e2e — drag-to-edit + optimistic update + server-side conflict
 * revert.
 *
 * Reference: UI-SPEC §Drag-to-edit;
 *            D-57 (soft conflict warning never blocks);
 *            03-PATTERNS.md analog: tests/e2e/photo-upload.spec.ts;
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * Implementation lands in Wave 4.
 */
import { test, expect } from '@playwright/test';

test.describe('Calendar — drag-to-edit + optimistic revert', () => {
  test.skip(true, 'RED scaffold — implementation lands in Wave 4');
  test('drag event to new time → optimistic move + tRPC update succeeds → toast.moved', async () => {});
  test('drag event to conflicting time → revert + ConflictBanner appears', async () => {});
});
