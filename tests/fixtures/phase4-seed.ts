/**
 * tests/fixtures/phase4-seed.ts — Phase 4 test fixture seeder (Wave 4).
 *
 * Extends `tests/helpers/seed.ts` (Phase 1 — seven role users) and
 * `tests/fixtures/calendar-seed.ts` (Phase 3 — polymorphic event canon)
 * with the operational tables Phase 4 ships:
 *   - `session_participants` (PK: event_id, occurrence_date, user_id) per D-82
 *   - `session_sparring_partners` (event_id, sparring_partner_id) per D-63
 *   - `tournament_results` (PK: tournament_event_id, player_user_id) per D-69 + D-77
 *   - `match_results` (UUID surrogate + VALID-07 composite UNIQUE) per D-81
 *   - `ranking_entries` (XOR split-column) per D-86
 *   - `belgium_classification` lookup rows (subset, idempotent) per D-86
 *
 * Plus three extra fixture users beyond `seedRolesMatrix`:
 *   - Academy A: a SECOND player (`playerA2`) — so D-78 academy-peer Branch 5
 *                has a "same-academy peer" subject to assert against
 *                player A's results.
 *   - Academy A: a SECOND trainer (`trainerA2`)? No — `trainer` from
 *                `seedRolesMatrix` is already in academy A. We re-use.
 *   - Academy B: a SECOND player (`playerB`) — the cross-academy peer
 *                (player D in 04-09 PLAN §rls-academy-wide-result-visibility:
 *                player C/D nomenclature). The Phase 1 victim_id is in
 *                academy B by `seedRolesMatrix` design, but a separate
 *                player B keeps assertions readable.
 *
 * Idempotency:
 *   - Lookup INSERTs use `ON CONFLICT DO NOTHING`.
 *   - Fixture data INSERTs use `ON CONFLICT DO NOTHING` where a natural
 *     PK exists; otherwise the seed helper relies on `freshDb()` having
 *     truncated all tables before the call.
 *
 * Threat: T-04-58-FALSE-GREEN-VIA-EMPTY-FIXTURE
 *   The seeder plants at LEAST the rows the integration tests need to
 *   produce non-empty result sets. Each test's `beforeAll` can sanity-check
 *   the seeded state with the IDs returned here.
 *
 * Reference: 04-CONTEXT.md §A..D, 04-PATTERNS.md §test-files,
 *            04-VALIDATION.md §Wave 0 Requirements,
 *            tests/fixtures/calendar-seed.ts (Phase 3 analog).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

import {
  seedRolesMatrix,
  type SeededRolesMatrix,
} from '../helpers/seed';
import {
  seedCalendarFixtures,
  type SeededCalendarFixtures,
} from './calendar-seed';

// ─── Options & result type ───────────────────────────────────────────────

export interface Phase4SeedOptions {
  /**
   * If `false`, the seeder skips planting `session_sparring_partners` rows
   * (still adds the sparring partner user). Default: `true` — the canonical
   * 14d-walls / RBAC matrix / RLS branch-6 tests want the row present.
   */
  includeSparring?: boolean;
  /**
   * If `false`, the seeder skips the `belgium_classification` defensive
   * re-INSERT (already populated by migration 0017 when run against the
   * testcontainer; the redundant seed is for stub-DB lanes). Default: `true`.
   */
  includeBelgiumClassifications?: boolean;
  /**
   * If `false`, the seeder skips the `outcome_level` defensive re-INSERT
   * (same rationale as above). Default: `true`.
   */
  includeOutcomeLevels?: boolean;
  /**
   * If `true`, plants two `session_participants` rows with `quality_score=NULL`
   * on a past training session 8 days ago — needed for D-64 trainer wall +
   * D-66 listPending tests. Default: `true`.
   */
  includeNullScores?: boolean;
  /**
   * If `true`, plants tournament_results + match_results for two academy A
   * players (the "academy peer" Branch 5 of D-78 RLS). Default: `true`.
   */
  includeTournamentResults?: boolean;
  /**
   * If `true`, plants ranking_entries for player A (4 numeric + 1 Belgium)
   * and player B (3 numeric — cross-academy RLS probe). Default: `true`.
   */
  includeRankings?: boolean;
  /**
   * If `true`, plants the academy-peer scaffolding (additional academy A
   * player + tournament_results row). D-78 Branch 5 test fixture.
   * Default: `true`.
   */
  includeAcademyPeerData?: boolean;
}

