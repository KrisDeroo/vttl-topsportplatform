/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * RSVP decline ≠ delete per D-58. A participant declining sets their own
 * `rsvp_status = declined` on `calendar_event_participants` and never
 * removes the event. The mutation MUST scope by caller id so users cannot
 * forge declines on behalf of others.
 *
 * Reference: 03-CONTEXT.md D-58 (three distinct operations: globaal verwijderen
 *            / Ik kan niet aanwezig zijn / cancel single occurrence);
 *            03-PATTERNS.md analog: consent.test.ts (status mutation on caller's own row);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 3 tRPC `calendar.event.declineParticipation` procedure lands.
 */
import { describe, it, expect } from 'vitest';

describe('calendar.event.declineParticipation — D-58 RSVP decline', () => {
  it.todo('declineParticipation by participant updates own row to rsvp_status=declined');
  it.todo('event still visible to other participants after decline');
  it.todo('mutation row-WHERE clause prevents declining another user (RSVP forgery prevention)');
  it.todo('UI: declined event renders strikethrough + 50% opacity (test asserts CSS class via DOM probe)');
});
