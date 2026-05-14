/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Playwright e2e — drag-create flow + conflict warning + force-save audit.
 *
 * Reference: CAL-07 (event create), D-57 (conflict soft warning + override audit);
 *            03-UI-SPEC.md §EventCreateSheet + §ConflictWarning;
 *            03-PATTERNS.md analog: tests/e2e/photo-upload.spec.ts;
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * Implementation lands in Wave 4 — until then test.todo() + test.skip keep
 * the spec parsable.
 */
import { test, expect } from '@playwright/test';

test.describe('Calendar — drag-create + conflict warning (CAL-07)', () => {
  test.skip(true, 'RED scaffold — implementation lands in Wave 4');
  test.todo('drag-select range on grid → EventCreateSheet opens with start/end pre-filled');
  test.todo('overlapping participant → ConflictWarning surfaces with participant-name copy');
  test.todo('clicking "Toch opslaan" succeeds and audit_log gets calendar_event_conflict_override row');
});
