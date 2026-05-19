/**
 * Phase 4 Wave 4 — training.markAttendanceAndScore (D-62, Pitfall 6).
 *
 * Covers D-62 single-form bulk upsert:
 *   - trainer submits a single mutation with rows
 *     {player_id, attendance, quality_score, feedback_text}
 *   - mutation uses ON CONFLICT DO UPDATE on
 *     (event_id, occurrence_date, user_id) per Pitfall 6 — race-safe for
 *     concurrent retries.
 *   - Audit code `training_attendance_marked` emitted on success.
 *
 * Analog: tests/integration/age-category-history.test.ts (Phase 2 atomic
 * multi-row upsert pattern).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

async function canConnect(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('stub')) return false;
  try {
    const h = await freshDb();
    await h[Symbol.asyncDispose]();
    return true;
  } catch {
    return false;
  }
}

describe('training.markAttendanceAndScore (D-62, Pitfall 6)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('happy path — trainer submits bulk upsert; session_participants rows match', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 8,
          feedbackText: 'Goede week',
        },
        {
          userId: seeded.extraUsers.playerA2,
          attended: true,
          qualityScore: 6,
          feedbackText: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(2);

    // Verify rows persisted.
    const rows = (await dbHandle.db.execute(sql`
      SELECT user_id::text, attended, quality_score, feedback_text
        FROM session_participants
       WHERE event_id = ${seeded.pastTrainingEventId}::uuid
         AND occurrence_date = ${seeded.pastTrainingOccurrenceDate}::date
       ORDER BY user_id
    `)) as unknown as Array<{
      user_id: string;
      attended: boolean | null;
      quality_score: number | null;
      feedback_text: string | null;
    }>;
    const arr = Array.isArray(rows) ? rows : [];
    expect(arr.length).toBe(2);
    const byId = new Map(arr.map((r) => [r.user_id, r]));
    expect(byId.get(seeded.users.player)?.quality_score).toBe(8);
    expect(byId.get(seeded.users.player)?.feedback_text).toBe('Goede week');
    expect(byId.get(seeded.extraUsers.playerA2)?.quality_score).toBe(6);
  });

  it('ON CONFLICT DO UPDATE — second submit overwrites the first (Pitfall 6)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    // First submit: score=8
    await trainer.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 8,
          feedbackText: 'first',
        },
      ],
    });
    // Second submit: score=10 — must overwrite without PK violation.
    const result = await trainer.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 10,
          feedbackText: 'second',
        },
      ],
    });
    expect(result.ok).toBe(true);

    const rows = (await dbHandle.db.execute(sql`
      SELECT quality_score, feedback_text FROM session_participants
       WHERE event_id = ${seeded.pastTrainingEventId}::uuid
         AND occurrence_date = ${seeded.pastTrainingOccurrenceDate}::date
         AND user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{
      quality_score: number;
      feedback_text: string;
    }>;
    const arr = Array.isArray(rows) ? rows : [];
    expect(arr.length).toBe(1);
    expect(arr[0]?.quality_score).toBe(10);
    expect(arr[0]?.feedback_text).toBe('second');
  });

  it('emits audit code training_attendance_marked on success', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'training_attendance_marked'
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(before) ? (before[0]?.c ?? 0) : 0;

    await trainer.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 9,
          feedbackText: null,
        },
      ],
    });

    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'training_attendance_marked'
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('non-session-trainer is rejected with errors.training.notSessionTrainer', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a session owned by a NEW trainer; the role-matrix trainer
    // cannot score it.
    const otherTrainerId = randomUUID();
    await dbHandle.db.execute(sql`
      INSERT INTO users (id, email, name, role, preferred_locale,
                          date_of_birth, active, email_verified)
      VALUES (
        ${otherTrainerId}::uuid, 'seed-phase4-other-trainer@vttl.test',
        'Phase4 Other Trainer', 'trainer', 'nl',
        '1990-01-01', true, true
      )
      ON CONFLICT (email) DO NOTHING
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO trainers (user_id, first_name, last_name)
      VALUES (${otherTrainerId}::uuid, 'Other', 'Trainer')
      ON CONFLICT (user_id) DO NOTHING
    `);

    const eventId = randomUUID();
    const endsAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 90 * 60 * 1000);
    const occurrenceDate = startsAt.toISOString().slice(0, 10);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (
        ${eventId}::uuid, 'event_type_training', 'Other-trainer session',
        ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
        ${seeded.users.technical_director}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO training_sessions
        (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
      VALUES (
        ${eventId}::uuid, 90,
        'training_type_group', 'org_academy', ${otherTrainerId}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
      VALUES (${eventId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
    `);

    // Role-matrix trainer tries to score the OTHER trainer's session.
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.training.markAttendanceAndScore({
        eventId,
        occurrenceDate: new Date(occurrenceDate),
        participants: [
          {
            userId: seeded.users.player,
            attended: true,
            qualityScore: 6,
            feedbackText: null,
          },
        ],
      }),
    ).rejects.toThrow(/notSessionTrainer/);
  });

  it('TD bypasses the trainer-ownership check (D-62 + D-75 unconditional)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 7,
          feedbackText: 'TD comment',
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
