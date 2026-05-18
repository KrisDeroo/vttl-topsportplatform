/**
 * Phase 4 Wave 4 — 14-day walls (D-64 + D-71).
 *
 * Covers two absolute walls:
 *   - D-64 trainer score wall — training.markAttendanceAndScore rejects
 *     when (now() - ends_at) > 14 days. No TD override per CONTEXT D-64.
 *   - D-71 player tournament entry wall — tournament.enterResult rejects
 *     when (now() - ends_at) > 14 days for caller-role=player. Trainer
 *     (same academy) + TD bypass per D-73 / D-75.
 *
 * Boundary cases (FOURTEEN_DAYS exact, per Pitfall 3 strict-greater):
 *   - day 13       → allowed
 *   - day 14 exact → allowed (boundary)
 *   - day 14 + 1s  → REJECTED with errors.training.scoreWindowExpired /
 *                                errors.tournament.entryWindowExpired
 *   - day 15       → REJECTED
 *
 * Analog: tests/integration/calendar-rrule-horizon.test.ts (D-55 horizon
 * boundary probe).
 *
 * Per-event seeding: each `it()` block plants its OWN tournament/training
 * event with a precisely-positioned ends_at — the canonical phase4 seed's
 * pastTrainingEventId is 8 days ago and is used for the listPending /
 * sparring tests; the wall boundary probes need distinct event ids so
 * they don't interfere.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
 * Plant a training session whose `ends_at` is exactly `daysAgo` days in the
 * past (sub-day precision via the `extraMs` adjustment for the day-14+1s
 * boundary case). Returns the seeded event_id + occurrence_date.
 */
async function plantTrainingEndingAt(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  seeded: Phase4SeededFixtures,
  daysAgo: number,
  extraMs = 0,
): Promise<{ eventId: string; occurrenceDate: string }> {
  const eventId = randomUUID();
  const endsAt = new Date(Date.now() - daysAgo * ONE_DAY_MS - extraMs);
  const startsAt = new Date(endsAt.getTime() - 90 * 60 * 1000);
  const occurrenceDate = startsAt.toISOString().slice(0, 10);

  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_training', 'Wall-boundary training',
      ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
      ${seeded.users.technical_director}::uuid
    )
  `);
  await db.execute(sql`
    INSERT INTO training_sessions
      (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
    VALUES (
      ${eventId}::uuid, 90,
      'training_type_group', 'org_academy', ${seeded.users.trainer}::uuid
    )
  `);
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES (${eventId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
  `);
  return { eventId, occurrenceDate };
}

/**
 * Plant a tournament whose `ends_at` is exactly `daysAgo` days in the past.
 * Returns the seeded event_id.
 */
async function plantTournamentEndingAt(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  seeded: Phase4SeededFixtures,
  daysAgo: number,
  extraMs = 0,
): Promise<string> {
  const eventId = randomUUID();
  const endsAt = new Date(Date.now() - daysAgo * ONE_DAY_MS - extraMs);
  const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);

  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_tournament', 'Wall-boundary tournament',
      ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
      ${seeded.users.technical_director}::uuid
    )
  `);
  await db.execute(sql`
    INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
    VALUES (${eventId}::uuid, 'Antwerpen', 'BE', 'age_senior', 'tournament_belgium')
  `);
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES (${eventId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
  `);
  return eventId;
}

