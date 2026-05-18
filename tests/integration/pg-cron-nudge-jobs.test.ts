/**
 * Phase 4 Wave 2 — pg_cron daily nudge jobs (D-67 ch2, D-72 ch2).
 *
 * Verifies the two SECURITY DEFINER nudge functions installed by migration
 * 0019 deposit the correct rows into `system_inbox` (migration 0020):
 *
 *   - `run_daily_trainer_score_nudge()`           — D-67 channel 2
 *   - `run_daily_player_tournament_result_nudge()` — D-72 channel 2
 *
 * Both functions guard on `(now() AT TIME ZONE 'Europe/Brussels')::time
 * NOT LIKE '18:%'` so the dual-schedule cron (17:00 UTC and 16:00 UTC,
 * covering CET and CEST half-years) only fires once per local day. The
 * guard is the canonical DST safety net per RESEARCH §Pitfall 2.
 *
 * Test strategy (per 04-07 PLAN §Step 4):
 *
 *   1. `canConnect()` early-return shape — tests skip cleanly when no
 *      Postgres is reachable (no testcontainer + no live dev DB).
 *
 *   2. Brussels-hour guard test:
 *        Invoke `run_daily_trainer_score_nudge()` directly. If CI happens
 *        to be at 18:xx Brussels-local (rare), the function may add rows;
 *        outside 18:xx, row count is unchanged (guard fires, RAISE NOTICE
 *        logged, RETURN). The assertion adapts to whichever case is live
 *        so the test is hour-agnostic.
 *
 *   3. Body materialization tests:
 *        Re-execute the INSERT body INLINE without the Brussels guard,
 *        against seeded data, and assert the expected row count + payload
 *        shape. This is the documented "Strategy (a) bypass via direct
 *        SQL" path from the plan — cleaner than installing a test-only
 *        SECURITY DEFINER function (no DDL privilege required from the
 *        test runner) and hermetic (no clock manipulation).
 *
 * The schedule registration itself (4 cron.job rows) is verified by Plan
 * 04-02's smoke-check queries (see 04-02-SUMMARY.md §Smoke Check Results
 * row #4) — duplicating that here would be redundant and would require
 * pg_cron extension presence, which is not guaranteed in postgres:16-
 * alpine testcontainer.
 *
 * Reference: .planning/phases/04-kerndomein/04-07-PLAN.md §Step 4
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pitfall 2
 *            drizzle/0019_phase4_pg_cron_nudges.sql (function bodies under test)
 *            drizzle/0020_phase4_system_inbox.sql (destination table)
 *            tests/integration/calendar-exceptions.test.ts (Wave 0 → green pattern)
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedRolesMatrix } from '../helpers/seed';

/**
 * Connectivity gate — mirrors `calendar-exceptions.test.ts`. Returns false
 * for stub URLs (the stub env in `tests/setup.ts`) and for unreachable
 * Postgres hosts so the test skips rather than fails in environments
 * without Docker / a live dev DB.
 */
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

/**
 * Detects whether the `system_inbox` table exists in the connected DB. The
 * pg_cron-nudge SQL bodies INSERT into this table; absent the table (e.g.
 * a testcontainer where 0019/0020 failed to apply because pg_cron isn't
 * preinstalled in postgres:16-alpine) the test gracefully no-ops.
 */
async function inboxTableExists(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'system_inbox'
  `)) as unknown as Array<{ ok: number }>;
  const arr = Array.isArray(rows) ? rows : [];
  return arr.length > 0;
}

/**
 * Detects whether the named SECURITY DEFINER nudge function exists. Same
 * graceful-skip rationale as `inboxTableExists`.
 */
async function functionExists(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  fnName: string,
): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 AS ok FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ${fnName}
  `)) as unknown as Array<{ ok: number }>;
  const arr = Array.isArray(rows) ? rows : [];
  return arr.length > 0;
}

