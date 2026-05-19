/**
 * Integration test: editRecurring all_in_series past-immutable (CR-05).
 *
 * D-83 invariant — past data is immutable across all 3 edit scopes.
 *   - `single` enforces it via the splitDate < today guard (Plan 04-06).
 *   - `this_and_future` enforces it via the splitDate < today guard
 *     (Plan 04-06 + Plan 04-10's writeAuditOutsideTx for denied-audit).
 *   - `all_in_series` did NOT enforce it (CR-05 gap). This plan adds
 *     the same Brussels-anchored past-startsAt guard with a parallel
 *     denied-audit via writeAuditOutsideTx so the forensic record
 *     survives rollback.
 *
 * Note on fixtures:
 *   phase4-seed.ts does NOT plant a recurring training event — it only
 *   plants `pastTrainingEventId` (non-recurring, 8d ago, NULL scores).
 *   This test plants its own weekly recurring fixture in beforeAll with
 *   a deterministic dtstart 21 days ago.
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[2]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-05
 *            src/server/trpc/routers/calendar.ts editRecurring all_in_series branch
 */
import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db as rawDb } from '@/server/db/client';

import { canConnect, freshDb } from './_helpers';
import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

const dbReady = await canConnect();
const d = describe.skipIf(!dbReady);

d('editRecurring all_in_series past-immutable (CR-05)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;
  let recurringTrainingEventId: string;

  beforeAll(async () => {
    if (!dbReady) return;
    dbHandle = await freshDb();
    fixtures = await seedPhase4(dbHandle.db, { includeNullScores: true });

    // Plant our own recurring training event.
    //   - dtstart = 21 days ago at 16:00 UTC (≈ 18:00 CEST / 17:00 CET).
    //   - FREQ=WEEKLY;BYDAY=TU — three past occurrences (wk1, wk2, wk3)
    //     plus ongoing future occurrences.
    //   - The all_in_series tests target the BASE startsAt mutation only;
    //     they don't care about session_participants on the historical
    //     occurrences (D-83 contract: those rows stay untouched regardless).
    recurringTrainingEventId = randomUUID();
    const dtstart = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    dtstart.setUTCHours(16, 0, 0, 0);
    const dtend = new Date(dtstart.getTime() + 90 * 60 * 1000);

    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, rrule, created_by)
      VALUES (
        ${recurringTrainingEventId}::uuid,
        'event_type_training',
        'CR-05 recurring fixture',
        ${dtstart.toISOString()},
        ${dtend.toISOString()},
        false,
        'FREQ=WEEKLY;BYDAY=TU',
        ${fixtures.users.technical_director}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO training_sessions
        (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
      VALUES (
        ${recurringTrainingEventId}::uuid, 90,
        'training_type_group', 'org_academy',
        ${fixtures.users.trainer}::uuid
      )
    `);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('all_in_series with past startsAt → FORBIDDEN errors.calendar.cannotMoveSeriesToPast', async () => {
    if (!dbReady || !fixtures) return;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    await expect(
      caller.calendar.event.editRecurring({
        eventId: recurringTrainingEventId,
        scope: 'all_in_series',
        edits: {
          startsAt: yesterday,
          endsAt: new Date(yesterday.getTime() + 60 * 60 * 1000),
        },
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'errors.calendar.cannotMoveSeriesToPast',
    });
  });

  it('all_in_series with future startsAt → ok', async () => {
    if (!dbReady || !fixtures) return;
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    const res = await caller.calendar.event.editRecurring({
      eventId: recurringTrainingEventId,
      scope: 'all_in_series',
      edits: {
        startsAt: inThreeDays,
        endsAt: new Date(inThreeDays.getTime() + 60 * 60 * 1000),
      },
    });
    expect(res.ok).toBe(true);
  });

  it('all_in_series without startsAt edit → ok (past-check only fires when startsAt is supplied)', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    const res = await caller.calendar.event.editRecurring({
      eventId: recurringTrainingEventId,
      scope: 'all_in_series',
      edits: { title: 'Renamed Training Series' },
    });
    expect(res.ok).toBe(true);
  });

  it('all_in_series past-startsAt denied audit survives rollback (CR-01 + CR-05 cross-check)', async () => {
    if (!dbReady || !fixtures) return;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    try {
      await caller.calendar.event.editRecurring({
        eventId: recurringTrainingEventId,
        scope: 'all_in_series',
        edits: {
          startsAt: yesterday,
          endsAt: new Date(yesterday.getTime() + 60 * 60 * 1000),
        },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
    }
    // The denied audit row must exist post-rollback. writeAuditOutsideTx
    // strips ctx.db so the audit INSERT goes against the rawDb pool, not
    // the failing tx — proving the forensic record is durable.
    const rows = await rawDb.execute<{
      outcome: string;
      new_values: unknown;
    }>(sql`
      SELECT outcome, new_values FROM audit_log
      WHERE action = 'calendar_event_recurring_updated_all'
        AND actor_user_id = ${fixtures.users.technical_director}::uuid
        AND resource_id = ${recurringTrainingEventId}::uuid
        AND outcome = 'denied'
      ORDER BY occurred_at DESC LIMIT 1
    `);
    const arr: Array<{ outcome: string; new_values: unknown }> = Array.isArray(
      rows,
    )
      ? (rows as Array<{ outcome: string; new_values: unknown }>)
      : ((rows as unknown as {
          rows?: Array<{ outcome: string; new_values: unknown }>;
        }).rows ?? []);
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0]?.outcome).toBe('denied');
  });
});