describe('14-day score wall (D-64) — trainer.markAttendanceAndScore', () => {
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

  it('day 13: trainer can score session — allowed', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const { eventId, occurrenceDate } = await plantTrainingEndingAt(
      dbHandle.db,
      seeded,
      13,
    );
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.training.markAttendanceAndScore({
      eventId,
      occurrenceDate: new Date(occurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 6,
          feedbackText: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(1);
  });

  it('day 14 exact: trainer can score session — allowed (boundary)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // ends_at = exactly now() - 14d. Strict-greater wall → 14d exact still allowed.
    const { eventId, occurrenceDate } = await plantTrainingEndingAt(
      dbHandle.db,
      seeded,
      14,
    );
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.training.markAttendanceAndScore({
      eventId,
      occurrenceDate: new Date(occurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 8,
          feedbackText: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('day 14 + 1s: rejected with errors.training.scoreWindowExpired (boundary)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // ends_at = now() - 14d - 1500ms → strictly > 14 days → wall expired.
    const { eventId, occurrenceDate } = await plantTrainingEndingAt(
      dbHandle.db,
      seeded,
      14,
      1500,
    );
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.training.markAttendanceAndScore({
        eventId,
        occurrenceDate: new Date(occurrenceDate),
        participants: [
          {
            userId: seeded.users.player,
            attended: true,
            qualityScore: 4,
            feedbackText: null,
          },
        ],
      }),
    ).rejects.toThrow(/scoreWindowExpired/);

    // Denied-outcome audit row written BEFORE the throw (T-04-19).
    const auditRows = (await dbHandle.db.execute(sql`
      SELECT outcome FROM audit_log
       WHERE action = 'training_score_window_expired_attempt'
         AND resource_id = ${eventId}
    `)) as unknown as Array<{ outcome: string }>;
    const arr = Array.isArray(auditRows) ? auditRows : [];
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0]?.outcome).toBe('denied');
  });

  it('day 15: rejected with errors.training.scoreWindowExpired', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const { eventId, occurrenceDate } = await plantTrainingEndingAt(
      dbHandle.db,
      seeded,
      15,
    );
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.training.markAttendanceAndScore({
        eventId,
        occurrenceDate: new Date(occurrenceDate),
        participants: [
          {
            userId: seeded.users.player,
            attended: true,
            qualityScore: 2,
            feedbackText: null,
          },
        ],
      }),
    ).rejects.toThrow(/scoreWindowExpired/);
  });

  it('TD does NOT bypass the trainer wall (D-64 absolute — no override)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // The D-64 contract is explicit: NO TD override on the trainer wall.
    // Distinguishes from the tournament side where TD bypasses (D-75).
    const { eventId, occurrenceDate } = await plantTrainingEndingAt(
      dbHandle.db,
      seeded,
      15,
    );
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await expect(
      td.training.markAttendanceAndScore({
        eventId,
        occurrenceDate: new Date(occurrenceDate),
        participants: [
          {
            userId: seeded.users.player,
            attended: true,
            qualityScore: 6,
            feedbackText: null,
          },
        ],
      }),
    ).rejects.toThrow(/scoreWindowExpired/);
  });
});

describe('14-day tournament entry wall (D-71) — tournament.enterResult', () => {
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

  it('day 13: player can enter result — allowed', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingAt(
      dbHandle.db,
      seeded,
      13,
    );
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const result = await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_8',
      matches: [
        {
          round: 'round_quarter',
          opponent: 'Test Opponent 13',
          opponentRanking: 250,
          matchDate: new Date(Date.now() - 13 * ONE_DAY_MS),
          setsWon: 2,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('day 14 exact: player can enter result — allowed (boundary)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingAt(
      dbHandle.db,
      seeded,
      14,
    );
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const result = await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_eighth',
          opponent: 'Test Opponent 14exact',
          opponentRanking: 320,
          matchDate: new Date(Date.now() - 14 * ONE_DAY_MS),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('day 14 + 1s: rejected with errors.tournament.entryWindowExpired (boundary)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingAt(
      dbHandle.db,
      seeded,
      14,
      1500,
    );
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_32',
        matches: [
          {
            round: 'round_sixteenth',
            opponent: 'Test Opponent 14+1s',
            opponentRanking: 410,
            matchDate: new Date(Date.now() - 14 * ONE_DAY_MS),
            setsWon: 0,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toThrow(/entryWindowExpired/);

    // Denied-outcome audit row.
    const auditRows = (await dbHandle.db.execute(sql`
      SELECT outcome FROM audit_log
       WHERE action = 'tournament_entry_window_expired_attempt'
         AND resource_id = ${tournamentId}
    `)) as unknown as Array<{ outcome: string }>;
    const arr = Array.isArray(auditRows) ? auditRows : [];
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0]?.outcome).toBe('denied');
  });

  it('day 15: rejected with errors.tournament.entryWindowExpired', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingAt(
      dbHandle.db,
      seeded,
      15,
    );
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_64',
        matches: [
          {
            round: 'round_other',
            opponent: 'Test Opponent 15',
            opponentRanking: null,
            matchDate: new Date(Date.now() - 15 * ONE_DAY_MS),
            setsWon: 0,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toThrow(/entryWindowExpired/);
  });

  it('trainer-in-academy CAN enter on day 15 (D-73 asymmetric backfill)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Phase 1 seed put the trainer + player both into academy_memberships
    // for academy A, so the trainer-bypass SQL JOIN in enterResult will succeed.
    const tournamentId = await plantTournamentEndingAt(
      dbHandle.db,
      seeded,
      15,
    );
    const trainer = appCaller({
      userId: seeded.users.trainer,
      role: 'trainer',
    });
    const result = await trainer.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_group_stage',
      matches: [
        {
          round: 'round_group_stage',
          opponent: 'Trainer-backfill opponent',
          opponentRanking: 600,
          matchDate: new Date(Date.now() - 15 * ONE_DAY_MS),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.enteredBy).toBe('trainer');
  });

  it('TD CAN enter on day 15 (D-75 unrestricted)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingAt(
      dbHandle.db,
      seeded,
      15,
    );
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_32',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'TD-backfill opponent',
          opponentRanking: 380,
          matchDate: new Date(Date.now() - 15 * ONE_DAY_MS),
          setsWon: 2,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.enteredBy).toBe('td');
  });
});
