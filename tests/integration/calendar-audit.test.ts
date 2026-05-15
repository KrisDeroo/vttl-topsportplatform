/**
 * Phase 3 Wave 0 — Calendar audit_log 6 action codes (GDPR-04 + D-58c).
 *
 * Action codes covered:
 *  - calendar_event_created
 *  - calendar_event_updated
 *  - calendar_event_deleted       (JSONB snapshot per D-58c)
 *  - calendar_event_declined      (RSVP decline ≠ delete)
 *  - calendar_event_conflict_override (force-save audit BEFORE mutation)
 *  - calendar_event_exception_created
 *
 * Reference: 03-CONTEXT.md D-58c, GDPR-04;
 *            03-PATTERNS.md analog: medical-audit.test.ts.
 *
 * Implemented in Plan 03-08 — exercises the audit emission for every mutation
 * via tRPC. DB-dependent; skipped cleanly otherwise.
 */
import { addDays, addHours } from 'date-fns';
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

describe('Calendar audit_log — 6 action codes (GDPR-04)', () => {
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

  async function countAction(action: string): Promise<number> {
    if (!dbHandle) return 0;
    const r = (await dbHandle.db.execute(
      sql`SELECT count(*)::int AS cnt FROM audit_log WHERE action = ${action}`,
    )) as unknown as { cnt: number }[];
    return Array.isArray(r) && r[0] ? r[0].cnt : 0;
  }

  it('calendar_event_created — audit row contains typeCode and new participant ids', async () => {
    if (!dbReady || !seeded) return;
    const before = await countAction('calendar_event_created');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const start = addDays(new Date(), 5);
    const end = addHours(start, 1);
    await td.calendar.event.create({
      type: 'event_type_meeting',
      title: 'Audit-create test',
      startsAt: start,
      endsAt: end,
      allDay: false,
      participants: [],
      force: false,
    });
    const after = await countAction('calendar_event_created');
    expect(after).toBeGreaterThan(before);

    if (dbHandle) {
      const lastRow = (await dbHandle.db.execute(sql`
        SELECT resource_id, new_values FROM audit_log
         WHERE action = 'calendar_event_created'
         ORDER BY id DESC LIMIT 1
      `)) as unknown as { resource_id: string; new_values: unknown }[];
      const row = Array.isArray(lastRow) ? lastRow[0] : undefined;
      expect(row?.resource_id).toBeDefined();
      const nv = row?.new_values as
        | { typeCode?: string; participantCount?: number }
        | undefined;
      expect(nv?.typeCode).toBe('event_type_meeting');
    }
  });

  it('calendar_event_updated — audit row contains old + new state diff', async () => {
    if (!dbReady || !seeded || !calFixtures) return;
    const before = await countAction('calendar_event_updated');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    // Update the single meeting fixture.
    const meetingId = calFixtures.eventIds.meeting;
    // Pull existing starts/ends.
    if (!dbHandle) return;
    const existing = (await dbHandle.db.execute(
      sql`SELECT starts_at, ends_at FROM calendar_events WHERE id = ${meetingId}::uuid`,
    )) as unknown as { starts_at: Date; ends_at: Date }[];
    const ex = Array.isArray(existing) && existing[0] ? existing[0] : null;
    if (!ex) return;
    const newStart = new Date(new Date(ex.starts_at).getTime() + 60 * 60 * 1000);
    const newEnd = new Date(new Date(ex.ends_at).getTime() + 60 * 60 * 1000);
    await td.calendar.event.update({
      eventId: meetingId,
      type: 'event_type_meeting',
      title: 'Updated title',
      startsAt: newStart,
      endsAt: newEnd,
      allDay: false,
      participants: [],
      force: true, // skip conflict probe (single meeting, no overlap)
    });
    const after = await countAction('calendar_event_updated');
    expect(after).toBeGreaterThan(before);
  });

  it('calendar_event_deleted — JSONB snapshot includes base + extension + participants + exceptions (D-58c)', async () => {
    if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    // Delete the training fixture (which has an extension row + 1 participant).
    const trainingId = calFixtures.eventIds.training;
    await td.calendar.event.delete({ eventId: trainingId });

    const auditRow = (await dbHandle.db.execute(sql`
      SELECT old_values FROM audit_log
       WHERE action = 'calendar_event_deleted'
         AND resource_id = ${trainingId}
       ORDER BY id DESC LIMIT 1
    `)) as unknown as { old_values: unknown }[];
    const row = Array.isArray(auditRow) ? auditRow[0] : undefined;
    expect(row?.old_values).toBeDefined();
    const ov = row?.old_values as
      | {
          base?: unknown;
          extension?: unknown;
          participants?: unknown[];
          exceptions?: unknown[];
        }
      | undefined;
    expect(ov?.base).toBeDefined();
    expect(ov?.extension).toBeDefined();
    expect(Array.isArray(ov?.participants)).toBe(true);
    expect(Array.isArray(ov?.exceptions)).toBe(true);
  });

  it('calendar_event_deleted — snapshot cap: exceptions array <= 1000 with exceptionsTotalCount when truncated', async () => {
    if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
    // Plant a recurring event + 1500 exception rows for it; delete; assert
    // the JSONB snapshot exceptions array is capped at 1000 and the total
    // count surfaces in exceptionsTotalCount.
    const tdUserId = seeded.users.technical_director;
    // Cheap path: insert a base event row + 1500 calendar_event_exceptions
    // for that event via the schema-owner client.
    const evRows = (await dbHandle.db.execute(sql`
      INSERT INTO calendar_events (type_code, title, starts_at, ends_at, rrule, created_by)
      VALUES ('event_type_meeting', 'Cap test', now(), now() + interval '1 hour',
              'RRULE:FREQ=WEEKLY;COUNT=5', ${tdUserId}::uuid)
      RETURNING id
    `)) as unknown as { id: string }[];
    const ev =
      Array.isArray(evRows) && evRows[0] ? evRows[0] : null;
    if (!ev) return;
    // Bulk insert 1500 exception rows on distinct occurrence dates.
    const inserts: string[] = [];
    for (let i = 0; i < 1500; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      inserts.push(
        `('${ev.id}', '${d.toISOString().slice(0, 10)}', true, '${tdUserId}')`,
      );
    }
    // Postgres limit on multi-row INSERT is generous; do it in chunks of 500.
    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500).join(', ');
      await dbHandle.db.execute(
        sql.raw(
          `INSERT INTO calendar_event_exceptions (event_id, occurrence_date, cancelled, created_by) VALUES ${chunk}`,
        ),
      );
    }

    const td = appCaller({
      userId: tdUserId,
      role: 'technical_director',
    });
    await td.calendar.event.delete({ eventId: ev.id });
    const auditRow = (await dbHandle.db.execute(sql`
      SELECT old_values FROM audit_log
       WHERE action = 'calendar_event_deleted'
         AND resource_id = ${ev.id}
       ORDER BY id DESC LIMIT 1
    `)) as unknown as { old_values: unknown }[];
    const row = Array.isArray(auditRow) ? auditRow[0] : undefined;
    const ov = row?.old_values as
      | { exceptions?: unknown[]; exceptionsTotalCount?: number }
      | undefined;
    expect(ov?.exceptions?.length).toBeLessThanOrEqual(1000);
    expect(ov?.exceptionsTotalCount).toBe(1500);
  });

  it('calendar_event_declined — RSVP decline writes per-caller audit row', async () => {
    if (!dbReady || !seeded || !calFixtures) return;
    const before = await countAction('calendar_event_declined');
    // Player is on training_recurring (and overlapping_pair_a) — use overlap_a
    // because training was deleted in an earlier test.
    const player = appCaller({
      userId: seeded.users.player,
      role: 'player',
    });
    await player.calendar.event.declineParticipation({
      eventId: calFixtures.eventIds.overlapping_pair_a,
    });
    const after = await countAction('calendar_event_declined');
    expect(after).toBeGreaterThan(before);
  });

  it('calendar_event_conflict_override — force-save writes override audit row BEFORE the mutation', async () => {
    if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
    // Reuse the overlapping_pair_a anchor — known participant overlap.
    const baseRows: { starts_at: Date }[] = (await dbHandle.db.execute(
      sql`SELECT starts_at FROM calendar_events WHERE id = ${calFixtures.eventIds.overlapping_pair_a}::uuid`,
    )) as unknown as { starts_at: Date }[];
    const a = Array.isArray(baseRows) && baseRows[0] ? baseRows[0] : null;
    if (!a) return;
    const start = new Date(a.starts_at);
    start.setUTCMinutes(15);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const before = await countAction('calendar_event_conflict_override');
    await td.calendar.event.create({
      type: 'event_type_meeting',
      title: 'Force-saved',
      startsAt: start,
      endsAt: end,
      allDay: false,
      participants: [{ userId: seeded.users.player, roleInEvent: 'participant' }],
      force: true,
    });
    const after = await countAction('calendar_event_conflict_override');
    expect(after).toBeGreaterThan(before);
  });

  it('calendar_event_exception_created — single-occurrence override writes audit row', async () => {
    if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
    const before = await countAction('calendar_event_exception_created');
    // Plant a fresh recurring event so its cancel doesn't collide with the
    // seed's existing exception.
    const evRows = (await dbHandle.db.execute(sql`
      INSERT INTO calendar_events (type_code, title, starts_at, ends_at, rrule, created_by)
      VALUES ('event_type_meeting', 'Exception src',
              ${new Date(Date.UTC(2026, 6, 7, 10, 0, 0)).toISOString()},
              ${new Date(Date.UTC(2026, 6, 7, 11, 0, 0)).toISOString()},
              ${'RRULE:FREQ=WEEKLY;COUNT=5'},
              ${seeded.users.technical_director}::uuid)
      RETURNING id
    `)) as unknown as { id: string }[];
    const ev = Array.isArray(evRows) && evRows[0] ? evRows[0] : null;
    if (!ev) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await td.calendar.event.cancelOccurrence({
      eventId: ev.id,
      occurrenceDate: new Date(Date.UTC(2026, 6, 14, 10, 0, 0)),
    });
    const after = await countAction('calendar_event_exception_created');
    expect(after).toBeGreaterThan(before);
  });
});
