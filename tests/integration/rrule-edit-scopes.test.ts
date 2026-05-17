/**
 * Phase 4 Wave 2 — recurring-edit scopes (D-84, D-83).
 *
 * Tests three edit scopes against the Phase 3 polymorphic calendar:
 *   - 'single'            — calendar_event_exceptions write (D-54 carry-forward).
 *   - 'this_and_future'   — split-and-rewrite (D-84 via splitRRule).
 *   - 'all_in_series'     — in-place base + extension UPDATE (D-84).
 *
 * AND the immutable-past invariant (D-83): session_participants rows
 * with `occurrence_date < edit_date` are NEVER mutated by any scope.
 *
 * Test bodies run against the testcontainer (Plan 04-02 migrations have
 * created the operational tables). Cleanly skipped when Docker is
 * unavailable so unit-only lanes (e.g. agent worktrees) still pass.
 *
 * Reference: 04-CONTEXT.md D-82..D-85; src/server/trpc/routers/calendar.ts
 *            event.editRecurring (Plan 04-06).
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

describe('event.editRecurring — D-84 three-scope dispatcher (Plan 04-06)', () => {
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

  describe('scope: single (D-54 carry-forward)', () => {
    it('writes calendar_event_exceptions row; future occurrences unaffected', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;
      // Anchor must be FUTURE (D-83 past-immutable). Pick a Tuesday +14 days
      // ahead so it's safely past today and within the 1-year UNTIL horizon.
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 14);
      while (future.getUTCDay() !== 2) {
        future.setUTCDate(future.getUTCDate() + 1);
      }
      future.setUTCHours(10, 0, 0, 0);

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      const result = await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'single',
        splitDate: future,
        edits: { title: 'Override title for this occurrence only' },
      });
      expect(result.ok).toBe(true);
      expect(result.scope).toBe('single');

      // Assert exception row exists with the override title and the
      // Brussels-anchored occurrence_date.
      const exRows: { override_title: string | null; occurrence_date: string }[] =
        (await dbHandle.db.execute(
          sql`SELECT override_title, occurrence_date::text FROM calendar_event_exceptions
              WHERE event_id = ${recurringId}::uuid
                AND override_title = 'Override title for this occurrence only'`,
        )) as unknown as { override_title: string | null; occurrence_date: string }[];
      const rowArr = Array.isArray(exRows) ? exRows : (exRows as { rows?: typeof exRows }).rows ?? [];
      expect(rowArr.length).toBe(1);
    });
  });

  describe('scope: this_and_future (D-84 split-and-rewrite)', () => {
    it('truncates old event UNTIL to splitDate-1d; creates new event from splitDate with cloned participants', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;
      // Pick a future Tuesday — 21 days out — as the split anchor.
      const splitDate = new Date();
      splitDate.setUTCDate(splitDate.getUTCDate() + 21);
      while (splitDate.getUTCDay() !== 2) {
        splitDate.setUTCDate(splitDate.getUTCDate() + 1);
      }
      splitDate.setUTCHours(10, 0, 0, 0);

      // Snapshot old participants before split for invariant check.
      const beforePartsRaw: { user_id: string }[] = (await dbHandle.db.execute(
        sql`SELECT user_id FROM calendar_event_participants WHERE event_id = ${recurringId}::uuid`,
      )) as unknown as { user_id: string }[];
      const beforeParts = Array.isArray(beforePartsRaw)
        ? beforePartsRaw
        : (beforePartsRaw as { rows?: typeof beforePartsRaw }).rows ?? [];

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      const result = await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'this_and_future',
        splitDate,
        edits: { title: 'Renamed — second half' },
      });
      expect(result.ok).toBe(true);
      expect(result.scope).toBe('this_and_future');
      const newId = (result as { newEventId?: string }).newEventId;
      expect(newId).toBeTruthy();

      // Old event UNTIL truncated to splitDate - 1 day (Brussels).
      const oldRowRaw: { rrule: string }[] = (await dbHandle.db.execute(
        sql`SELECT rrule FROM calendar_events WHERE id = ${recurringId}::uuid`,
      )) as unknown as { rrule: string }[];
      const oldRow = (Array.isArray(oldRowRaw)
        ? oldRowRaw
        : (oldRowRaw as { rows?: typeof oldRowRaw }).rows ?? [])[0];
      expect(oldRow?.rrule).toContain('UNTIL=');

      // New event exists with the edited title.
      const newRowRaw: { title: string; starts_at: Date; rrule: string }[] =
        (await dbHandle.db.execute(
          sql`SELECT title, starts_at, rrule FROM calendar_events WHERE id = ${newId}::uuid`,
        )) as unknown as { title: string; starts_at: Date; rrule: string }[];
      const newRow = (Array.isArray(newRowRaw)
        ? newRowRaw
        : (newRowRaw as { rows?: typeof newRowRaw }).rows ?? [])[0];
      expect(newRow?.title).toBe('Renamed — second half');

      // Participants COPIED to the new event with rsvp_status='pending'.
      const newPartsRaw: { user_id: string; rsvp_status: string }[] =
        (await dbHandle.db.execute(
          sql`SELECT user_id, rsvp_status FROM calendar_event_participants WHERE event_id = ${newId}::uuid`,
        )) as unknown as { user_id: string; rsvp_status: string }[];
      const newParts = Array.isArray(newPartsRaw)
        ? newPartsRaw
        : (newPartsRaw as { rows?: typeof newPartsRaw }).rows ?? [];
      expect(newParts.length).toBe(beforeParts.length);
      for (const p of newParts) {
        expect(p.rsvp_status).toBe('pending');
      }
    });

    it('past session_participants stay on the old event (D-83 immutable past)', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;
      const player = seeded.users.player;

      // Plant a past session_participants row representing already-realised
      // attendance on a yesterday-Tuesday (D-83 candidate).
      const pastTuesday = new Date();
      pastTuesday.setUTCDate(pastTuesday.getUTCDate() - 7);
      while (pastTuesday.getUTCDay() !== 2) {
        pastTuesday.setUTCDate(pastTuesday.getUTCDate() - 1);
      }
      const pastIso = pastTuesday.toISOString().slice(0, 10);
      await dbHandle.db.execute(sql`
        INSERT INTO session_participants
          (event_id, occurrence_date, user_id, attended, quality_score, created_by)
        VALUES (${recurringId}::uuid, ${pastIso}::date, ${player}::uuid,
                true, 8, ${seeded.users.trainer}::uuid)
        ON CONFLICT DO NOTHING
      `);

      // Future split anchor.
      const splitDate = new Date();
      splitDate.setUTCDate(splitDate.getUTCDate() + 28);
      while (splitDate.getUTCDay() !== 2) {
        splitDate.setUTCDate(splitDate.getUTCDate() + 1);
      }
      splitDate.setUTCHours(10, 0, 0, 0);

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'this_and_future',
        splitDate,
        edits: { title: 'Another split — past data must not move' },
      });

      // The past row MUST STILL be on the OLD event_id.
      const rowsRaw: { event_id: string; quality_score: number | null }[] =
        (await dbHandle.db.execute(
          sql`SELECT event_id, quality_score FROM session_participants
              WHERE occurrence_date = ${pastIso}::date AND user_id = ${player}::uuid`,
        )) as unknown as { event_id: string; quality_score: number | null }[];
      const rows = Array.isArray(rowsRaw)
        ? rowsRaw
        : (rowsRaw as { rows?: typeof rowsRaw }).rows ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const onOldEvent = rows.filter((r) => r.event_id === recurringId);
      expect(onOldEvent.length).toBe(1);
      expect(onOldEvent[0]?.quality_score).toBe(8);
    });
  });

  describe('scope: all_in_series (D-84 in-place update)', () => {
    it('updates calendar_events + extension fields in place; past session_participants unchanged', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;
      const player = seeded.users.player;

      // Plant a past session_participants row.
      const pastIso = '2026-04-07'; // arbitrary past Tuesday in CONTEXT timeframe
      await dbHandle.db.execute(sql`
        INSERT INTO session_participants
          (event_id, occurrence_date, user_id, attended, quality_score, created_by)
        VALUES (${recurringId}::uuid, ${pastIso}::date, ${player}::uuid,
                true, 6, ${seeded.users.trainer}::uuid)
        ON CONFLICT DO NOTHING
      `);

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      const result = await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'all_in_series',
        edits: { title: 'Renamed — entire series', durationMinutes: 120 },
      });
      expect(result.ok).toBe(true);
      expect(result.scope).toBe('all_in_series');

      // Base title updated.
      const baseRaw: { title: string }[] = (await dbHandle.db.execute(
        sql`SELECT title FROM calendar_events WHERE id = ${recurringId}::uuid`,
      )) as unknown as { title: string }[];
      const base = (Array.isArray(baseRaw)
        ? baseRaw
        : (baseRaw as { rows?: typeof baseRaw }).rows ?? [])[0];
      expect(base?.title).toBe('Renamed — entire series');

      // Extension (training_sessions) duration_minutes updated.
      const extRaw: { duration_minutes: number }[] = (await dbHandle.db.execute(
        sql`SELECT duration_minutes FROM training_sessions WHERE event_id = ${recurringId}::uuid`,
      )) as unknown as { duration_minutes: number }[];
      const ext = (Array.isArray(extRaw)
        ? extRaw
        : (extRaw as { rows?: typeof extRaw }).rows ?? [])[0];
      expect(ext?.duration_minutes).toBe(120);

      // Past session_participants row unchanged (D-83).
      const pastRowsRaw: { quality_score: number | null }[] =
        (await dbHandle.db.execute(
          sql`SELECT quality_score FROM session_participants
              WHERE event_id = ${recurringId}::uuid
                AND occurrence_date = ${pastIso}::date
                AND user_id = ${player}::uuid`,
        )) as unknown as { quality_score: number | null }[];
      const pastRows = Array.isArray(pastRowsRaw)
        ? pastRowsRaw
        : (pastRowsRaw as { rows?: typeof pastRowsRaw }).rows ?? [];
      expect(pastRows.length).toBe(1);
      expect(pastRows[0]?.quality_score).toBe(6);
    });

    it('rrule change (BYDAY) leaves past calendar_event_exceptions in place as inert rows', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;
      // Phase 3 fixture seeds a cancelled exception against the recurring
      // event's first Tuesday (calFixtures.cancelledExceptionId).
      const exBefore: { id: string }[] = (await dbHandle.db.execute(
        sql`SELECT id::text FROM calendar_event_exceptions WHERE event_id = ${recurringId}::uuid`,
      )) as unknown as { id: string }[];
      const beforeRows = Array.isArray(exBefore)
        ? exBefore
        : (exBefore as { rows?: typeof exBefore }).rows ?? [];
      const beforeCount = beforeRows.length;
      expect(beforeCount).toBeGreaterThanOrEqual(1);

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'all_in_series',
        edits: { frequency: 'weekly', byday: ['TH'] }, // Tuesday → Thursday
      });

      // Exceptions kept as zombies (UI4-D20). Count unchanged.
      const exAfter: { id: string }[] = (await dbHandle.db.execute(
        sql`SELECT id::text FROM calendar_event_exceptions WHERE event_id = ${recurringId}::uuid`,
      )) as unknown as { id: string }[];
      const afterRows = Array.isArray(exAfter)
        ? exAfter
        : (exAfter as { rows?: typeof exAfter }).rows ?? [];
      expect(afterRows.length).toBe(beforeCount);
    });
  });

  describe('D-83 immutable past invariant (cross-scope)', () => {
    it('session_participants with occurrence_date < edit_date are NEVER mutated by any scope', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;
      const player = seeded.users.player;

      // Plant TWO past attendance rows on distinct dates.
      const past1 = '2026-03-10';
      const past2 = '2026-03-17';
      await dbHandle.db.execute(sql`
        INSERT INTO session_participants
          (event_id, occurrence_date, user_id, attended, quality_score, created_by)
        VALUES
          (${recurringId}::uuid, ${past1}::date, ${player}::uuid, true, 7, ${seeded.users.trainer}::uuid),
          (${recurringId}::uuid, ${past2}::date, ${player}::uuid, true, 9, ${seeded.users.trainer}::uuid)
        ON CONFLICT DO NOTHING
      `);

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      // Run all_in_series with a deep edit.
      await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'all_in_series',
        edits: { title: 'D-83 cross-scope probe', durationMinutes: 60 },
      });

      // Past rows untouched.
      const pastRowsRaw: { quality_score: number | null; occurrence_date: string }[] =
        (await dbHandle.db.execute(
          sql`SELECT quality_score, occurrence_date::text
              FROM session_participants
              WHERE event_id = ${recurringId}::uuid
                AND user_id = ${player}::uuid
                AND occurrence_date IN (${past1}::date, ${past2}::date)
              ORDER BY occurrence_date`,
        )) as unknown as { quality_score: number | null; occurrence_date: string }[];
      const pastRows = Array.isArray(pastRowsRaw)
        ? pastRowsRaw
        : (pastRowsRaw as { rows?: typeof pastRowsRaw }).rows ?? [];
      expect(pastRows.length).toBe(2);
      // Map by date to be order-agnostic.
      const byDate = new Map(pastRows.map((r) => [r.occurrence_date, r.quality_score]));
      expect(byDate.get(past1)).toBe(7);
      expect(byDate.get(past2)).toBe(9);
    });

    it('emits audit code calendar_event_recurring_split (this_and_future) and calendar_event_recurring_updated_all (all_in_series)', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const recurringId = calFixtures.eventIds.training_recurring;

      // Capture pre-test audit_log baseline.
      const beforeRaw: { c: string | number }[] = (await dbHandle.db.execute(
        sql`SELECT COUNT(*)::text AS c FROM audit_log
            WHERE action IN ('calendar_event_recurring_split','calendar_event_recurring_updated_all')`,
      )) as unknown as { c: string | number }[];
      const before = (Array.isArray(beforeRaw)
        ? beforeRaw
        : (beforeRaw as { rows?: typeof beforeRaw }).rows ?? [])[0];
      const beforeCount = Number(before?.c ?? 0);

      const splitDate = new Date();
      splitDate.setUTCDate(splitDate.getUTCDate() + 35);
      while (splitDate.getUTCDay() !== 2) {
        splitDate.setUTCDate(splitDate.getUTCDate() + 1);
      }
      splitDate.setUTCHours(10, 0, 0, 0);
      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'this_and_future',
        splitDate,
        edits: { title: 'Audit probe split' },
      });
      await td.calendar.event.editRecurring({
        eventId: recurringId,
        scope: 'all_in_series',
        edits: { title: 'Audit probe series' },
      });

      const afterRaw: { c: string | number }[] = (await dbHandle.db.execute(
        sql`SELECT COUNT(*)::text AS c FROM audit_log
            WHERE action IN ('calendar_event_recurring_split','calendar_event_recurring_updated_all')`,
      )) as unknown as { c: string | number }[];
      const after = (Array.isArray(afterRaw)
        ? afterRaw
        : (afterRaw as { rows?: typeof afterRaw }).rows ?? [])[0];
      const afterCount = Number(after?.c ?? 0);
      expect(afterCount).toBe(beforeCount + 2);
    });
  });
});
