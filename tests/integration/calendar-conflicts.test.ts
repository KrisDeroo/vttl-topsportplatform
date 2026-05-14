/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Conflict detection — D-56 per-participant overlap + D-57 cross-scope
 * SECURITY DEFINER bypass + role-gated detail redaction + D-57 override audit.
 *
 * Reference: 03-CONTEXT.md D-56 (per-participant overlap; no location-based);
 *            D-57 (cross-scope detection + role-gated redaction);
 *            03-RESEARCH.md §Example 3 (redaction helper);
 *            03-PATTERNS.md analog: medical-audit.test.ts
 *            (role-discriminated outcomes against same DB state);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 2 (SECURITY DEFINER fn `overlapping_events_for_users`) +
 * Wave 3 (service-layer redaction helper + audit-emitting create procedure)
 * ship.
 */
import { describe, it, expect } from 'vitest';

describe('Conflict detection — D-56 per-participant overlap', () => {
  it.todo('same time + same participant in both events → conflict detected');
  it.todo('same time + different participants → no conflict');
  it.todo('recurring event B in candidate event A range → expansion ±15d catches conflict');
  it.todo('no location-based conflict (D-56 explicit — free-text location is not a conflict surface)');
});

describe('Conflict cross-scope detection — D-57', () => {
  it.todo('SECURITY DEFINER overlapping_events_for_users() bypasses RLS');
  it.todo('caller=academy_manager sees medical conflict for academy player (cross-scope correctness)');
  it.todo('service layer applies role-gated redaction: detailMode=full when caller IS participant');
  it.todo(
    'service layer applies role-gated redaction: detailMode=redacted when caller is NOT participant and NOT TD',
  );
  it.todo(
    'redacted response omits title + location + description; only type-code + participant-name + time-range present',
  );
  it.todo('TD always gets detailMode=full regardless');
});

describe('Conflict override audit — D-57', () => {
  it.todo('force:true flag on calendar.event.create writes calendar_event_conflict_override audit row');
  it.todo('blocked:false in every conflict response (D-57: soft warning, never block)');
});
