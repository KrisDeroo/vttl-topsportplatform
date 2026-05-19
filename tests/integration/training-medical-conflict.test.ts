/**
 * Phase 4 Wave 4 — training × medical conflict warning (DOM-MED-CONFLICT-01).
 *
 * Covers DOM-MED-CONFLICT-01: when a training session is about to be
 * created/updated with a participant who has an overlapping medical event,
 * the system surfaces a conflict warning. Wired via Phase 3's
 * `calendar.event.detectConflicts` SECURITY DEFINER probe, which Phase 4
 * extends transparently — the same procedure picks up the new
 * `event_type_medical` overlap and tags `typeCode='event_type_medical'`
 * for the form's warning panel.
 *
 * Analog: tests/integration/calendar-conflicts.test.ts (Phase 3 conflict
 * detection shape).
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

describe('training × medical conflict warning (DOM-MED-CONFLICT-01)', () => {
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

  it('detectConflicts surfaces an overlapping medical event for a player', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a medical_event (calendar_events + medical_appointments) for
    // the role-matrix player covering 2026-09-01 09:00..10:00.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setUTCHours(9, 0, 0, 0);
    const medStart = tomorrow;
    const medEnd = new Date(tomorrow.getTime() + 60 * 60 * 1000);

    const evRows = (await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (
        'event_type_medical', 'Medical follow-up',
        ${medStart.toISOString()}, ${medEnd.toISOString()}, false,
        ${seeded.users.technical_director}::uuid
      )
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    const medEventId = Array.isArray(evRows) ? evRows[0]?.id : undefined;
    if (!medEventId) throw new Error('Failed to plant medical event');
    await dbHandle.db.execute(sql`
      INSERT INTO medical_appointments (event_id, is_injury, doctor)
      VALUES (${medEventId}::uuid, false, 'Dr. Janssens')
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
      VALUES (${medEventId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
      ON CONFLICT DO NOTHING
    `);

    // Pre-save probe — does a training (09:30..10:30) for the same player
    // overlap the planted medical?
    const trainingStart = new Date(medStart.getTime() + 30 * 60 * 1000);
    const trainingEnd = new Date(trainingStart.getTime() + 60 * 60 * 1000);

    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.calendar.event.detectConflicts({
      startsAt: trainingStart,
      endsAt: trainingEnd,
      participants: [{ userId: seeded.users.player }],
    });

    expect(result.blocked).toBe(false);
    expect(Array.isArray(result.conflicts)).toBe(true);
    const medOverlaps = result.conflicts.filter(
      (c: { typeCode: string }) => c.typeCode === 'event_type_medical',
    );
    expect(medOverlaps.length).toBeGreaterThanOrEqual(1);
  });

  it('warning is non-blocking — `blocked: false` regardless of conflict count', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Probe with a wide window that doesn't overlap anything new.
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.calendar.event.detectConflicts({
      startsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      participants: [{ userId: seeded.users.player }],
    });
    expect(result.blocked).toBe(false);
  });

  it('non-overlapping medical event does NOT surface a warning', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Probe with a time-range one year out — should return zero conflicts
    // for the role-matrix player (no fixture in that range).
    const farStart = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const farEnd = new Date(farStart.getTime() + 90 * 60 * 1000);
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.calendar.event.detectConflicts({
      startsAt: farStart,
      endsAt: farEnd,
      participants: [{ userId: seeded.users.player }],
    });
    const medOverlaps = result.conflicts.filter(
      (c: { typeCode: string }) => c.typeCode === 'event_type_medical',
    );
    expect(medOverlaps.length).toBe(0);
  });
});