export interface Phase4SeededFixtures extends SeededRolesMatrix {
  /** Phase 3 calendar event ids carried through for back-reference. */
  calendar: SeededCalendarFixtures;
  /**
   * Phase 1 already plants 7 role users. Phase 4 plants a SECOND
   * player in each academy so D-78 Branch 5 (academy peer visibility)
   * has a peer subject + a cross-academy negative case.
   */
  extraUsers: {
    /** Second player in academy A — the academy peer of `users.player`. */
    playerA2: string;
    /** Second player in academy B — the cross-academy negative case. */
    playerB: string;
  };
  /** The past-training event id used by 14d wall / listPending fixtures. */
  pastTrainingEventId: string;
  /** YYYY-MM-DD occurrence date for the past-training event. */
  pastTrainingOccurrenceDate: string;
  /** The past-tournament event id used by D-71 wall + D-78 RLS fixtures. */
  pastTournamentEventId: string;
  /**
   * Tournament event id with at least one tournament_results + match_results
   * row planted — the D-78 5-branch RLS subject.
   */
  tournamentEntryWithMatchesEventId: string;
  /**
   * Codes for the two ranking-type shapes used in ranking_entries fixtures.
   * Both come from the seeded ranking_type lookup (0017 migration).
   */
  rankingTypeCodes: {
    seniorWorld: string; // 'ranking_senior_world' (numeric)
    belgium: string; // 'ranking_belgium' (classification)
  };
  /** Marker for callers that just want to know the seed ran. */
  phase4Ready: true;
}

// ─── Helper: insert defensive lookup rows the migrations should have set ───

/**
 * Idempotently insert lookup rows that Phase 4 migration 0017 seeded in
 * production. We re-INSERT here because the testcontainer may have run
 * `freshDb()`'s TRUNCATE … RESTART IDENTITY CASCADE which CAN clear seed
 * data even when the table itself was migrated. The CASCADE on
 * `belgium_classification` would also wipe these via FK chains.
 */
async function plantDefensiveLookups(
  db: ReturnType<typeof drizzle>,
  opts: Required<
    Pick<
      Phase4SeedOptions,
      'includeBelgiumClassifications' | 'includeOutcomeLevels'
    >
  >,
): Promise<void> {
  if (opts.includeOutcomeLevels) {
    await db.execute(sql`
      INSERT INTO outcome_level (code, sort_order, active) VALUES
        ('outcome_winner',       1, true),
        ('outcome_finalist',     2, true),
        ('outcome_last_4',       3, true),
        ('outcome_last_8',       4, true),
        ('outcome_last_16',      5, true),
        ('outcome_last_32',      6, true),
        ('outcome_last_64',      7, true),
        ('outcome_last_128',     8, true),
        ('outcome_group_stage',  9, true)
      ON CONFLICT (code) DO NOTHING
    `);
  }
  if (opts.includeBelgiumClassifications) {
    // Subset of the 67-code lookup — enough for our fixture rows. The
    // production seed (0017) installs the full set.
    await db.execute(sql`
      INSERT INTO belgium_classification (code, sort_order, tier, active) VALUES
        ('A1',  1,  'A', true),
        ('A12', 12, 'A', true),
        ('A24', 24, 'A', true),
        ('B0',  51, 'B', true),
        ('B2',  52, 'B', true),
        ('C0',  55, 'C', true),
        ('NC',  67, 'NC', true)
      ON CONFLICT (code) DO NOTHING
    `);
  }
  // ranking_type — 0017 also seeds 5 codes; we re-plant the two we use.
  // value_shape is required (Phase 4 0017 dropped its DEFAULT).
  await db.execute(sql`
    INSERT INTO ranking_type (code, direction, sort_order, active, value_shape) VALUES
      ('ranking_senior_world',    'asc_is_better', 1, true, 'numeric'),
      ('ranking_belgium',         'asc_is_better', 5, true, 'classification')
    ON CONFLICT (code) DO NOTHING
  `);
  // tournament_round — match_results FK references this (round_code).
  await db.execute(sql`
    INSERT INTO tournament_round (code, sort_order, active) VALUES
      ('round_final',          1, true),
      ('round_semi',           2, true),
      ('round_quarter',        3, true),
      ('round_eighth',         4, true),
      ('round_group_stage',    9, true)
    ON CONFLICT (code) DO NOTHING
  `);
  // `status` lookup — players FK; calendar-seed uses 'status_a' for the
  // single-player row. Plant defensively (no harm if already present).
  await db.execute(sql`
    INSERT INTO status (code, sort_order, active) VALUES
      ('status_a', 1, true),
      ('status_b', 2, true),
      ('status_c', 3, true)
    ON CONFLICT (code) DO NOTHING
  `);
}

