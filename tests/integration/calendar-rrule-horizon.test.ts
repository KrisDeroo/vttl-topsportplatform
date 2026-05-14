/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * RRULE 2-year horizon defense-in-depth per D-55:
 *  - Write-time gate: tRPC `calendar.event.create` rejects unbounded
 *    recurrences and UNTIL > createdAt + 2y with `errors.calendar.rruleHorizonExceeded`.
 *  - Read-time clamp: tRPC `calendar.list` rejects (to - from) > 2y with
 *    `errors.calendar.rangeTooLarge`; legacy rows with extreme UNTIL are
 *    silently clamped to startsAt + 2y on expansion.
 *
 * Reference: 03-CONTEXT.md D-55 (defense in depth);
 *            03-RESEARCH.md §Pattern 3 (RRULE expansion + horizon clamp);
 *            03-PATTERNS.md analog: player-router.test.ts (TRPCError i18n-key);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 3 (server schemas + tRPC procedures + lib/rrule.ts) lands.
 */
import { describe, it, expect } from 'vitest';
// Wave 3 imports stay commented until the surfaces land:
//   import { freshDb } from '../helpers/db';
//   import { appCaller } from '../helpers/trpc';
//   import { seedCalendarFixtures } from '../fixtures/calendar-seed';

describe('Calendar RRULE 2-year horizon — D-55 defense in depth', () => {
  it.todo(
    'write-time: rejects calendar.event.create with UNTIL beyond +2y → errors.calendar.rruleHorizonExceeded',
  );
  it.todo(
    'write-time: rejects rrule without UNTIL or COUNT → errors.calendar.rruleHorizonExceeded',
  );
  it.todo(
    'write-time: auto-injects UNTIL=createdAt+2y when "Eindigt: Nooit" is sent via ensureHorizon()',
  );
  it.todo('read-time: calendar.list({from,to}) rejects (to - from) > 2y → errors.calendar.rangeTooLarge');
  it.todo(
    'read-time: legacy row with UNTIL+5y is clamped to startsAt+2y on expansion (no exception thrown)',
  );
});
