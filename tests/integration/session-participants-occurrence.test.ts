/**
 * Phase 4 Wave 4 — session_participants per-occurrence PK (D-82).
 *
 * Covers D-82: session_participants PK is (event_id, occurrence_date, user_id)
 * — each occurrence of a recurring training has its own attendance/score
 * row. Corrects Phase 3 D-51's sketch which omitted occurrence_date.
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (Phase 3 D-54
 * (event_id, occurrence_date) UNIQUE constraint).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';

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

describe('session_participants — per-occurrence PK (D-82)', () => {
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

  it('two rows: (event_id, 2026-03-10, user) and (event_id, 2026-03-17, user) coexist', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const eventId = seeded.calendar.eventIds.training_recurring;
    const userId = seeded.users.player;
    await dbHandle.db.execute(sql`
      INSERT INTO session_participants
        (event_id, occurrence_date, user_id, attended, quality_score, created_by)
      VALUES
        (${eventId}::uuid, '2026-03-10'::date, ${userId}::uuid, true, 7, ${seeded.users.trainer}::uuid),
        (${eventId}::uuid, '2026-03-17'::date, ${userId}::uuid, true, 8, ${seeded.users.trainer}::uuid)
      ON CONFLICT DO NOTHING
    `);
    const rows = (await dbHandle.db.execute(sql`
      SELECT occurrence_date::text AS d, quality_score
        FROM session_participants
       WHERE event_id = ${eventId}::uuid
         AND user_id = ${userId}::uuid
         AND occurrence_date IN ('2026-03-10'::date, '2026-03-17'::date)
       ORDER BY occurrence_date
    `)) as unknown as Array<{ d: string; quality_score: number }>;
    const arr = Array.isArray(rows) ? rows : [];
    expect(arr.length).toBe(2);
    expect(arr[0]?.quality_score).toBe(7);
    expect(arr[1]?.quality_score).toBe(8);
  });

  it('duplicate PK: inserting (event, date, user) twice without ON CONFLICT raises 23505', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const eventId = seeded.calendar.eventIds.training_recurring;
    const userId = seeded.users.player;
    // First insert succeeds (ON CONFLICT DO NOTHING).
    await dbHandle.db.execute(sql`
      INSERT INTO session_participants
        (event_id, occurrence_date, user_id, attended, quality_score, created_by)
      VALUES (${eventId}::uuid, '2026-04-07'::date, ${userId}::uuid, true, 6, ${seeded.users.trainer}::uuid)
      ON CONFLICT DO NOTHING
    `);
    // Second insert WITHOUT ON CONFLICT should fail.
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO session_participants
          (event_id, occurrence_date, user_id, attended, quality_score, created_by)
        VALUES (${eventId}::uuid, '2026-04-07'::date, ${userId}::uuid, true, 9, ${seeded.users.trainer}::uuid)
      `),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('quality_score nullable (attendance-only path)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const eventId = seeded.calendar.eventIds.training_recurring;
    const userId = seeded.users.player;
    await dbHandle.db.execute(sql`
      INSERT INTO session_participants
        (event_id, occurrence_date, user_id, attended, quality_score, created_by)
      VALUES (${eventId}::uuid, '2026-05-05'::date, ${userId}::uuid, true, NULL, ${seeded.users.trainer}::uuid)
      ON CONFLICT DO NOTHING
    `);
    const rows = (await dbHandle.db.execute(sql`
      SELECT quality_score FROM session_participants
       WHERE event_id = ${eventId}::uuid
         AND occurrence_date = '2026-05-05'::date
         AND user_id = ${userId}::uuid
    `)) as unknown as Array<{ quality_score: number | null }>;
    const arr = Array.isArray(rows) ? rows : [];
    expect(arr.length).toBe(1);
    expect(arr[0]?.quality_score).toBeNull();
  });

  it('feedback_text CHECK rejects > 2000 chars', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const eventId = seeded.calendar.eventIds.training_recurring;
    const userId = seeded.users.player;
    const oversize = 'x'.repeat(2001);
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO session_participants
          (event_id, occurrence_date, user_id, attended, quality_score, feedback_text, created_by)
        VALUES (${eventId}::uuid, '2026-05-12'::date, ${userId}::uuid, true, 6, ${oversize}, ${seeded.users.trainer}::uuid)
      `),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('FK event_id → calendar_events.id with ON DELETE CASCADE', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Use a fresh event so we can delete it without disturbing other fixtures.
    const ev = (await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (
        'event_type_training', 'Cascade-test training',
        ${new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()},
        ${new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000).toISOString()},
        false, ${seeded.users.technical_director}::uuid
      )
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    const rows = Array.isArray(ev) ? ev : [];
    const evId = rows[0]?.id;
    if (!evId) throw new Error('Failed to plant cascade-test event');
    await dbHandle.db.execute(sql`
      INSERT INTO training_sessions
        (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
      VALUES (${evId}::uuid, 90, 'training_type_group', 'org_academy', ${seeded.users.trainer}::uuid)
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO session_participants
        (event_id, occurrence_date, user_id, attended, quality_score, created_by)
      VALUES (${evId}::uuid, '2026-04-01'::date, ${seeded.users.player}::uuid, true, 6, ${seeded.users.trainer}::uuid)
    `);
    // DELETE the event — session_participants row must cascade.
    await dbHandle.db.execute(sql`DELETE FROM calendar_events WHERE id = ${evId}::uuid`);
    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM session_participants
       WHERE event_id = ${evId}::uuid
    `)) as unknown as Array<{ c: number }>;
    const c = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(c).toBe(0);
  });
});
