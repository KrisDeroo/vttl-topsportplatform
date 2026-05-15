/**
 * Phase 3 Wave 0 — RSVP decline ≠ delete (D-58).
 *
 * Reference: 03-CONTEXT.md D-58 operation 2 (Ik kan niet aanwezig zijn);
 *            03-PATTERNS.md analog: consent.test.ts.
 *
 * Implemented in Plan 03-08. DB-dependent.
 */
import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedRolesMatrix } from '../helpers/seed';
import { appCaller } from '../helpers/trpc';
import { seedCalendarFixtures } from '../fixtures/calendar-seed';

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

describe('calendar.event.declineParticipation — D-58 RSVP decline', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>> | undefined;
  let calFixtures:
    | Awaited<ReturnType<typeof seedCalendarFixtures>>
    | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
    calFixtures = await seedCalendarFixtures(dbHandle.db, seeded.users);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('declineParticipation by participant updates own row to rsvp_status=declined', async () => {
    if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
    const player = appCaller({
      userId: seeded.users.player,
      role: 'player',
    });
    const eventId = calFixtures.eventIds.training;
    await player.calendar.event.declineParticipation({ eventId });

    const row = (await dbHandle.db.execute(sql`
      SELECT rsvp_status FROM calendar_event_participants
       WHERE event_id = ${eventId}::uuid AND user_id = ${seeded.users.player}::uuid
    `)) as unknown as { rsvp_status: string }[];
    const r = Array.isArray(row) && row[0] ? row[0] : null;
    expect(r?.rsvp_status).toBe('declined');
  });

  it('event still visible to other participants after decline', async () => {
    if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const eventId = calFixtures.eventIds.training;
    // The event row still exists (decline doesn't delete the event).
    const row = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM calendar_events WHERE id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(row) && row[0] ? row[0].cnt : 0).toBe(1);
    // TD sees it via list.
    const list = await td.calendar.list({
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(list.some((e: { id: string }) => e.id === eventId)).toBe(true);
  });

  it('mutation prevents declining another user (RSVP forgery prevention)', async () => {
    if (!dbReady || !seeded || !calFixtures) return;
    // Caller = trainer; eventId = training (player participates, trainer
    // doesn't). trainer has no participant row → NOT_FOUND.
    const trainer = appCaller({
      userId: seeded.users.trainer,
      role: 'trainer',
    });
    await expect(
      trainer.calendar.event.declineParticipation({
        eventId: calFixtures.eventIds.tournament, // no participant row for trainer
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
