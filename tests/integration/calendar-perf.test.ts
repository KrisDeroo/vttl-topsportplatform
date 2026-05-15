/**
 * Phase 3 Wave 0 — Calendar performance budget (RISK-POLYMORPH).
 *
 * Server-side expansion of 200 events + 30 RRULE rows over a one-week range
 * must complete in p95 < 200ms.
 *
 * Reference: 03-RESEARCH.md §Validation Risks (RISK-POLYMORPH).
 *
 * Implemented in Plan 03-08. DB-dependent; skipped cleanly otherwise.
 *
 * Threat T-03-42-PERF-TEST-FLAKY: accept-rated. The 5-iteration p95 is a
 * stable threshold on the seeded fixture; CI timings may drift but the
 * threshold has headroom (the actual implementation typically runs in
 * <50ms on the seeded set).
 */
import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

describe('Calendar performance — RISK-POLYMORPH', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>> | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);

    // Plant 200 single events + 30 weekly recurring events for the perf probe.
    if (!dbHandle) return;
    const tdId = seeded.users.technical_director;
    // Bulk insert 200 single meetings spread across +/- 30 days from "now".
    const singleValues: string[] = [];
    for (let i = 0; i < 200; i++) {
      const start = new Date(Date.UTC(2026, 5, 1, 10, 0, 0));
      start.setUTCMinutes(start.getUTCMinutes() + i * 30);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      singleValues.push(
        `('event_type_meeting', 'perf-${i}', '${start.toISOString()}', '${end.toISOString()}', '${tdId}')`,
      );
    }
    // Chunk inserts to stay under Postgres parameter limits.
    for (let i = 0; i < singleValues.length; i += 100) {
      const chunk = singleValues.slice(i, i + 100).join(', ');
      await dbHandle.db.execute(
        sql.raw(
          `INSERT INTO calendar_events (type_code, title, starts_at, ends_at, created_by) VALUES ${chunk}`,
        ),
      );
    }
    // Plant 30 weekly-recurring rows with bounded UNTIL.
    const recurringRows: string[] = [];
    const until = new Date(Date.UTC(2027, 0, 1, 0, 0, 0));
    const untilStr = until.toISOString().replace(/[-:]|\.\d{3}/g, '');
    for (let i = 0; i < 30; i++) {
      const start = new Date(Date.UTC(2026, 0, 6, 10, 0, 0));
      start.setUTCDate(start.getUTCDate() + i);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      recurringRows.push(
        `('event_type_meeting', 'rec-${i}', '${start.toISOString()}', '${end.toISOString()}', 'RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU', '${tdId}')`,
      );
    }
    await dbHandle.db.execute(
      sql.raw(
        `INSERT INTO calendar_events (type_code, title, starts_at, ends_at, rrule, created_by) VALUES ${recurringRows.join(', ')}`,
      ),
    );
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('calendar.list with 200 events + 30 RRULE rows over a week range completes in p95 < 200ms', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    // Probe window: a week.
    const weekStart = new Date(Date.UTC(2026, 5, 1, 0, 0, 0));
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const list = await td.calendar.list({ from: weekStart, to: weekEnd });
      const t1 = performance.now();
      timings.push(t1 - t0);
      expect(Array.isArray(list)).toBe(true);
    }
    timings.sort((a, b) => a - b);
    // 5 samples → p95 = max sample.
    const p95 = timings[timings.length - 1]!;
    expect(p95).toBeLessThan(200);
  });
});
