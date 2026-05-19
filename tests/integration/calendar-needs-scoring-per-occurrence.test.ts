/**
 * Integration test: calendar.list needsScoring aggregates per occurrence (WR-09).
 *
 * Probe matrix:
 *   - Recurring training with 3 past occurrences (wk1 = 21d ago,
 *     wk2 = 14d ago, wk3 = 7d ago). wk1 + wk2 fully scored
 *     (session_participants rows with non-NULL quality_score for both
 *     players). wk3 unscored (no session_participants rows yet).
 *   - Session trainer's calendar.list returns needsScoring=true on the
 *     wk3 chip ONLY. wk1 + wk2 stay false.
 *   - TD's calendar.list mirrors the same pattern (trainer/TD both
 *     receive the flag per Plan 04-07's T-04-53 RBAC mitigation).
 *   - Player caller never sees needsScoring=true (trainer/TD-only branch
 *     in calendar.ts).
 *
 * Note on fixtures:
 *   phase4-seed.ts ships ONLY a non-recurring pastTrainingEventId. This
 *   test plants its own recurring fixture in beforeAll. Brussels-anchored
 *   YYYY-MM-DD dates are pinned via brusselsDateISO() so assertions hit
 *   the exact occurrence chip the rrule expansion produces.
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md HUMAN-UAT #3
 *            .planning/phases/04-kerndomein/04-REVIEW.md §WR-09
 *            src/server/trpc/routers/calendar.ts needsScoring SQL refactor
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canConnect, freshDb } from './_helpers';
import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

const dbReady = await canConnect();
const d = describe.skipIf(!dbReady);

/**
 * Brussels-anchored YYYY-MM-DD — matches `formatOccurrenceDate` in
 * `src/lib/rrule.ts`. Used for fixture INSERTs into session_participants
 * (occurrence_date column) AND for assertion lookup against the returned
 * `inst.occurrenceDate` (which is a Date that we re-format the same way).
 */
