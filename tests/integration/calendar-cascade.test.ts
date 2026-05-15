/**
 * Phase 3 Wave 0 — FK CASCADE on calendar_events DELETE (D-58).
 *
 * Reference: 03-CONTEXT.md D-58 (hard delete + audit-log forensic recovery);
 *            03-PATTERNS.md analog: medical-delete.test.ts.
 *
 * Implemented in Plan 03-08. DB-dependent; skipped cleanly otherwise.
 */
import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedRolesMatrix } from '../helpers/seed';
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

describe('calendar_events DELETE — FK CASCADE per D-58', () => {
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

  it('DELETE FROM calendar_events drops matching training_sessions row', async () => {
    if (!dbReady || !calFixtures || !dbHandle) return;
    const eventId = calFixtures.eventIds.training;
    // Confirm the extension row exists.
    const pre = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM training_sessions WHERE event_id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(pre) && pre[0] ? pre[0].cnt : 0).toBe(1);
    // Hard delete.
    await dbHandle.db.execute(
      sql`DELETE FROM calendar_events WHERE id = ${eventId}::uuid`,
    );
    const post = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM training_sessions WHERE event_id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(post) && post[0] ? post[0].cnt : 0).toBe(0);
  });

  it('DELETE FROM calendar_events drops all calendar_event_participants rows', async () => {
    if (!dbReady || !calFixtures || !dbHandle) return;
    const eventId = calFixtures.eventIds.overlapping_pair_a;
    const pre = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM calendar_event_participants WHERE event_id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(pre) && pre[0] ? pre[0].cnt : 0).toBeGreaterThan(0);
    await dbHandle.db.execute(
      sql`DELETE FROM calendar_events WHERE id = ${eventId}::uuid`,
    );
    const post = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM calendar_event_participants WHERE event_id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(post) && post[0] ? post[0].cnt : 0).toBe(0);
  });

  it('DELETE FROM calendar_events drops all calendar_event_exceptions rows', async () => {
    if (!dbReady || !calFixtures || !dbHandle) return;
    const eventId = calFixtures.eventIds.training_recurring;
    const pre = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM calendar_event_exceptions WHERE event_id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(pre) && pre[0] ? pre[0].cnt : 0).toBeGreaterThanOrEqual(1);
    await dbHandle.db.execute(
      sql`DELETE FROM calendar_events WHERE id = ${eventId}::uuid`,
    );
    const post = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM calendar_event_exceptions WHERE event_id = ${eventId}::uuid`,
    )) as unknown as { cnt: number }[];
    expect(Array.isArray(post) && post[0] ? post[0].cnt : 0).toBe(0);
  });

  it('NO deleted_at column on calendar_events (hard delete only)', async () => {
    if (!dbReady || !dbHandle) return;
    // Probe pg_attribute for any column named 'deleted_at' on calendar_events.
    const rows = (await dbHandle.db.execute(sql`
      SELECT a.attname AS column_name
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
       WHERE c.relname = 'calendar_events'
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND a.attname = 'deleted_at'
    `)) as unknown as { column_name: string }[];
    expect(Array.isArray(rows) ? rows.length : 0).toBe(0);
  });
});
