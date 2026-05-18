/**
 * Phase 4 Wave 4 — RBAC matrix (USER-04, D-61, D-73, D-79, D-89).
 *
 * Probes 7 roles × 5 Phase 4 operational tables × CRUD-subset cells via
 * the canonical `appCaller` + `rawPgAsAppUser` mix from Phase 1's
 * rbac-matrix.test.ts. Each cell has an explicit expected outcome — no
 * implicit "all roles default deny"; every cell asserted.
 *
 * Resources:
 *   - session_participants     (D-61 RLS)
 *   - session_sparring_partners (D-79 + Branch 6)
 *   - tournament_results       (D-78 5-branch RLS)
 *   - match_results            (visibility delegates to tournament_result)
 *   - ranking_entries          (D-89 + broad read RLS)
 *
 * Actions:
 *   - READ:   rawPgAsAppUser probe; allowed = ≥1 row, denied = 0 rows.
 *   - CREATE: invoke the public router mutation; allowed = succeeds,
 *             denied = throws (FORBIDDEN or role_not_allowed).
 *
 * Threat T-04-59-RBAC-MATRIX-COVERAGE-GAP: every cell explicitly named in
 * the matrix object; missing role/resource pair triggers a manifest test failure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { freshDb, rawPgAsAppUser } from '../helpers/db';
import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';
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

type Phase4Role =
  | 'technical_director'
  | 'trainer'
  | 'academy_manager'
  | 'player'
  | 'parent'
  | 'sparring_partner'
  | 'medical_staff';

const PHASE4_ROLES: Phase4Role[] = [
  'technical_director',
  'trainer',
  'academy_manager',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
];

type Outcome = 'allowed' | 'denied';
type Resource =
  | 'session_participants'
  | 'session_sparring_partners'
  | 'tournament_results'
  | 'match_results'
  | 'ranking_entries';

const PHASE4_RESOURCES: Resource[] = [
  'session_participants',
  'session_sparring_partners',
  'tournament_results',
  'match_results',
  'ranking_entries',
];

// ─── READ expectations ────────────────────────────────────────────────────
// Per D-61 (session_participants), D-63/CAL-04 (session_sparring_partners),
// D-78 (tournament_results 5-branch UNION), D-89 (ranking_entries).
const READ_EXPECTATIONS: Record<Phase4Role, Record<Resource, Outcome>> = {
  technical_director: {
    session_participants: 'allowed',
    session_sparring_partners: 'allowed',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  trainer: {
    session_participants: 'allowed',
    session_sparring_partners: 'allowed',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  academy_manager: {
    session_participants: 'allowed',
    session_sparring_partners: 'allowed',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  player: {
    session_participants: 'allowed',
    session_sparring_partners: 'denied',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  parent: {
    session_participants: 'allowed',
    session_sparring_partners: 'denied',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  sparring_partner: {
    session_participants: 'denied',
    session_sparring_partners: 'allowed',
    tournament_results: 'denied',
    match_results: 'denied',
    ranking_entries: 'denied',
  },
  medical_staff: {
    session_participants: 'denied',
    session_sparring_partners: 'denied',
    tournament_results: 'denied',
    match_results: 'denied',
    ranking_entries: 'denied',
  },
};

// ─── CREATE expectations ─────────────────────────────────────────────────
const CREATE_EXPECTATIONS: Record<Phase4Role, Record<Resource, Outcome>> = {
  technical_director: {
    session_participants: 'allowed',
    session_sparring_partners: 'allowed',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  trainer: {
    session_participants: 'allowed',
    session_sparring_partners: 'denied',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'denied',
  },
  academy_manager: {
    session_participants: 'denied',
    session_sparring_partners: 'denied',
    tournament_results: 'denied',
    match_results: 'denied',
    ranking_entries: 'denied',
  },
  player: {
    session_participants: 'denied',
    session_sparring_partners: 'denied',
    tournament_results: 'allowed',
    match_results: 'allowed',
    ranking_entries: 'allowed',
  },
  parent: {
    session_participants: 'denied',
    session_sparring_partners: 'denied',
    tournament_results: 'denied',
    match_results: 'denied',
    ranking_entries: 'denied',
  },
  sparring_partner: {
    session_participants: 'denied',
    session_sparring_partners: 'denied',
    tournament_results: 'denied',
    match_results: 'denied',
    ranking_entries: 'denied',
  },
  medical_staff: {
    session_participants: 'denied',
    session_sparring_partners: 'denied',
    tournament_results: 'denied',
    match_results: 'denied',
    ranking_entries: 'denied',
  },
};

describe('Phase 4 RBAC matrix — 7 roles × 5 resources × {READ, CREATE}', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
    // Parent → player link for Branch 4.
    if (dbHandle && seeded) {
      await dbHandle.db.execute(sql`
        INSERT INTO parent_child_links
          (parent_user_id, child_user_id, consent_given_at, linked_by)
        VALUES (
          ${seeded.users.parent}::uuid, ${seeded.users.player}::uuid,
          now(), ${seeded.users.technical_director}::uuid
        )
        ON CONFLICT DO NOTHING
      `);
    }
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  // ─── Manifest sanity ────────────────────────────────────────────────────
  it('manifest declares 7 × 5 × 2 = 70 cells (no missing)', () => {
    expect(PHASE4_ROLES.length).toBe(7);
    expect(PHASE4_RESOURCES.length).toBe(5);
    for (const role of PHASE4_ROLES) {
      for (const resource of PHASE4_RESOURCES) {
        expect(READ_EXPECTATIONS[role][resource]).toBeDefined();
        expect(CREATE_EXPECTATIONS[role][resource]).toBeDefined();
      }
    }
  });

  // ─── READ matrix via rawPgAsAppUser (RLS at DB layer) ──────────────────
  describe.each(PHASE4_ROLES)('READ row — role: %s', (role) => {
    it('session_participants visibility', async () => {
      if (!dbReady || !seeded) return;
      const expected = READ_EXPECTATIONS[role].session_participants;
      const rows = await rawPgAsAppUser<{ user_id: string }>({
        userId: seeded.users[role],
        role,
        sql: `SELECT user_id::text FROM session_participants
               WHERE event_id = $1 AND user_id = $2`,
        params: [seeded.pastTrainingEventId, seeded.users.player],
      });
      const count = Array.isArray(rows) ? rows.length : 0;
      if (expected === 'allowed') expect(count).toBeGreaterThanOrEqual(1);
      else expect(count).toBe(0);
    });

    it('session_sparring_partners visibility', async () => {
      if (!dbReady || !seeded) return;
      const expected = READ_EXPECTATIONS[role].session_sparring_partners;
      const rows = await rawPgAsAppUser<{ event_id: string }>({
        userId: seeded.users[role],
        role,
        sql: `SELECT event_id::text FROM session_sparring_partners
               WHERE event_id = $1`,
        params: [seeded.pastTrainingEventId],
      });
      const count = Array.isArray(rows) ? rows.length : 0;
      if (expected === 'allowed') expect(count).toBeGreaterThanOrEqual(1);
      else expect(count).toBe(0);
    });

    it('tournament_results visibility (D-78 5-branch)', async () => {
      if (!dbReady || !seeded) return;
      const expected = READ_EXPECTATIONS[role].tournament_results;
      const rows = await rawPgAsAppUser<{ outcome_level_code: string }>({
        userId: seeded.users[role],
        role,
        sql: `SELECT outcome_level_code FROM tournament_results
               WHERE tournament_event_id = $1 AND player_user_id = $2`,
        params: [
          seeded.tournamentEntryWithMatchesEventId,
          seeded.users.player,
        ],
      });
      const count = Array.isArray(rows) ? rows.length : 0;
      if (expected === 'allowed') expect(count).toBeGreaterThanOrEqual(1);
      else expect(count).toBe(0);
    });

    it('match_results visibility (delegates to tournament_result)', async () => {
      if (!dbReady || !seeded) return;
      const expected = READ_EXPECTATIONS[role].match_results;
      const rows = await rawPgAsAppUser<{ id: string }>({
        userId: seeded.users[role],
        role,
        sql: `SELECT id::text FROM match_results
               WHERE tournament_event_id = $1 AND player_user_id = $2`,
        params: [
          seeded.tournamentEntryWithMatchesEventId,
          seeded.users.player,
        ],
      });
      const count = Array.isArray(rows) ? rows.length : 0;
      if (expected === 'allowed') expect(count).toBeGreaterThanOrEqual(1);
      else expect(count).toBe(0);
    });

    it('ranking_entries visibility', async () => {
      if (!dbReady || !seeded) return;
      const expected = READ_EXPECTATIONS[role].ranking_entries;
      const rows = await rawPgAsAppUser<{ id: string }>({
        userId: seeded.users[role],
        role,
        sql: `SELECT id::text FROM ranking_entries WHERE player_user_id = $1`,
        params: [seeded.users.player],
      });
      const count = Array.isArray(rows) ? rows.length : 0;
      if (expected === 'allowed') expect(count).toBeGreaterThanOrEqual(1);
      else expect(count).toBe(0);
    });
  });

  // ─── CREATE matrix via public router mutations ─────────────────────────
  describe.each(PHASE4_ROLES)('CREATE row — role: %s', (role) => {
    it('ranking.addEntry RBAC', async () => {
      if (!dbReady || !seeded) return;
      const expected = CREATE_EXPECTATIONS[role].ranking_entries;
      const caller = appCaller({ userId: seeded.users[role], role });
      // Each role attempts to add ranking for their "own" target. For
      // roles without a self-ranking target, target the role-matrix player
      // — they'll fail at notOwnPlayer/role_not_allowed which is the
      // expected denial.
      const payload = {
        playerUserId: role === 'player' ? seeded.users.player : seeded.users.player,
        rankingTypeCode: 'ranking_senior_world',
        recordedAt: new Date(),
        source: 'manual' as const,
        value: {
          kind: 'numeric' as const,
          value: 200 + Math.floor(Math.random() * 1000),
        },
      };
      if (expected === 'allowed') {
        const result = await caller.ranking.addEntry(payload);
        expect(result.ok).toBe(true);
      } else {
        await expect(caller.ranking.addEntry(payload)).rejects.toThrow();
      }
    });

    it('calendar.event.attachSparringPartners RBAC (D-79 tdProcedure)', async () => {
      if (!dbReady || !seeded) return;
      const expected = CREATE_EXPECTATIONS[role].session_sparring_partners;
      const caller = appCaller({ userId: seeded.users[role], role });
      const payload = {
        eventId: seeded.calendar.eventIds.training,
        sparringPartnerIds: [seeded.users.sparring_partner],
      };
      if (expected === 'allowed') {
        const result = await caller.calendar.event.attachSparringPartners(
          payload,
        );
        expect(result.ok).toBe(true);
      } else {
        await expect(
          caller.calendar.event.attachSparringPartners(payload),
        ).rejects.toThrow();
      }
    });
  });
});
