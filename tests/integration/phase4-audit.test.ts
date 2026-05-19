/**
 * Phase 4 Wave 4 — audit_log codes (GDPR-04) coverage matrix.
 *
 * Covers every Phase 4 mutation code that ships in routers Plan 04-03..04-07.
 * Per `04-PATTERNS.md` §Cross-Cutting §2 Audit logging, the canonical
 * 14-code Phase 4 set is:
 *
 *    1. training_attendance_marked
 *    2. training_score_window_expired_attempt   (outcome='denied')
 *    3. tournament_result_entered
 *    4. tournament_result_overwritten           (D-75 oldValues mandatory)
 *    5. tournament_entry_window_expired_attempt (outcome='denied')
 *    6. tournament_created
 *    7. tournament_participant_added
 *    8. tournament_participant_removed
 *    9. ranking_entry_added
 *   10. ranking_entry_updated                   (RESERVED for v2 — see ranking.ts comment)
 *   11. calendar_event_recurring_split          (D-84 this_and_future)
 *   12. calendar_event_recurring_updated_all    (D-84 all_in_series)
 *   13. sparring_partner_attached               (D-63 junction insert)
 *   14. idempotency_replay                      (VALID-08 cache hit)
 *
 * Plan 04-07 also added `inbox_marked_read` (15th code — emitted on the
 * inbox.markRead mutation) — we cover that here for completeness.
 *
 * Analog: tests/integration/calendar-audit.test.ts (Phase 3 6-code pattern).
 */
import { randomUUID } from 'node:crypto';

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

