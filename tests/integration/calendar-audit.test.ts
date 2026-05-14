/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Calendar audit_log — 6 action codes per GDPR-04 + D-58c JSONB snapshot
 * completeness for deletes.
 *
 * Action codes covered:
 *  - calendar_event_created
 *  - calendar_event_updated
 *  - calendar_event_deleted       (JSONB snapshot per D-58c)
 *  - calendar_event_declined      (RSVP decline ≠ delete)
 *  - calendar_event_conflict_override (force-save audit BEFORE mutation)
 *  - calendar_event_exception_created
 *
 * Reference: 03-CONTEXT.md D-58c (hard delete + audit-log JSONB snapshot),
 *            GDPR-04 (audit-log every mutation);
 *            03-PATTERNS.md analog: medical-audit.test.ts;
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 3 tRPC procedures emit audit rows.
 */
import { describe, it, expect } from 'vitest';

describe('Calendar audit_log — 6 action codes (GDPR-04)', () => {
  it.todo('calendar_event_created — audit row contains typeCode and new participant ids');
  it.todo('calendar_event_updated — audit row contains old + new state diff');
  it.todo(
    'calendar_event_deleted — JSONB snapshot includes base + extension + participants + exceptions (D-58c)',
  );
  it.todo(
    'calendar_event_deleted — snapshot cap: exceptions array <= 1000 with exceptionsTotalCount when truncated',
  );
  it.todo('calendar_event_declined — RSVP decline writes per-caller audit row');
  it.todo('calendar_event_conflict_override — force-save writes override audit row BEFORE the mutation');
  it.todo('calendar_event_exception_created — single-occurrence override writes audit row');
});
