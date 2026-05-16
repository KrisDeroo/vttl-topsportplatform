/**
 * Phase 4 Wave 0 — RED test stub for sparring partner RLS (D-63, CAL-04 Branch 6).
 *
 * Covers D-63: sparring partners are attached via session_sparring_partners
 * junction (event_id, sparring_partner_id) FK users.id where role =
 * 'sparring_partner'. Sparring partners are NOT scored (no session_participants
 * row). They see only the calendar events of sessions they are linked to
 * (fills Phase 3 D-50 sparring no-op placeholder — CAL-04 Branch 6).
 *
 * Analog: tests/integration/calendar-rls.test.ts (D-50 5-branch UNION).
 *
 * RED: this test is intentionally failing until Plan 04-06 ships the
 * session_sparring_partners junction + RLS branch extension in migration 0018.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('sparring partner RLS (D-63, CAL-04 Branch 6)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('sparring_partner user sees the calendar_events of sessions they are linked to', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (session_sparring_partners + calendar_events_visible_to Branch 6)');
  });
  it('sparring_partner user does NOT see calendar_events of sessions they are NOT linked to', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (session_sparring_partners + scoped RLS)');
  });
  it('sparring_partner has no session_participants row (D-63 — players only)', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (D-63 sparring-not-scored invariant)');
  });

  it.todo('attaching a sparring_partner emits audit code sparring_partner_attached');
  it.todo('FK sparring_partner_id must reference a users row with role = sparring_partner');
});
