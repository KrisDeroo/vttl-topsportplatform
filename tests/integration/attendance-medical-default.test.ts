/**
 * Phase 4 Wave 4 — medical-aware attendance default (DOM-MED-CONFLICT-02).
 *
 * Covers DOM-MED-CONFLICT-02: when training.getSession is called for a
 * session whose time range overlaps a participant's medical event,
 * the response surfaces `hasMedicalConflict: true` for that participant
 * — the form uses that flag to pre-fill attendance to "absentMedical"
 * (a UI concern; the API surface is the flag).
 *
 * Wired via the SECURITY DEFINER `overlapping_events_for_users()` helper
 * (Phase 3) which the training.getSession handler invokes (see
 * `src/server/trpc/routers/training.ts` step 4 in the getSession comment).
 *
 * Analog: tests/integration/calendar-conflicts.test.ts.
 */
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

describe('attendance default on medical overlap (DOM-MED-CONFLICT-02)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);

    // Plant a medical event covering the past training session's time-range
    // for the role-matrix player. The session is 8 days ago — the medical
    // event must overlap that window.
    if (dbHandle && seeded) {
      // Look up the actual past-training starts/ends from the canonical seed.
      const sessRows = (await dbHandle.db.execute(sql`
        SELECT starts_at, ends_at FROM calendar_events
         WHERE id = ${seeded.pastTrainingEventId}::uuid
      `)) as unknown as Array<{ starts_at: Date; ends_at: Date }>;
      const sess = Array.isArray(sessRows) ? sessRows[0] : undefined;
      if (!sess) throw new Error('past-training fixture missing');

      const medStart = new Date(sess.starts_at.getTime() - 15 * 60 * 1000);
      const medEnd = new Date(sess.ends_at.getTime() + 15 * 60 * 1000);

      const evRows = (await dbHandle.db.execute(sql`
        INSERT INTO calendar_events
          (type_code, title, starts_at, ends_at, all_day, created_by)
        VALUES (
          'event_type_medical', 'Knee follow-up (overlap)',
          ${medStart.toISOString()}, ${medEnd.toISOString()}, false,
          ${seeded.users.technical_director}::uuid
        )
        RETURNING id::text
      `)) as unknown as Array<{ id: string }>;
      const medEventId = Array.isArray(evRows) ? evRows[0]?.id : undefined;
      if (!medEventId) throw new Error('Failed to plant overlapping medical');
      await dbHandle.db.execute(sql`
        INSERT INTO medical_appointments (event_id, is_injury, doctor)
        VALUES (${medEventId}::uuid, true, 'Dr. Phase4')
      `);
      await dbHandle.db.execute(sql`
        INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
        VALUES (${medEventId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
        ON CONFLICT DO NOTHING
      `);
    }
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('player with overlapping medical event has hasMedicalConflict=true in getSession', async () => {
    if (!dbReady || !seeded) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.training.getSession({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
    });
    const player = (result.participants as Array<{
      userId: string;
      hasMedicalConflict: boolean;
    }>).find((p) => p.userId === seeded?.users.player);
    expect(player?.hasMedicalConflict).toBe(true);
  });

  it('player without overlapping medical event has hasMedicalConflict=false (no default)', async () => {
    if (!dbReady || !seeded) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.training.getSession({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
    });
    // playerA2 has no medical event in seedPhase4 → hasMedicalConflict=false.
    const playerA2 = (result.participants as Array<{
      userId: string;
      hasMedicalConflict: boolean;
    }>).find((p) => p.userId === seeded?.extraUsers.playerA2);
    expect(playerA2?.hasMedicalConflict).toBe(false);
  });

  it('trainer can still submit attendance=true (override the default) — captured by markAttendanceAndScore', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // The default is a UI concern; the server accepts any tri-state attended
    // value submitted by the trainer. We confirm the override path here.
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true, // trainer overrides the UI's "absent_medical" default
          qualityScore: 7,
          feedbackText: 'Speelde toch ondanks medische zorg',
        },
      ],
    });
    expect(result.ok).toBe(true);

    // Verify row persisted with attended=true.
    const rows = (await dbHandle.db.execute(sql`
      SELECT attended FROM session_participants
       WHERE event_id = ${seeded.pastTrainingEventId}::uuid
         AND occurrence_date = ${seeded.pastTrainingOccurrenceDate}::date
         AND user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ attended: boolean }>;
    const arr = Array.isArray(rows) ? rows : [];
    expect(arr[0]?.attended).toBe(true);
  });
});
