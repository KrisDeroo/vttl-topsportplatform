/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Calendar RLS — sample of 5 roles × 6 event types = 30 cells per D-50 and
 * USER-04. Asserts both tRPC layer scope AND direct psql RLS-as-app_user
 * behaviour. Sparring partner is the explicit no-op in Phase 3 per D-50.
 *
 * Reference: 03-CONTEXT.md D-50 (sparring no-op), D-48 (per-type RBAC matrix);
 *            USER-04 (RLS direct-query requirement);
 *            03-PATTERNS.md §calendar-rls.test.ts (analog: rbac-matrix.test.ts);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 2 (migrations + RLS policies in `drizzle/0011_*.sql`) and
 * Wave 3 (tRPC `calendar.list` procedure) ship. The fixture helper
 * `seedCalendarFixtures` lives at `tests/fixtures/calendar-seed.ts` and
 * throws today by design — see the JSDoc there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from '../helpers/db';
import { seedRolesMatrix } from '../helpers/seed';
// Wave 1+ imports — keep commented to keep the test parsable today. Each
// it.todo flips to a real it() with these imports active in Wave 5.
//   import { seedCalendarFixtures } from '../fixtures/calendar-seed';
//   import { appCaller } from '../helpers/trpc';

const ROLES = [
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
] as const;
const EVENT_TYPES = [
  'event_type_training',
  'event_type_tournament',
  'event_type_meeting',
  'event_type_stage',
  'event_type_eval_conversation',
  'event_type_medical',
] as const;

describe('calendar RLS — 5 roles × 6 event types (D-50, USER-04)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  beforeAll(async () => {
    // RED: do not crash the suite if calendar tables do not yet exist. Wave 2
    // migrations introduce `calendar_events`, `calendar_event_participants`,
    // and `calendar_event_exceptions`. Until then we skip the heavyweight
    // setup and rely on it.todo to surface RED status.
    try {
      dbHandle = await freshDb();
      // Plant the role matrix as a smoke fixture; calendar-specific seeding
      // flips to seedCalendarFixtures(dbHandle.db, seeded.users) in Wave 5.
      await seedRolesMatrix(dbHandle.db);
    } catch {
      dbHandle = undefined;
    }
  });
  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  describe.each(ROLES)('role: %s', (_role) => {
    describe.each(EVENT_TYPES)('event type: %s', (_type) => {
      it.todo('returns the expected scope via tRPC list');
      it.todo('returns the expected scope via direct psql as app_user');
    });
  });

  // D-50 explicit no-op for sparring_partner in Phase 3 — separate
  // assertion so the planner can see it bypasses the role × type matrix.
  it.todo('sparring_partner sees ZERO events in Phase 3 (D-50 no-op until Phase 4 SPAR table)');
});
