/**
 * Phase 3 Wave 0 — calendar canonical fixture seed (implemented in Plan 03-08).
 *
 * Shared seed helper for calendar tests. Builds on top of `seedRolesMatrix`
 * (tests/helpers/seed.ts) — the user fixtures must already exist.
 *
 * Reference: 03-RESEARCH.md §Pattern 2 (polymorphic event seed);
 *            03-PATTERNS.md §calendar-seed.ts (analog: helpers/seed.ts);
 *            03-VALIDATION.md Wave 0 Requirements;
 *            03-CONTEXT.md D-47..D-58.
 *
 * Inserts run via Drizzle's schema-owner connection (bypasses RLS by design
 * — used ONLY in test setup; production code never imports this module).
 * `freshDb()` truncates between tests so fixtures stay isolated.
 *
 * Canonical fixture set (per 03-VALIDATION.md Wave 0 manifest):
 *   - 6 single events (one of each type) — TD as creator, trainer + player
 *     wired into the training as participants.
 *   - 1 recurring weekly Tuesday training within +2y horizon (UNTIL=+1y).
 *   - 1 cancelled exception against the recurring training.
 *   - 1 overlapping pair (two meetings, same player participant, time ranges
 *     overlap) for conflict-detection tests.
 *
 * Threat refs (D-58c, D-57): all inserts use the schema-owner client by
 * design — RLS bypass at fixture-time is OK; production paths never call this.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

export interface SeededCalendarFixtures {
  /**
   * Keyed by event-shape code so consumer tests can look up the event id
   * they need without holding the full insert order in their head.
   */
  eventIds: {
    /** Single training (TD creator, trainer assigned, player participant). */
    training: string;
    /** Single tournament. */
    tournament: string;
    /** Single staff meeting. */
    meeting: string;
    /** Single summer stage. */
    stage: string;
    /** Single half-year evaluation conversation (trainer × player). */
    eval_conversation: string;
    /** Single medical follow-up. */
    medical: string;
    /** Weekly Tuesday recurring training (UNTIL=+1y). */
    training_recurring: string;
    /** First meeting of an overlapping pair (player participant). */
    overlapping_pair_a: string;
    /** Second meeting of an overlapping pair (player participant, time
     *  range overlaps `overlapping_pair_a`). */
    overlapping_pair_b: string;
  };
  /** Per-event participant id arrays in seeding order (excluding TD organizer
   *  auto-add — that's a router concern, not a seed concern). */
  participantsByEvent: Record<string, string[]>;
  /** The cancelled-exception row id (against `training_recurring`). */
  cancelledExceptionId: string;
}

/**
 * Seed canonical calendar fixtures on top of `seedRolesMatrix` output.
 *
 * MUST be called AFTER `seedRolesMatrix` so the user ids exist.
 *
 * Threat T-03-41-FIXTURE-LEAK: all inserts via dbHandle (schema-owner) which
 * bypasses RLS by design — production code path never imports this module.
 * `freshDb()` truncates between test files; no cross-file contamination.
 */