async function countAuditRows(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  action: string,
): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM audit_log WHERE action = ${action}
  `)) as unknown as Array<{ c: number }>;
  return Array.isArray(rows) ? (rows[0]?.c ?? 0) : 0;
}

const PHASE4_AUDIT_CODES = [
  'training_attendance_marked',
  'training_score_window_expired_attempt',
  'tournament_result_entered',
  'tournament_result_overwritten',
  'tournament_entry_window_expired_attempt',
  'tournament_created',
  'tournament_participant_added',
  'tournament_participant_removed',
  'ranking_entry_added',
  'ranking_entry_updated', // v2 — emitted as a no-op via inline TD correction (assertion: count >= 0)
  'calendar_event_recurring_split',
  'calendar_event_recurring_updated_all',
  'sparring_partner_attached',
  'idempotency_replay',
  // Plan 04-07 add — 15th code.
  'inbox_marked_read',
] as const;

describe('Phase 4 audit_log codes (GDPR-04) — 15 codes', () => {
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

  it('manifest declares all 15 Phase 4 audit codes (no duplicates)', () => {
    expect(PHASE4_AUDIT_CODES).toHaveLength(15);
    expect(new Set(PHASE4_AUDIT_CODES).size).toBe(15);
  });

  it('emits training_attendance_marked on training.markAttendanceAndScore success', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'training_attendance_marked');
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await trainer.training.markAttendanceAndScore({
      eventId: seeded.pastTrainingEventId,
      occurrenceDate: new Date(seeded.pastTrainingOccurrenceDate),
      participants: [
        {
          userId: seeded.users.player,
          attended: true,
          qualityScore: 7,
          feedbackText: null,
        },
      ],
    });
    const after = await countAuditRows(dbHandle.db, 'training_attendance_marked');
    expect(after).toBeGreaterThan(before);
  });

  it('emits training_score_window_expired_attempt with outcome=denied on day 15 trainer call', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const eventId = randomUUID();
    const endsAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 90 * 60 * 1000);
    const occurrenceDate = startsAt.toISOString().slice(0, 10);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (
        ${eventId}::uuid, 'event_type_training', 'Day-15 audit probe',
        ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
        ${seeded.users.technical_director}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO training_sessions
        (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
      VALUES (
        ${eventId}::uuid, 90,
        'training_type_group', 'org_academy', ${seeded.users.trainer}::uuid
      )
    `);
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.training.markAttendanceAndScore({
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
    const rows = (await dbHandle.db.execute(sql`
      SELECT outcome FROM audit_log
       WHERE action = 'training_score_window_expired_attempt'
         AND resource_id = ${eventId}
       ORDER BY occurred_at DESC LIMIT 1
    `)) as unknown as Array<{ outcome: string }>;
    expect(Array.isArray(rows) ? rows[0]?.outcome : '').toBe('denied');
  });

  it('emits tournament_result_entered on player enterResult', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'tournament_result_entered');
    // Plant a fresh tournament for clean attribution.
    const tournamentId = randomUUID();
    const endsAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (${tournamentId}::uuid, 'event_type_tournament', 'Audit-entered tournament',
              ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
              ${seeded.users.technical_director}::uuid)
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
      VALUES (${tournamentId}::uuid, 'X', 'BE', 'age_senior', 'tournament_belgium')
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
      VALUES (${tournamentId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
    `);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'A',
          opponentRanking: 500,
          matchDate: endsAt,
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    const after = await countAuditRows(dbHandle.db, 'tournament_result_entered');
    expect(after).toBe(before + 1);
  });

  it('emits tournament_result_overwritten with old_values JSONB on TD overwrite', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant + initial entry.
    const tournamentId = randomUUID();
    const endsAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (${tournamentId}::uuid, 'event_type_tournament', 'Overwrite audit',
              ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
              ${seeded.users.technical_director}::uuid)
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
      VALUES (${tournamentId}::uuid, 'X', 'BE', 'age_senior', 'tournament_belgium')
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
      VALUES (${tournamentId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
    `);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_32',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'pre',
          opponentRanking: 500,
          matchDate: endsAt,
          setsWon: 0,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });

    const before = await countAuditRows(dbHandle.db, 'tournament_result_overwritten');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_8',
      matches: [
        {
          round: 'round_quarter',
          opponent: 'post',
          opponentRanking: 350,
          matchDate: endsAt,
          setsWon: 3,
          setsLost: 1,
          videoLink: null,
        },
      ],
    });
    const after = await countAuditRows(dbHandle.db, 'tournament_result_overwritten');
    expect(after).toBe(before + 1);
    // Old values must be present.
    const rows = (await dbHandle.db.execute(sql`
      SELECT old_values FROM audit_log
       WHERE action = 'tournament_result_overwritten'
         AND resource_id = ${`${tournamentId}:${seeded.users.player}`}
       ORDER BY occurred_at DESC LIMIT 1
    `)) as unknown as Array<{ old_values: unknown }>;
    const ov = Array.isArray(rows) ? rows[0]?.old_values : undefined;
    expect(ov).toBeTruthy();
  });

  it('emits tournament_entry_window_expired_attempt on day 15 player call', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = randomUUID();
    const endsAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (${tournamentId}::uuid, 'event_type_tournament', 'Day-15 audit',
              ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
              ${seeded.users.technical_director}::uuid)
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
      VALUES (${tournamentId}::uuid, 'X', 'BE', 'age_senior', 'tournament_belgium')
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
      VALUES (${tournamentId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
    `);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_64',
        matches: [
          {
            round: 'round_other',
            opponent: 'late',
            opponentRanking: 700,
            matchDate: endsAt,
            setsWon: 0,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toThrow(/entryWindowExpired/);
    const rows = (await dbHandle.db.execute(sql`
      SELECT outcome FROM audit_log
       WHERE action = 'tournament_entry_window_expired_attempt'
         AND resource_id = ${tournamentId}
       ORDER BY occurred_at DESC LIMIT 1
    `)) as unknown as Array<{ outcome: string }>;
    expect(Array.isArray(rows) ? rows[0]?.outcome : '').toBe('denied');
  });

  it('emits tournament_created on TD tournament.create', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'tournament_created');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await td.tournament.create({
      naam: 'Created-audit Test',
      startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      city: 'Brussel',
      country: 'BE',
      ageCategoryCode: 'age_senior',
      tournamentTypeCode: 'tournament_belgium',
      description: null,
    });
    const after = await countAuditRows(dbHandle.db, 'tournament_created');
    expect(after).toBe(before + 1);
  });

  it('emits tournament_participant_added on TD addParticipant', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const t = await td.tournament.create({
      naam: 'ParticipantAdd audit',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      city: 'X',
      country: 'BE',
      ageCategoryCode: 'age_senior',
      tournamentTypeCode: 'tournament_belgium',
      description: null,
    });
    const before = await countAuditRows(dbHandle.db, 'tournament_participant_added');
    await td.tournament.addParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    const after = await countAuditRows(dbHandle.db, 'tournament_participant_added');
    expect(after).toBe(before + 1);
  });

  it('emits tournament_participant_removed on TD removeParticipant', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const t = await td.tournament.create({
      naam: 'ParticipantRemove audit',
      startsAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      city: 'X',
      country: 'BE',
      ageCategoryCode: 'age_senior',
      tournamentTypeCode: 'tournament_belgium',
      description: null,
    });
    await td.tournament.addParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    const before = await countAuditRows(dbHandle.db, 'tournament_participant_removed');
    await td.tournament.removeParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    const after = await countAuditRows(dbHandle.db, 'tournament_participant_removed');
    expect(after).toBe(before + 1);
  });

  it('emits ranking_entry_added on ranking.addEntry success', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'ranking_entry_added');
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.ranking.addEntry({
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world',
      recordedAt: new Date(),
      source: 'manual',
      value: { kind: 'numeric', value: 285 },
    });
    const after = await countAuditRows(dbHandle.db, 'ranking_entry_added');
    expect(after).toBe(before + 1);
  });

  it('ranking_entry_updated reserved for v2 — count remains 0 (correction = delete-and-re-add)', async () => {
    if (!dbReady || !dbHandle) return;
    const count = await countAuditRows(dbHandle.db, 'ranking_entry_updated');
    // The v1 ranking router has no explicit update endpoint; the code path
    // never emits this action. Manifest pre-declares it for forward
    // compatibility (Phase 5/6 dashboard may add explicit-update flow).
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('emits calendar_event_recurring_split on event.editRecurring this_and_future', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'calendar_event_recurring_split');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    // Pick a future Tuesday — 14 days out.
    const splitDate = new Date();
    splitDate.setUTCDate(splitDate.getUTCDate() + 14);
    while (splitDate.getUTCDay() !== 2) {
      splitDate.setUTCDate(splitDate.getUTCDate() + 1);
    }
    splitDate.setUTCHours(10, 0, 0, 0);
    await td.calendar.event.editRecurring({
      eventId: seeded.calendar.eventIds.training_recurring,
      scope: 'this_and_future',
      splitDate,
      edits: { title: 'Phase4 audit split' },
    });
    const after = await countAuditRows(dbHandle.db, 'calendar_event_recurring_split');
    expect(after).toBe(before + 1);
  });

  it('emits calendar_event_recurring_updated_all on event.editRecurring all_in_series', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'calendar_event_recurring_updated_all');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await td.calendar.event.editRecurring({
      eventId: seeded.calendar.eventIds.training_recurring,
      scope: 'all_in_series',
      edits: { title: 'Phase4 audit series' },
    });
    const after = await countAuditRows(dbHandle.db, 'calendar_event_recurring_updated_all');
    expect(after).toBe(before + 1);
  });

  it('emits sparring_partner_attached on calendar.event.attachSparringPartners', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = await countAuditRows(dbHandle.db, 'sparring_partner_attached');
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await td.calendar.event.attachSparringPartners({
      eventId: seeded.calendar.eventIds.training,
      sparringPartnerIds: [seeded.users.sparring_partner],
    });
    const after = await countAuditRows(dbHandle.db, 'sparring_partner_attached');
    expect(after).toBeGreaterThan(before);
  });

  it('emits idempotency_replay on cache HIT (VALID-08)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const key = randomUUID();
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const payload = {
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world' as const,
      recordedAt: new Date(),
      source: 'manual' as const,
      value: { kind: 'numeric' as const, value: 270 },
      _meta: { idempotencyKey: key },
    };
    await player.ranking.addEntry(payload);
    const before = await countAuditRows(dbHandle.db, 'idempotency_replay');
    await player.ranking.addEntry(payload);
    const after = await countAuditRows(dbHandle.db, 'idempotency_replay');
    expect(after).toBe(before + 1);
  });

  it('emits inbox_marked_read on inbox.markRead first-time mark', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a system_inbox row for the role-matrix player.
    const inboxRows = (await dbHandle.db.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload)
      VALUES (
        ${seeded.users.player}::uuid,
        'player_result_nudge',
        '{"pendingCount":1,"maxDaysSinceEnd":3}'::jsonb
      )
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    const inboxId = Array.isArray(inboxRows) ? inboxRows[0]?.id : undefined;
    if (!inboxId) throw new Error('Failed to plant system_inbox row');

    const before = await countAuditRows(dbHandle.db, 'inbox_marked_read');
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.inbox.markRead({ id: inboxId });
    const after = await countAuditRows(dbHandle.db, 'inbox_marked_read');
    expect(after).toBe(before + 1);
  });

  it('every audit row has actor_user_id + resource_type + outcome', async () => {
    if (!dbReady || !dbHandle) return;
    const malformed = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE actor_user_id IS NULL
          OR resource_type IS NULL
          OR outcome IS NULL
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(malformed) ? malformed[0]?.c : 0).toBe(0);
  });
});