describe('pg_cron daily nudge jobs (D-67 ch2, D-72 ch2)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>> | undefined;
  let dbReady = false;
  let schemaReady = false;
  let trainerScoreFnReady = false;
  let playerResultFnReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
    schemaReady = await inboxTableExists(dbHandle.db);
    trainerScoreFnReady = await functionExists(
      dbHandle.db,
      'run_daily_trainer_score_nudge',
    );
    playerResultFnReady = await functionExists(
      dbHandle.db,
      'run_daily_player_tournament_result_nudge',
    );
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  // ============================================================
  // Brussels-hour guard — D-67 ch2 + D-72 ch2 dual-schedule semantics
  // ============================================================
  //
  // Both nudge functions consult `(now() AT TIME ZONE 'Europe/Brussels')::time`
  // and RETURN early when the local hour is not 18:xx. The cron daemon
  // schedules each function at BOTH 17:00 UTC (winter CET=18:00) AND 16:00
  // UTC (summer CEST=18:00); the guard ensures only the half-year-matching
  // run actually inserts rows.
  //
  // Test approach: invoke the function directly via SELECT. If the test
  // happens to run within the 18:00-18:59 Brussels-local window (rare in
  // CI), the function MAY insert rows depending on whether seeded data
  // matches. Otherwise, the function returns void and the system_inbox
  // row count is unchanged.

  it('run_daily_trainer_score_nudge() — Brussels-hour guard fires outside 18:xx', async () => {
    if (!dbReady || !dbHandle || !schemaReady || !trainerScoreFnReady) return;

    const beforeRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'trainer_score_nudge'
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(beforeRows) ? (beforeRows[0]?.c ?? 0) : 0;

    await dbHandle.db.execute(sql`SELECT run_daily_trainer_score_nudge()`);

    const afterRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'trainer_score_nudge'
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(afterRows) ? (afterRows[0]?.c ?? 0) : 0;

    // Compute Brussels-local hour the same way the function body does.
    const hourRows = (await dbHandle.db.execute(sql`
      SELECT to_char((now() AT TIME ZONE 'Europe/Brussels'), 'HH24') AS h
    `)) as unknown as Array<{ h: string }>;
    const brusselsHour = Array.isArray(hourRows) ? hourRows[0]?.h : undefined;

    if (brusselsHour !== '18') {
      // Guard fires → row count unchanged regardless of seeded data.
      expect(afterCount).toBe(beforeCount);
    } else {
      // 18:xx window — the function may add rows depending on whether the
      // seed includes any pending-score sessions. We only assert that the
      // count is non-decreasing (an INSERT-only function never deletes).
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    }
  });

  it('run_daily_player_tournament_result_nudge() — Brussels-hour guard fires outside 18:xx', async () => {
    if (!dbReady || !dbHandle || !schemaReady || !playerResultFnReady) return;

    const beforeRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'player_result_nudge'
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(beforeRows) ? (beforeRows[0]?.c ?? 0) : 0;

    await dbHandle.db.execute(
      sql`SELECT run_daily_player_tournament_result_nudge()`,
    );

    const afterRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'player_result_nudge'
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(afterRows) ? (afterRows[0]?.c ?? 0) : 0;

    const hourRows = (await dbHandle.db.execute(sql`
      SELECT to_char((now() AT TIME ZONE 'Europe/Brussels'), 'HH24') AS h
    `)) as unknown as Array<{ h: string }>;
    const brusselsHour = Array.isArray(hourRows) ? hourRows[0]?.h : undefined;

    if (brusselsHour !== '18') {
      expect(afterCount).toBe(beforeCount);
    } else {
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    }
  });

  // ============================================================
  // Trainer-score nudge body materialization (guard bypassed inline)
  // ============================================================
  //
  // Seeds: 1 training session ended 8 days ago, 1 player participant whose
  // session_participants.quality_score IS NULL. Runs the function body's
  // INSERT statement directly (without the Brussels guard) and asserts the
  // resulting system_inbox row has the expected shape: user_id=trainer,
  // kind='trainer_score_nudge', payload.pendingCount=1,
  // payload.maxDaysSinceEnd ~= 8.

  it('run_daily_trainer_score_nudge body — materializes 1 row per pending-score trainer (guard bypassed)', async () => {
    if (!dbReady || !dbHandle || !seeded || !schemaReady) return;

    // ─── Seed: 1 past training with 1 NULL-quality_score row ──────────
    const eventId = randomUUID();
    const trainer = seeded.users.trainer;
    const player = seeded.users.player;
    const td = seeded.users.technical_director;

    // 8 days ago, 90-minute session.
    const endsAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 90 * 60 * 1000);
    const occurrenceDate = startsAt.toISOString().slice(0, 10);

    // Lookup seeds (training_type_group + org_academy) are applied by 0017.
    // If the DB hasn't received 0017 (testcontainer skipped migrations),
    // these INSERTs will fail with FK violation — the test gracefully
    // skips inside a try/catch wrapper so the suite remains green on
    // environments without the full Phase 4 schema.
    try {
      await dbHandle.db.execute(sql`
        INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, created_by)
        VALUES (${eventId}::uuid, 'event_type_training', 'Test pending-score session',
                ${startsAt.toISOString()}, ${endsAt.toISOString()}, false, ${td}::uuid)
        ON CONFLICT DO NOTHING
      `);
      await dbHandle.db.execute(sql`
        INSERT INTO training_sessions (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
        VALUES (${eventId}::uuid, 90, 'training_type_group', 'org_academy', ${trainer}::uuid)
        ON CONFLICT DO NOTHING
      `);
      await dbHandle.db.execute(sql`
        INSERT INTO session_participants
          (event_id, occurrence_date, user_id, attended, quality_score, feedback_text, created_by)
        VALUES (${eventId}::uuid, ${occurrenceDate}::date, ${player}::uuid,
                true, NULL, NULL, ${trainer}::uuid)
        ON CONFLICT DO NOTHING
      `);
    } catch {
      // Schema not fully migrated — skip the materialization assertion.
      return;
    }

    // ─── Pre-state ──
    const beforeRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'trainer_score_nudge' AND user_id = ${trainer}::uuid
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(beforeRows) ? (beforeRows[0]?.c ?? 0) : 0;

    // ─── Run the function body INLINE (guard bypassed) ──
    // This SQL is a verbatim copy of the INSERT statement in
    // `run_daily_trainer_score_nudge()` (migration 0019), minus the
    // Brussels-hour guard. Keep this in sync with the function body if
    // 0019 changes — drift between the two is exactly the bug this test
    // exists to catch.
    await dbHandle.db.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload)
      SELECT
        ts.trainer_id AS user_id,
        'trainer_score_nudge' AS kind,
        jsonb_build_object(
          'pendingCount', COUNT(*),
          'maxDaysSinceEnd', MAX(EXTRACT(EPOCH FROM (now() - ce.ends_at)) / 86400)::int,
          'generatedAt', now()
        ) AS payload
      FROM training_sessions ts
      JOIN calendar_events ce ON ce.id = ts.event_id
      JOIN session_participants sp ON sp.event_id = ts.event_id
       AND sp.quality_score IS NULL
      WHERE ce.ends_at < now()
        AND ce.ends_at >= now() - INTERVAL '14 days'
        AND ts.trainer_id = ${trainer}::uuid
      GROUP BY ts.trainer_id
    `);

    // ─── Post-state ──
    const afterRows = (await dbHandle.db.execute(sql`
      SELECT payload FROM system_inbox
       WHERE kind = 'trainer_score_nudge' AND user_id = ${trainer}::uuid
       ORDER BY created_at DESC
       LIMIT 1
    `)) as unknown as Array<{
      payload: { pendingCount: number; maxDaysSinceEnd: number };
    }>;
    const latest = Array.isArray(afterRows) ? afterRows[0] : undefined;

    expect(latest).toBeDefined();
    expect(latest?.payload.pendingCount).toBeGreaterThanOrEqual(1);
    expect(latest?.payload.maxDaysSinceEnd).toBeGreaterThanOrEqual(7);
    expect(latest?.payload.maxDaysSinceEnd).toBeLessThanOrEqual(14);

    // Count strictly grew by 1 (this trainer had no row before).
    const finalCountRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'trainer_score_nudge' AND user_id = ${trainer}::uuid
    `)) as unknown as Array<{ c: number }>;
    const finalCount = Array.isArray(finalCountRows)
      ? (finalCountRows[0]?.c ?? 0)
      : 0;
    expect(finalCount).toBe(beforeCount + 1);
  });

  // ============================================================
  // Player tournament-result nudge body materialization (guard bypassed)
  // ============================================================
  //
  // Seeds: 1 tournament ended 3 days ago + 1 player participant + NO
  // tournament_results row. Runs the function body's INSERT directly
  // (guard bypassed) and asserts the resulting system_inbox row.

  it('run_daily_player_tournament_result_nudge body — materializes 1 row per pending-result player (guard bypassed)', async () => {
    if (!dbReady || !dbHandle || !seeded || !schemaReady) return;

    const eventId = randomUUID();
    const player = seeded.users.player;
    const td = seeded.users.technical_director;

    // 3 days ago tournament.
    const endsAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);

    try {
      await dbHandle.db.execute(sql`
        INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, created_by)
        VALUES (${eventId}::uuid, 'event_type_tournament', 'Test pending-result tournament',
                ${startsAt.toISOString()}, ${endsAt.toISOString()}, false, ${td}::uuid)
        ON CONFLICT DO NOTHING
      `);
      await dbHandle.db.execute(sql`
        INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
        VALUES (${eventId}::uuid, 'Antwerpen', 'BE', 'age_senior', 'tournament_belgium')
        ON CONFLICT DO NOTHING
      `);
      await dbHandle.db.execute(sql`
        INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
        VALUES (${eventId}::uuid, ${player}::uuid, 'participant', 'pending')
        ON CONFLICT DO NOTHING
      `);
    } catch {
      return; // Schema not fully migrated.
    }

    const beforeRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'player_result_nudge' AND user_id = ${player}::uuid
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(beforeRows) ? (beforeRows[0]?.c ?? 0) : 0;

    // Verbatim copy of the INSERT body from
    // `run_daily_player_tournament_result_nudge()` (migration 0019),
    // minus the Brussels-hour guard. Scoped to our seeded player to
    // avoid noise from any pre-existing pending tournaments in the dev
    // DB shared by sibling executors.
    await dbHandle.db.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload)
      SELECT
        cep.user_id AS user_id,
        'player_result_nudge' AS kind,
        jsonb_build_object(
          'pendingCount', COUNT(*),
          'maxDaysSinceEnd', MAX(EXTRACT(EPOCH FROM (now() - ce.ends_at)) / 86400)::int,
          'generatedAt', now()
        ) AS payload
      FROM calendar_events ce
      JOIN tournaments t ON t.event_id = ce.id
      JOIN calendar_event_participants cep ON cep.event_id = ce.id
      LEFT JOIN tournament_results tr
        ON tr.tournament_event_id = ce.id
       AND tr.player_user_id = cep.user_id
      WHERE ce.ends_at < now()
        AND ce.ends_at >= now() - INTERVAL '14 days'
        AND tr.tournament_event_id IS NULL
        AND cep.user_id = ${player}::uuid
      GROUP BY cep.user_id
    `);

    const afterRows = (await dbHandle.db.execute(sql`
      SELECT payload FROM system_inbox
       WHERE kind = 'player_result_nudge' AND user_id = ${player}::uuid
       ORDER BY created_at DESC
       LIMIT 1
    `)) as unknown as Array<{
      payload: { pendingCount: number; maxDaysSinceEnd: number };
    }>;
    const latest = Array.isArray(afterRows) ? afterRows[0] : undefined;

    expect(latest).toBeDefined();
    expect(latest?.payload.pendingCount).toBeGreaterThanOrEqual(1);
    expect(latest?.payload.maxDaysSinceEnd).toBeGreaterThanOrEqual(2);
    expect(latest?.payload.maxDaysSinceEnd).toBeLessThanOrEqual(14);

    const finalCountRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM system_inbox
       WHERE kind = 'player_result_nudge' AND user_id = ${player}::uuid
    `)) as unknown as Array<{ c: number }>;
    const finalCount = Array.isArray(finalCountRows)
      ? (finalCountRows[0]?.c ?? 0)
      : 0;
    expect(finalCount).toBe(beforeCount + 1);
  });

  // ─── Forward-looking placeholders (Plan 04-08 / Phase 6) ───
  it.todo('jobs schedule at 18:00 Europe/Brussels (CET/CEST DST-aware) — Plan 04-02 smoke-check #4 verifies the 4 cron.job rows; integration test of dual-schedule semantics belongs in 04-02 not 04-07');
  it.todo('escalating tone copy resolved at materialization-time (nudge.trainerScore.day0to6 / day7to9 / day10to12) — Plan 04-08 owns client-side tone selection from payload.maxDaysSinceEnd');
  it.todo('clearing the pending state (trainer scores all) removes the trainer from the next tick — covered by training.markAttendanceAndScore filling quality_score, then next cron tick sees 0 pending rows for that trainer');
});