export async function seedCalendarFixtures(
  db: ReturnType<typeof drizzle>,
  seededUsers: {
    technical_director: string;
    trainer: string;
    player: string;
    academy_manager: string;
    parent: string;
    sparring_partner: string;
    medical_staff: string;
  },
): Promise<SeededCalendarFixtures> {
  const TD = seededUsers.technical_director;
  const trainer = seededUsers.trainer;
  const player = seededUsers.player;

  // 1. Ensure event_type lookup rows exist (Wave 2 seed migration may not
  //    have run on every test container — keep this seed self-contained).
  await db.execute(sql`
    INSERT INTO event_type (code, sort_order, active) VALUES
      ('event_type_training', 10, true),
      ('event_type_tournament', 20, true),
      ('event_type_meeting', 30, true),
      ('event_type_stage', 40, true),
      ('event_type_eval_conversation', 50, true),
      ('event_type_medical', 60, true)
    ON CONFLICT (code) DO NOTHING
  `);

  // Ensure the dependent lookups for the training_sessions + tournaments
  // FKs exist. The Phase 2 lookup seed populates these in production; we
  // re-INSERT idempotently so this fixture runs even when migration 0008
  // has not yet been applied to the test DB.
  await db.execute(sql`
    INSERT INTO training_type (code, sort_order, active) VALUES
      ('training_type_group', 10, true),
      ('training_type_individual', 20, true)
    ON CONFLICT (code) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO organisation (code, sort_order, active) VALUES
      ('org_academy', 10, true),
      ('org_club', 20, true)
    ON CONFLICT (code) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tournament_type (code, sort_order, active) VALUES
      ('tournament_belgium', 10, true)
    ON CONFLICT (code) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO age_categories (code, sort_order, active) VALUES
      ('age_senior', 10, true)
    ON CONFLICT (code) DO NOTHING
  `);

  // Ensure a trainers row exists for the trainer user (training_sessions FK
  // references trainers.user_id). Phase 2 trainer-create flow normally
  // makes this; in the test fixture we plant it directly.
  await db.execute(sql`
    INSERT INTO trainers (user_id, first_name, last_name)
    VALUES (${trainer}::uuid, 'Seed', 'Trainer')
    ON CONFLICT (user_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO players (user_id, status_code, academy_code, first_name, last_name)
    VALUES (${player}::uuid, 'status_a', 'academy_a', 'Seed', 'Player')
    ON CONFLICT (user_id) DO NOTHING
  `);

  // Anchor: 10:00 local in 2 days (so tests in any timezone clear "now" with
  //         a clean future window).
  const anchor = new Date();
  anchor.setUTCDate(anchor.getUTCDate() + 2);
  anchor.setUTCHours(10, 0, 0, 0);

  const ids = {
    training: randomUUID(),
    tournament: randomUUID(),
    meeting: randomUUID(),
    stage: randomUUID(),
    eval_conversation: randomUUID(),
    medical: randomUUID(),
    training_recurring: randomUUID(),
    overlapping_pair_a: randomUUID(),
    overlapping_pair_b: randomUUID(),
  };
  const cancelledExceptionId = randomUUID();

  // ─── 1. Single training (anchor + 90min) ─────────────────────────────
  const trainingStart = new Date(anchor);
  const trainingEnd = new Date(trainingStart.getTime() + 90 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, location, created_by)
    VALUES (${ids.training}::uuid, 'event_type_training', 'Senioren A training',
            ${trainingStart.toISOString()}, ${trainingEnd.toISOString()}, false,
            'Topsportschool', ${TD}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO training_sessions (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
    VALUES (${ids.training}::uuid, 90, 'training_type_group', 'org_academy', ${trainer}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES (${ids.training}::uuid, ${player}::uuid, 'participant', 'pending')
  `);

  // ─── 2. Single tournament (next day) ────────────────────────────────
  const tournamentStart = new Date(anchor);
  tournamentStart.setUTCDate(tournamentStart.getUTCDate() + 1);
  const tournamentEnd = new Date(tournamentStart);
  tournamentEnd.setUTCHours(18, 0, 0, 0);
  await db.execute(sql`
    INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (${ids.tournament}::uuid, 'event_type_tournament', 'Belgian Open',
            ${tournamentStart.toISOString()}, ${tournamentEnd.toISOString()}, false, ${TD}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
    VALUES (${ids.tournament}::uuid, 'Antwerpen', 'BE', 'age_senior', 'tournament_belgium')
  `);

  // ─── 3. Meeting / 4. Stage / 5. EvalConv / 6. Medical (day after anchor) ───
  const dayAfter = new Date(anchor);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 2);
  const dayAfterEnd = new Date(dayAfter.getTime() + 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, created_by) VALUES
      (${ids.meeting}::uuid, 'event_type_meeting', 'Coaches stafvergadering',
       ${dayAfter.toISOString()}, ${dayAfterEnd.toISOString()}, ${TD}::uuid),
      (${ids.stage}::uuid, 'event_type_stage', 'Zomerstage Spanje',
       ${dayAfter.toISOString()}, ${dayAfterEnd.toISOString()}, ${TD}::uuid),
      (${ids.eval_conversation}::uuid, 'event_type_eval_conversation',
       'Halfjaarlijks gesprek',
       ${dayAfter.toISOString()}, ${dayAfterEnd.toISOString()}, ${TD}::uuid),
      (${ids.medical}::uuid, 'event_type_medical', 'Knie-controle',
       ${dayAfter.toISOString()}, ${dayAfterEnd.toISOString()}, ${TD}::uuid)
  `);
  await db.execute(sql`INSERT INTO meetings (event_id) VALUES (${ids.meeting}::uuid)`);
  await db.execute(sql`
    INSERT INTO stages (event_id, place, country)
    VALUES (${ids.stage}::uuid, 'Madrid', 'ES')
  `);
  await db.execute(sql`
    INSERT INTO eval_conversations (event_id, evaluator_user_id, player_user_id)
    VALUES (${ids.eval_conversation}::uuid, ${trainer}::uuid, ${player}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO medical_appointments (event_id, is_injury, doctor)
    VALUES (${ids.medical}::uuid, false, 'Dr. Janssens')
  `);

  // ─── 7. Recurring training: weekly Tuesday, UNTIL = anchor + 1y ──────
  //
  // Move the dtstart anchor onto the next Tuesday (day-of-week 2 in JS).
  const tuesdayStart = new Date(anchor);
  while (tuesdayStart.getUTCDay() !== 2) {
    tuesdayStart.setUTCDate(tuesdayStart.getUTCDate() + 1);
  }
  const tuesdayEnd = new Date(tuesdayStart.getTime() + 90 * 60 * 1000);
  const oneYearOut = new Date(tuesdayStart);
  oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
  // Format UNTIL as YYYYMMDDTHHmmssZ per RFC 5545.
  const untilStr =
    oneYearOut.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const recurringRrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr};BYDAY=TU`;
  await db.execute(sql`
    INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, rrule, created_by)
    VALUES (${ids.training_recurring}::uuid, 'event_type_training',
            'Wekelijkse jeugd-training',
            ${tuesdayStart.toISOString()}, ${tuesdayEnd.toISOString()},
            ${recurringRrule}, ${TD}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO training_sessions (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
    VALUES (${ids.training_recurring}::uuid, 90, 'training_type_group', 'org_academy', ${trainer}::uuid)
  `);
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES (${ids.training_recurring}::uuid, ${player}::uuid, 'participant', 'pending')
  `);

  // ─── 8. Cancelled exception on the recurring (the immediate Tuesday) ──
  await db.execute(sql`
    INSERT INTO calendar_event_exceptions (id, event_id, occurrence_date, cancelled, created_by)
    VALUES (${cancelledExceptionId}::uuid, ${ids.training_recurring}::uuid,
            ${tuesdayStart.toISOString().slice(0, 10)}::date, true, ${TD}::uuid)
  `);

  // ─── 9. Overlapping pair (same player participant, partial overlap) ──
  //
  // Pair anchor is +3 days from base anchor (so it doesn't collide with
  // tournament or stage). A starts at 10:00, ends at 12:00. B starts at
  // 11:00, ends at 13:00. → 1h overlap with same participant.
  const overlapStart = new Date(anchor);
  overlapStart.setUTCDate(overlapStart.getUTCDate() + 3);
  overlapStart.setUTCHours(10, 0, 0, 0);
  const overlapAEnd = new Date(overlapStart);
  overlapAEnd.setUTCHours(12, 0, 0, 0);
  const overlapBStart = new Date(overlapStart);
  overlapBStart.setUTCHours(11, 0, 0, 0);
  const overlapBEnd = new Date(overlapStart);
  overlapBEnd.setUTCHours(13, 0, 0, 0);

  await db.execute(sql`
    INSERT INTO calendar_events (id, type_code, title, starts_at, ends_at, created_by) VALUES
      (${ids.overlapping_pair_a}::uuid, 'event_type_meeting', 'Overlap meeting A',
       ${overlapStart.toISOString()}, ${overlapAEnd.toISOString()}, ${TD}::uuid),
      (${ids.overlapping_pair_b}::uuid, 'event_type_meeting', 'Overlap meeting B',
       ${overlapBStart.toISOString()}, ${overlapBEnd.toISOString()}, ${TD}::uuid)
  `);
  await db.execute(
    sql`INSERT INTO meetings (event_id) VALUES (${ids.overlapping_pair_a}::uuid)`,
  );
  await db.execute(
    sql`INSERT INTO meetings (event_id) VALUES (${ids.overlapping_pair_b}::uuid)`,
  );
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status) VALUES
      (${ids.overlapping_pair_a}::uuid, ${player}::uuid, 'participant', 'pending'),
      (${ids.overlapping_pair_b}::uuid, ${player}::uuid, 'participant', 'pending')
  `);

  const participantsByEvent: Record<string, string[]> = {
    [ids.training]: [player],
    [ids.tournament]: [],
    [ids.meeting]: [],
    [ids.stage]: [],
    [ids.eval_conversation]: [player],
    [ids.medical]: [],
    [ids.training_recurring]: [player],
    [ids.overlapping_pair_a]: [player],
    [ids.overlapping_pair_b]: [player],
  };

  return {
    eventIds: ids,
    participantsByEvent,
    cancelledExceptionId,
  };
}
