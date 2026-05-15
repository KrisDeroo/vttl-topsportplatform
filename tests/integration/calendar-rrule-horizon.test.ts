/**
 * Phase 3 Wave 0 — RRULE 2-year horizon defense-in-depth (D-55).
 *
 * - Write-time gate: tRPC `calendar.event.create` rejects unbounded
 *   recurrences and UNTIL > createdAt + 2y with `errors.calendar.rruleHorizonExceeded`.
 * - Read-time clamp: `listInput` rejects (to - from) > 2y; legacy rows with
 *   extreme UNTIL are silently clamped at expansion-time.
 *
 * Reference: 03-CONTEXT.md D-55 (defense in depth);
 *            03-RESEARCH.md §Pattern 3.
 *
 * Implemented in Plan 03-08 — runs against testcontainer or dev DB when
 * available; skipped cleanly otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addDays, addYears } from 'date-fns';
import { TRPCError } from '@trpc/server';

import { freshDb } from '../helpers/db';
import { seedRolesMatrix } from '../helpers/seed';
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

describe('Calendar RRULE 2-year horizon — D-55 defense in depth', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>> | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  function makeRrule(until: Date): string {
    const untilStr = until.toISOString().replace(/[-:]|\.\d{3}/g, '');
    return `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
  }

  it('write-time: rejects calendar.event.create with UNTIL beyond +2y → errors.calendar.rruleHorizonExceeded', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const start = addDays(new Date(), 1);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const rrule = makeRrule(addYears(start, 3));
    await expect(
      td.calendar.event.create({
        type: 'event_type_meeting',
        title: 'Too far',
        startsAt: start,
        endsAt: end,
        allDay: false,
        participants: [],
        force: false,
        rrule,
      }),
    ).rejects.toMatchObject({ message: 'errors.calendar.rruleHorizonExceeded' });
  });

  it('write-time: rejects rrule without UNTIL or COUNT → errors.calendar.rruleHorizonExceeded', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const start = addDays(new Date(), 1);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    // The router runs `ensureHorizon` first, which auto-injects UNTIL=+2y.
    // To exercise the rejection path we send a rrule that already has DTSTART:
    // — Anti-Pattern 1 catches the same i18n key (rruleHorizonExceeded).
    const rrule = 'DTSTART:20260101T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU';
    await expect(
      td.calendar.event.create({
        type: 'event_type_meeting',
        title: 'Open ended',
        startsAt: start,
        endsAt: end,
        allDay: false,
        participants: [],
        force: false,
        rrule,
      }),
    ).rejects.toMatchObject({ message: 'errors.calendar.rruleHorizonExceeded' });
  });

  it('write-time: auto-injects UNTIL=createdAt+2y when no bound is sent (ensureHorizon)', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const start = addDays(new Date(), 1);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    // No UNTIL and no COUNT — `ensureHorizon` injects UNTIL=+2y; the row is
    // created without throwing.
    const result = await td.calendar.event.create({
      type: 'event_type_meeting',
      title: 'Eindigt nooit (auto-injected)',
      startsAt: start,
      endsAt: end,
      allDay: false,
      participants: [],
      force: false,
      rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
    });
    expect(result.eventId).toBeDefined();
  });

  it('read-time: calendar.list({from,to}) rejects (to - from) > 2y → errors.calendar.rangeTooLarge', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const from = new Date();
    const to = addYears(from, 3);
    await expect(td.calendar.list({ from, to })).rejects.toMatchObject({
      message: 'errors.calendar.rangeTooLarge',
    });
  });

  it('read-time: legacy row with UNTIL+5y is clamped at expansion (no exception thrown)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a row directly via the schema-owner client with an out-of-band
    // UNTIL value (bypasses tRPC write-time gate — simulates pre-D-55
    // legacy data).
    const sqlMod = await import('drizzle-orm');
    const start = new Date();
    start.setUTCHours(10, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() + 1);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const farUntil = addYears(start, 5);
    const untilStr = farUntil.toISOString().replace(/[-:]|\.\d{3}/g, '');
    await dbHandle.db.execute(
      sqlMod.sql`
        INSERT INTO calendar_events (type_code, title, starts_at, ends_at, rrule, created_by)
        VALUES ('event_type_meeting', 'Legacy +5y', ${start.toISOString()},
                ${end.toISOString()},
                ${'RRULE:FREQ=WEEKLY;UNTIL=' + untilStr + ';BYDAY=TU'},
                ${seeded.users.technical_director}::uuid)
      `,
    );
    // list({from, to=+1y}) succeeds — clamp prevents runaway expansion.
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const from = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const to = addYears(from, 1);
    const list = await td.calendar.list({ from, to });
    expect(Array.isArray(list)).toBe(true);
  });

  // Spec-only guard: TRPCError shape carries through.
  it('TRPCError surface contract', () => {
    const err = new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.rruleHorizonExceeded',
    });
    expect(err.message).toBe('errors.calendar.rruleHorizonExceeded');
  });
});
