/**
 * Integration test: denied-outcome audit rows survive transaction rollback.
 *
 * Verifies CR-01 fix (Phase 4 VERIFICATION.md gaps[0]):
 * writeAuditOutsideTx commits the audit row on the raw pool, not on the
 * failing withRlsContext transaction. After the TRPCError throws and the
 * tx rolls back, the audit_log row remains queryable.
 *
 * 4 paths probed:
 *   1. training.markAttendanceAndScore — D-64 14d wall rejection
 *      → 'training_score_window_expired_attempt' / outcome='denied'
 *   2. tournament.enterResult — D-71 14d wall rejection
 *      → 'tournament_entry_window_expired_attempt' / outcome='denied'
 *   3. calendar.event.editRecurring scope='single' — D-83 past-immutable
 *      → 'calendar_event_exception_created' / outcome='denied'
 *   4. calendar.event.editRecurring scope='this_and_future' — D-83 past-immutable
 *      → 'calendar_event_recurring_split' / outcome='denied'
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[0]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-01
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

d('denied-audit-survives-rollback', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;
  // Test-owned recurring event for the calendar branches (NOT in phase4-seed).
  let recurringTrainingEventId: string;

  beforeAll(async () => {
    if (!dbReady) return;
    dbHandle = await freshDb();
    fixtures = await seedPhase4(dbHandle.db, {
      includeNullScores: true,
      includeTournamentResults: false,
    });

    // Plant our own recurring training event for the editRecurring probes.
    // dtstart = 21 days ago, rrule = weekly. This gives the
    // calendar.editRecurring 'single' + 'this_and_future' branches a target
    // they can probe with splitDate = yesterday → past-immutable trigger.
    recurringTrainingEventId = randomUUID();
    const dtstart = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    dtstart.setUTCHours(16, 0, 0, 0); // 16:00 UTC = 18:00 CEST / 17:00 CET
    const dtend = new Date(dtstart.getTime() + 90 * 60 * 1000);

    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, rrule, created_by)
      VALUES (
        ${recurringTrainingEventId}::uuid,
        'event_type_training',
        'CR-01 recurring fixture',
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

  it('training: 14d wall rejection audit survives rollback', async () => {
    if (!dbReady || !fixtures || !dbHandle) return;
    // Use the past-training event seeded as 8d ago BUT mutate
    // calendar_events.ends_at to 15 days ago so the wall is expired.
    // Direct SQL via the schema-owner Drizzle handle.
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await dbHandle.db.execute(sql`
      UPDATE calendar_events
      SET ends_at = ${fifteenDaysAgo.toISOString()}
      WHERE id = ${fixtures.pastTrainingEventId}::uuid
    `);

    const caller = appCaller({
      userId: fixtures.users.trainer,
      role: 'trainer',
    });
    await expect(
      caller.training.markAttendanceAndScore({
        eventId: fixtures.pastTrainingEventId,
        occurrenceDate: new Date(fixtures.pastTrainingOccurrenceDate),
        participants: [
          {
            userId: fixtures.users.player,
            attended: true,
            qualityScore: 8,
            feedbackText: null,
          },
        ],
        _meta: {
          idempotencyKey: 'test-denied-audit-training-' + Date.now(),
        },
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    // Audit row must exist post-rollback. audit_log SELECT policy is
    // USING (false) for app_user, so query via the schema-owner Drizzle
    // handle (rawDb singleton bypasses RLS by design).
    const rows = await rawDb.execute<{
      action: string;
      outcome: string;
      actor_user_id: string;
      resource_id: string;
    }>(sql`
      SELECT action, outcome, actor_user_id::text, resource_id::text
      FROM audit_log
      WHERE action = 'training_score_window_expired_attempt'
        AND actor_user_id = ${fixtures.users.trainer}::uuid
        AND resource_id = ${fixtures.pastTrainingEventId}::uuid
        AND outcome = 'denied'
      ORDER BY occurred_at DESC
      LIMIT 1
    `);
    const arr = Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows?: unknown[] }).rows ?? []);
    expect(arr.length).toBe(1);
  });

  it('tournament: 14d wall rejection audit survives rollback', async () => {
    if (!dbReady || !fixtures || !dbHandle) return;
    // Push tournament.ends_at to 15 days ago.
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await dbHandle.db.execute(sql`
      UPDATE calendar_events
      SET ends_at = ${fifteenDaysAgo.toISOString()}
      WHERE id = ${fixtures.pastTournamentEventId}::uuid
    `);

    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    await expect(
      caller.tournament.enterResult({
        tournamentEventId: fixtures.pastTournamentEventId,
        playerUserId: fixtures.users.player,
        outcome: 'outcome_last_64',
        matches: [
          {
            round: 'round_round_of_64',
            opponent: 'Test Opponent',
            opponentRanking: null,
            matchDate: fifteenDaysAgo,
            setsWon: 1,
            setsLost: 3,
            videoLink: null,
          },
        ],
        _meta: {
          idempotencyKey: 'test-denied-audit-tournament-' + Date.now(),
        },
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const rows = await rawDb.execute<{ action: string; outcome: string }>(sql`
      SELECT action, outcome FROM audit_log
      WHERE action = 'tournament_entry_window_expired_attempt'
        AND actor_user_id = ${fixtures.users.player}::uuid
        AND resource_id = ${fixtures.pastTournamentEventId}::uuid
        AND outcome = 'denied'
      LIMIT 1
    `);
    const arr = Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows?: unknown[] }).rows ?? []);
    expect(arr.length).toBe(1);
  });

  it('calendar: editRecurring single past-immutable audit survives rollback', async () => {
    if (!dbReady || !fixtures) return;
    // Use the test-owned recurringTrainingEventId planted in beforeAll.
    // editRecurring with scope='single' + splitDate = yesterday triggers
    // the past-immutable guard at calendar.ts:1738.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    await expect(
      caller.calendar.event.editRecurring({
        eventId: recurringTrainingEventId,
        scope: 'single',
        splitDate: yesterday,
        edits: { title: 'modified' },
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const rows = await rawDb.execute<{ action: string; outcome: string }>(sql`
      SELECT action, outcome FROM audit_log
      WHERE action = 'calendar_event_exception_created'
        AND actor_user_id = ${fixtures.users.technical_director}::uuid
        AND resource_id = ${recurringTrainingEventId}::uuid
        AND outcome = 'denied'
      ORDER BY occurred_at DESC LIMIT 1
    `);
    const arr = Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows?: unknown[] }).rows ?? []);
    expect(arr.length).toBe(1);
  });

  it('calendar: editRecurring this_and_future past-immutable audit survives rollback', async () => {
    if (!dbReady || !fixtures) return;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    await expect(
      caller.calendar.event.editRecurring({
        eventId: recurringTrainingEventId,
        scope: 'this_and_future',
        splitDate: yesterday,
        edits: { title: 'modified' },
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const rows = await rawDb.execute<{ action: string; outcome: string }>(sql`
      SELECT action, outcome FROM audit_log
      WHERE action = 'calendar_event_recurring_split'
        AND actor_user_id = ${fixtures.users.technical_director}::uuid
        AND resource_id = ${recurringTrainingEventId}::uuid
        AND outcome = 'denied'
      ORDER BY occurred_at DESC LIMIT 1
    `);
    const arr = Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows?: unknown[] }).rows ?? []);
    expect(arr.length).toBe(1);
  });
});