// ─── Helper: spawn extra fixture users + memberships ─────────────────────

interface ExtraUsersRow {
  playerA2: string;
  playerB: string;
}

/**
 * Plant the two additional player users used by D-78 Branch 5 academy-peer
 * coverage. Mirrors `seedRolesMatrix` insertion shape: adult DOB, email
 * verified, locale=nl, operational-consent SKIPPED here (the D-78 query is
 * RLS-scoped via `tournament_result_visible_to`, not via the consent
 * middleware path — and the integration tests that drive these probes use
 * raw SQL against the SECURITY DEFINER helper, not the tRPC layer).
 */
async function plantExtraPlayerUsers(
  db: ReturnType<typeof drizzle>,
  technicalDirectorId: string,
  academyA: string,
  academyB: string,
): Promise<ExtraUsersRow> {
  const adultDob = new Date(Date.now() - 30 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const inserted = (await db.execute(sql`
    INSERT INTO users (email, name, role, preferred_locale, date_of_birth,
                       active, email_verified)
    VALUES
      ('seed-phase4-playerA2@vttl.test', 'Phase4 Player A2', 'player',
       'nl', ${adultDob}, true, true),
      ('seed-phase4-playerB@vttl.test',  'Phase4 Player B',  'player',
       'nl', ${adultDob}, true, true)
    ON CONFLICT (email) DO UPDATE SET email = excluded.email
    RETURNING id::text, email
  `)) as unknown as Array<{ id: string; email: string }>;
  const rows = Array.isArray(inserted) ? inserted : [];
  const byEmail = new Map(rows.map((r) => [r.email, r.id]));
  const playerA2 = byEmail.get('seed-phase4-playerA2@vttl.test');
  const playerB = byEmail.get('seed-phase4-playerB@vttl.test');
  if (!playerA2 || !playerB) {
    throw new Error('seedPhase4: extra-user INSERT returned no rows');
  }

  // Memberships — both as `player` (academy_memberships requires the
  // role to match the user's role for `player`/`trainer`/`academy_manager`).
  await db.execute(sql`
    INSERT INTO academy_memberships (user_id, academy_code, role, linked_by)
    VALUES
      (${playerA2}::uuid, ${academyA}, 'player', ${technicalDirectorId}::uuid),
      (${playerB}::uuid,  ${academyB}, 'player', ${technicalDirectorId}::uuid)
    ON CONFLICT DO NOTHING
  `);

  return { playerA2, playerB };
}

/**
 * Ensure the `seedRolesMatrix` player is mapped into academy A as well.
 * The Phase 1 helper plants the trainer + academy_manager into academy A
 * but leaves the role's "player" without a membership — D-78 Branch 5
 * needs the player to be in academy A so playerA2 can see their results.
 */
async function ensurePlayerInAcademyA(
  db: ReturnType<typeof drizzle>,
  playerId: string,
  technicalDirectorId: string,
  academyA: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO academy_memberships (user_id, academy_code, role, linked_by)
    VALUES (${playerId}::uuid, ${academyA}, 'player', ${technicalDirectorId}::uuid)
    ON CONFLICT DO NOTHING
  `);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Seed Phase 4 fixtures on top of `seedRolesMatrix` + Phase 3 calendar
 * canon. MUST be called against a freshly-truncated db (`freshDb()` from
 * `tests/helpers/db.ts`) — same convention as `seedCalendarFixtures`.
 *
 * Returns IDs every Phase 4 integration test needs:
 *   - The role-matrix from Phase 1.
 *   - Two extra players (playerA2 in academy A, playerB in academy B).
 *   - A past-training event id (8 days ago, NULL scores).
 *   - A past-tournament event id (with results + matches planted).
 *   - The ranking-type codes used by ranking fixtures.
 *
 * The function is idempotent — repeated calls produce the same shape.
 */
export async function seedPhase4(
  db: ReturnType<typeof drizzle>,
  opts: Phase4SeedOptions = {},
): Promise<Phase4SeededFixtures> {
  // Apply defaults.
  const o: Required<Phase4SeedOptions> = {
    includeSparring: opts.includeSparring ?? true,
    includeBelgiumClassifications: opts.includeBelgiumClassifications ?? true,
    includeOutcomeLevels: opts.includeOutcomeLevels ?? true,
    includeNullScores: opts.includeNullScores ?? true,
    includeTournamentResults: opts.includeTournamentResults ?? true,
    includeRankings: opts.includeRankings ?? true,
    includeAcademyPeerData: opts.includeAcademyPeerData ?? true,
  };

  // Phase 1 — roles + academies + parent-child links + medical event.
  const matrix = await seedRolesMatrix(db);

  // Defensive lookup top-up — same idempotent pattern Phase 3 fixture uses.
  await plantDefensiveLookups(db, {
    includeBelgiumClassifications: o.includeBelgiumClassifications,
    includeOutcomeLevels: o.includeOutcomeLevels,
  });

  // Make sure the role-matrix player is recorded as a member of academy A
  // so D-78 Branch 5 (academy peer) has a target.
  await ensurePlayerInAcademyA(
    db,
    matrix.users.player,
    matrix.users.technical_director,
    matrix.academyA,
  );

  // Phase 3 calendar canon — relies on the role users being in place.
  const calendar = await seedCalendarFixtures(db, matrix.users);

  // Phase 4 — extra fixture users (academy peer + cross-academy peer).
  const extraUsers = o.includeAcademyPeerData
    ? await plantExtraPlayerUsers(
        db,
        matrix.users.technical_director,
        matrix.academyA,
        matrix.academyB,
      )
    : { playerA2: matrix.users.player, playerB: matrix.victimId };

  // ─── Past training session for 14d wall + listPending fixtures ─────────
  //
  // Event ends 8 days ago. Two session_participants rows: one for the
  // role-matrix player (NULL quality_score → pending) + one for playerA2.
  const pastTrainingEventId = randomUUID();
  const pastTrainingEnds = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const pastTrainingStarts = new Date(
    pastTrainingEnds.getTime() - 90 * 60 * 1000,
  );
  const pastTrainingOccurrenceDate = pastTrainingStarts
    .toISOString()
    .slice(0, 10);

  // calendar_events + training_sessions extension.
  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${pastTrainingEventId}::uuid,
      'event_type_training',
      'Past training (8d ago) — pending scores',
      ${pastTrainingStarts.toISOString()},
      ${pastTrainingEnds.toISOString()},
      false,
      ${matrix.users.technical_director}::uuid
    )
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO training_sessions
      (event_id, duration_minutes, training_type_code, organisation_code, trainer_id)
    VALUES (
      ${pastTrainingEventId}::uuid, 90,
      'training_type_group', 'org_academy',
      ${matrix.users.trainer}::uuid
    )
    ON CONFLICT (event_id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES
      (${pastTrainingEventId}::uuid, ${matrix.users.player}::uuid, 'participant', 'accepted'),
      (${pastTrainingEventId}::uuid, ${extraUsers.playerA2}::uuid, 'participant', 'accepted')
    ON CONFLICT (event_id, user_id) DO NOTHING
  `);

  if (o.includeNullScores) {
    await db.execute(sql`
      INSERT INTO session_participants
        (event_id, occurrence_date, user_id, attended, quality_score, created_by)
      VALUES
        (${pastTrainingEventId}::uuid, ${pastTrainingOccurrenceDate}::date,
         ${matrix.users.player}::uuid, true, NULL, ${matrix.users.trainer}::uuid),
        (${pastTrainingEventId}::uuid, ${pastTrainingOccurrenceDate}::date,
         ${extraUsers.playerA2}::uuid, true, NULL, ${matrix.users.trainer}::uuid)
      ON CONFLICT (event_id, occurrence_date, user_id) DO NOTHING
    `);
  }

  // ─── Sparring partner junction (D-63 + Branch 6) ───────────────────────
  if (o.includeSparring) {
    await db.execute(sql`
      INSERT INTO session_sparring_partners
        (event_id, sparring_partner_id, created_by)
      VALUES (
        ${pastTrainingEventId}::uuid,
        ${matrix.users.sparring_partner}::uuid,
        ${matrix.users.technical_director}::uuid
      )
      ON CONFLICT (event_id, sparring_partner_id) DO NOTHING
    `);
  }

  // ─── Past tournament for D-71 wall + D-78 RLS coverage ─────────────────
  //
  // The Phase 3 calendar canon already planted ONE tournament event in
  // the future. Plant a second one 3 days ago so the result-entry path +
  // listPendingForPlayer + RLS branch-5 tests can probe it.
  const pastTournamentEventId = randomUUID();
  const pastTournamentEnds = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const pastTournamentStarts = new Date(
    pastTournamentEnds.getTime() - 8 * 60 * 60 * 1000,
  );

  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${pastTournamentEventId}::uuid,
      'event_type_tournament',
      'Past tournament (3d ago)',
      ${pastTournamentStarts.toISOString()},
      ${pastTournamentEnds.toISOString()},
      false,
      ${matrix.users.technical_director}::uuid
    )
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
    VALUES (
      ${pastTournamentEventId}::uuid,
      'Antwerpen', 'BE', 'age_senior', 'tournament_belgium'
    )
    ON CONFLICT (event_id) DO NOTHING
  `);
  // Register the role-matrix player as a participant — D-71 wall test
  // hits enterResult for this player.
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES
      (${pastTournamentEventId}::uuid, ${matrix.users.player}::uuid, 'participant', 'accepted'),
      (${pastTournamentEventId}::uuid, ${extraUsers.playerA2}::uuid, 'participant', 'accepted')
    ON CONFLICT (event_id, user_id) DO NOTHING
  `);

  // ─── Tournament_results + match_results for D-78 RLS Branch 5 ──────────
  //
  // We plant a result for player A so the 5-branch UNION test can verify:
  //   Branch 5: playerA2 (same academy as player A) SEES this row.
  //              playerB (different academy)        DOES NOT.
  const tournamentEntryWithMatchesEventId = pastTournamentEventId;
  if (o.includeTournamentResults) {
    // Result row: outcome=outcome_last_8, snapshot age_senior, entered by player.
    await db.execute(sql`
      INSERT INTO tournament_results
        (tournament_event_id, player_user_id, outcome_level_code,
         player_age_category_code, entered_by, entered_by_user_id)
      VALUES (
        ${pastTournamentEventId}::uuid,
        ${matrix.users.player}::uuid,
        'outcome_last_8',
        'age_senior',
        'player',
        ${matrix.users.player}::uuid
      )
      ON CONFLICT (tournament_event_id, player_user_id) DO NOTHING
    `);

    // One match row — opponent won the last set (2-3) but our player
    // advanced via outcome (irrelevant; just needs a valid row).
    const matchDate = pastTournamentStarts.toISOString().slice(0, 10);
    await db.execute(sql`
      INSERT INTO match_results
        (tournament_event_id, player_user_id, round_code,
         opponent_name, opponent_ranking, match_date,
         sets_won, sets_lost, video_link)
      VALUES (
        ${pastTournamentEventId}::uuid,
        ${matrix.users.player}::uuid,
        'round_quarter',
        'Phase4 Seed Opponent',
        450,
        ${matchDate}::date,
        3, 2, NULL
      )
      ON CONFLICT
        (tournament_event_id, player_user_id, round_code, opponent_name, match_date)
        DO NOTHING
    `);
  }

  // ─── Ranking entries (D-86 split-column XOR) ───────────────────────────
  if (o.includeRankings) {
    // 4 numeric Senior World entries for player A — quarterly samples
    // over the last 24 months (covers Rankings tab default range D-90).
    const monthsAgo = (months: number) =>
      new Date(
        new Date().getTime() - months * 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
    await db.execute(sql`
      INSERT INTO ranking_entries
        (player_user_id, ranking_type_code, recorded_at, source,
         value_numeric, value_classification_code, entered_by)
      VALUES
        (${matrix.users.player}::uuid, 'ranking_senior_world',
         ${monthsAgo(18)}, 'manual',  850, NULL, ${matrix.users.player}::uuid),
        (${matrix.users.player}::uuid, 'ranking_senior_world',
         ${monthsAgo(12)}, 'manual',  720, NULL, ${matrix.users.player}::uuid),
        (${matrix.users.player}::uuid, 'ranking_senior_world',
         ${monthsAgo(6)},  'manual',  580, NULL, ${matrix.users.player}::uuid),
        (${matrix.users.player}::uuid, 'ranking_senior_world',
         ${monthsAgo(1)},  'manual',  420, NULL, ${matrix.users.player}::uuid)
      ON CONFLICT DO NOTHING
    `);

    // 1 Belgium classification entry for player A (current = A12).
    await db.execute(sql`
      INSERT INTO ranking_entries
        (player_user_id, ranking_type_code, recorded_at, source,
         value_numeric, value_classification_code, entered_by)
      VALUES (${matrix.users.player}::uuid, 'ranking_belgium',
              ${monthsAgo(1)}, 'manual', NULL, 'A12',
              ${matrix.users.player}::uuid)
      ON CONFLICT DO NOTHING
    `);

    // 3 numeric Senior World entries for playerB (cross-academy probe).
    await db.execute(sql`
      INSERT INTO ranking_entries
        (player_user_id, ranking_type_code, recorded_at, source,
         value_numeric, value_classification_code, entered_by)
      VALUES
        (${extraUsers.playerB}::uuid, 'ranking_senior_world',
         ${monthsAgo(12)}, 'manual', 1200, NULL, ${extraUsers.playerB}::uuid),
        (${extraUsers.playerB}::uuid, 'ranking_senior_world',
         ${monthsAgo(6)},  'manual', 1100, NULL, ${extraUsers.playerB}::uuid),
        (${extraUsers.playerB}::uuid, 'ranking_senior_world',
         ${monthsAgo(1)},  'manual', 1000, NULL, ${extraUsers.playerB}::uuid)
      ON CONFLICT DO NOTHING
    `);
  }

  return {
    ...matrix,
    calendar,
    extraUsers,
    pastTrainingEventId,
    pastTrainingOccurrenceDate,
    pastTournamentEventId,
    tournamentEntryWithMatchesEventId,
    rankingTypeCodes: {
      seniorWorld: 'ranking_senior_world',
      belgium: 'ranking_belgium',
    },
    phase4Ready: true,
  };
}
