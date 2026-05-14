/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * FK CASCADE on calendar_events DELETE per D-58. When a base event is hard-
 * deleted, every dependent row (training_sessions / participants /
 * exceptions / per-type extension rows) must be dropped in the same
 * transaction. No `deleted_at` column — audit-log is the forensic recovery
 * path.
 *
 * Reference: 03-CONTEXT.md D-58 (hard delete + audit-log forensic recovery);
 *            03-PATTERNS.md analog: medical-delete.test.ts
 *            (assertion on row absence post-DELETE across joined tables);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 2 migrations land with ON DELETE CASCADE clauses on every
 * FK referencing calendar_events.
 */
import { describe, it, expect } from 'vitest';

describe('calendar_events DELETE — FK CASCADE per D-58', () => {
  it.todo('DELETE FROM calendar_events drops matching training_sessions row');
  it.todo('DELETE FROM calendar_events drops all calendar_event_participants rows');
  it.todo('DELETE FROM calendar_events drops all calendar_event_exceptions rows');
  it.todo('AlertDialog confirmation is mandatory (UI test) — verified via e2e');
  it.todo(
    'NO deleted_at column on calendar_events (hard delete only, audit-log is the forensic recovery path)',
  );
});