function brusselsDateISO(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

interface CalendarInstance {
  id: string;
  typeCode: string;
  startsAt: Date | string;
  endsAt: Date | string;
  occurrenceDate: Date | string | null;
  needsScoring?: boolean;
}

d('calendar.list needsScoring per occurrence (WR-09)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;
  let recurringTrainingEventId: string;
  let wk1Iso: string;
  let wk2Iso: string;
  let wk3Iso: string;

  beforeAll(async () => {
    if (!dbReady) return;
    dbHandle = await freshDb();
    // includeNullScores=false — we don't want the seed's pastTrainingEventId
    // NULL-score rows to bleed into our needsScoring assertions (they would
    // not match our recurringTrainingEventId, but the cleaner the fixture
    // surface the cleaner the test).
    fixtures = await seedPhase4(dbHandle.db, { includeNullScores: false });

    // Plant our own recurring training event.
    // dtstart = 21 days ago at 16:00 UTC. Weekly recurrence.
    // The rrule expansion produces 3 past occurrences: wk1 (dtstart),
    // wk2 (dtstart + 7d), wk3 (dtstart + 14d). All 3 land inside the
    // calendar.list 14d elapsed-window candidate filter (since wk3 is
    // 7d ago and wk1 is 21d ago — wk1 will NOT appear as candidate for
    // needsScoring SQL because it's > 14d elapsed; we therefore assert
    // needsScoring behaviour on wk2 + wk3 only).
    recurringTrainingEventId = randomUUID();
    const wk1Date = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    wk1Date.setUTCHours(16, 0, 0, 0);
    const wk2Date = new Date(wk1Date.getTime() + 7 * 24 * 60 * 60 * 1000);
    const wk3Date = new Date(wk1Date.getTime() + 14 * 24 * 60 * 60 * 1000);
    wk1Iso = brusselsDateISO(wk1Date);
    wk2Iso = brusselsDateISO(wk2Date);
    wk3Iso = brusselsDateISO(wk3Date);

    const dtend = new Date(wk1Date.getTime() + 90 * 60 * 1000);

    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, rrule, created_by)
      VALUES (
        ${recurringTrainingEventId}::uuid,
        'event_type_training',
        'WR-09 needsScoring fixture',
        ${wk1Date.toISOString()},
        ${dtend.toISOString()},
        false,
        'FREQ=WEEKLY;BYDAY=TU',
        ${fixtures.users.technical_director}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO training_sessions
        (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
      VALUES (
        ${recurringTrainingEventId}::uuid, 90,
        'training_type_group', 'org_academy',
        ${fixtures.users.trainer}::uuid
      )
    `);

    // 2 player participants on the series — use fixtures.users.player +
    // fixtures.extraUsers.playerA2 (the phase4-seed academy-peer).
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants
        (event_id, user_id, role_in_event, rsvp_status)
      VALUES
        (${recurringTrainingEventId}::uuid, ${fixtures.users.player}::uuid,
         'participant', 'accepted'),
        (${recurringTrainingEventId}::uuid, ${fixtures.extraUsers.playerA2}::uuid,
         'participant', 'accepted')
    `);

    // session_participants:
    //   wk1: both players scored (quality_score NOT NULL)
    //   wk2: both players scored
    //   wk3: NO rows (unscored — the chip that should fire)
    await dbHandle.db.execute(sql`
      INSERT INTO session_participants
        (event_id, occurrence_date, user_id, attended, quality_score, created_by)
      VALUES
        (${recurringTrainingEventId}::uuid, ${wk1Iso}::date,
         ${fixtures.users.player}::uuid, true, 8, ${fixtures.users.trainer}::uuid),
        (${recurringTrainingEventId}::uuid, ${wk1Iso}::date,
         ${fixtures.extraUsers.playerA2}::uuid, true, 6, ${fixtures.users.trainer}::uuid),
        (${recurringTrainingEventId}::uuid, ${wk2Iso}::date,
         ${fixtures.users.player}::uuid, true, 7, ${fixtures.users.trainer}::uuid),
        (${recurringTrainingEventId}::uuid, ${wk2Iso}::date,
         ${fixtures.extraUsers.playerA2}::uuid, true, 5, ${fixtures.users.trainer}::uuid)
    `);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('session trainer sees needsScoring=true ONLY on the wk3 (unscored) chip', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.trainer,
      role: 'trainer',
    });
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const list: CalendarInstance[] = await caller.calendar.list({ from, to });
    const recurring = list.filter(
      (e) =>
        e.id === recurringTrainingEventId &&
        e.typeCode === 'event_type_training',
    );
    // Match by Brussels-anchored ISO equality (formatted from inst.occurrenceDate).
    const wk2 = recurring.find(
      (e) => e.occurrenceDate && brusselsDateISO(new Date(e.occurrenceDate)) === wk2Iso,
    );
    const wk3 = recurring.find(
      (e) => e.occurrenceDate && brusselsDateISO(new Date(e.occurrenceDate)) === wk3Iso,
    );
    // wk2 + wk3 are both within the 14d elapsed-window candidate set.
    // wk1 is 21d ago — outside the window — needsScoring not evaluated.
    expect(wk2).toBeDefined();
    expect(wk3).toBeDefined();
    // wk2: both players scored -> scored_count(2) >= participant_count(2) -> false
    expect(wk2?.needsScoring).not.toBe(true);
    // wk3: no session_participants rows -> scored_count(0) < participant_count(2) -> true
    expect(wk3?.needsScoring).toBe(true);
  });

  it('TD sees needsScoring=true on the wk3 (unscored) chip; wk2 (scored) stays false', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const list: CalendarInstance[] = await caller.calendar.list({ from, to });
    const recurring = list.filter((e) => e.id === recurringTrainingEventId);
    const wk2 = recurring.find(
      (e) => e.occurrenceDate && brusselsDateISO(new Date(e.occurrenceDate)) === wk2Iso,
    );
    const wk3 = recurring.find(
      (e) => e.occurrenceDate && brusselsDateISO(new Date(e.occurrenceDate)) === wk3Iso,
    );
    expect(wk2).toBeDefined();
    expect(wk3).toBeDefined();
    expect(wk2?.needsScoring).not.toBe(true);
    expect(wk3?.needsScoring).toBe(true);
  });

  it('player caller does NOT see needsScoring=true on any chip (trainer/TD-only feature)', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const list: CalendarInstance[] = await caller.calendar.list({ from, to });
    const recurring = list.filter((e) => e.id === recurringTrainingEventId);
    for (const e of recurring) {
      expect(e.needsScoring).not.toBe(true);
    }
  });
});
