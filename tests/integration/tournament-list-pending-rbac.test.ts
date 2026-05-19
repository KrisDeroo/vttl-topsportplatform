/**
 * Integration test: listPendingForPlayer RBAC contract (CR-04, Plan 04-12 Task 5).
 *
 * Allowlist: player, trainer, technical_director, parent.
 * Parent branch additionally requires a parent_child_links row
 * for the targeted playerUserId.
 *
 * Matrix shape — 9 cells:
 *
 *   1. player querying own pending                                 → ok
 *   2. player querying other player                                → FORBIDDEN errors.tournament.notOwnPlayer
 *   3. trainer querying any player                                 → ok
 *   4. technical_director querying any player                      → ok
 *   5. parent querying own child (parent_child_links present)      → ok
 *   6. parent querying non-child                                   → FORBIDDEN errors.tournament.notChildOfParent
 *   7. medical_staff                                               → FORBIDDEN role_not_allowed
 *   8. sparring_partner                                            → FORBIDDEN role_not_allowed
 *   9. academy_manager                                             → FORBIDDEN role_not_allowed
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[4]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-04
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db as rawDb } from '@/server/db/client';

import { canConnect, freshDb } from './_helpers';
import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

const dbReady = await canConnect();
const d = describe.skipIf(!dbReady);

d('tournament.listPendingForPlayer RBAC (CR-04)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;

  beforeAll(async () => {
    if (!dbReady) return;
    dbHandle = await freshDb();
    fixtures = await seedPhase4(dbHandle.db, { includeTournamentResults: false });

    // Plant a parent_child_links row from the role-matrix parent to the
    // role-matrix player so the parent-branch positive probe succeeds.
    // Mirrors tests/integration/rbac-matrix-phase4.test.ts:201-210 — the
    // RLS+RBAC test suite plants the link in beforeAll rather than
    // expecting seedPhase4 to do it (the link belongs to the RBAC
    // contract, not the operational-table fixture).
    await rawDb.execute(sql`
      INSERT INTO parent_child_links
        (parent_user_id, child_user_id, consent_given_at, linked_by)
      VALUES (
        ${fixtures.users.parent}::uuid,
        ${fixtures.users.player}::uuid,
        now(),
        ${fixtures.users.technical_director}::uuid
      )
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('player querying own pending → ok', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    const res = await caller.tournament.listPendingForPlayer({});
    expect(Array.isArray(res.pending)).toBe(true);
  });

  it('player querying other player → FORBIDDEN errors.tournament.notOwnPlayer', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    await expect(
      caller.tournament.listPendingForPlayer({
        playerUserId: fixtures.extraUsers.playerB,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'errors.tournament.notOwnPlayer',
    });
  });

  it('trainer querying any player → ok (no probe at procedure boundary)', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.trainer,
      role: 'trainer',
    });
    const res = await caller.tournament.listPendingForPlayer({
      playerUserId: fixtures.users.player,
    });
    expect(Array.isArray(res.pending)).toBe(true);
  });

  it('technical_director querying any player → ok', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.technical_director,
      role: 'technical_director',
    });
    const res = await caller.tournament.listPendingForPlayer({
      playerUserId: fixtures.users.player,
    });
    expect(Array.isArray(res.pending)).toBe(true);
  });

  it('parent querying own child → ok (parent_child_links probe passes)', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.parent,
      role: 'parent',
    });
    const res = await caller.tournament.listPendingForPlayer({
      playerUserId: fixtures.users.player,
    });
    expect(Array.isArray(res.pending)).toBe(true);
  });

  it('parent querying non-child → FORBIDDEN errors.tournament.notChildOfParent', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.parent,
      role: 'parent',
    });
    await expect(
      caller.tournament.listPendingForPlayer({
        playerUserId: fixtures.extraUsers.playerB,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'errors.tournament.notChildOfParent',
    });
  });

  it('medical_staff → FORBIDDEN role_not_allowed', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.medical_staff,
      role: 'medical_staff',
    });
    await expect(
      caller.tournament.listPendingForPlayer({
        playerUserId: fixtures.users.player,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'role_not_allowed',
    });
  });

  it('sparring_partner → FORBIDDEN role_not_allowed', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.sparring_partner,
      role: 'sparring_partner',
    });
    await expect(
      caller.tournament.listPendingForPlayer({
        playerUserId: fixtures.users.player,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'role_not_allowed',
    });
  });

  it('academy_manager → FORBIDDEN role_not_allowed', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.academy_manager,
      role: 'academy_manager',
    });
    await expect(
      caller.tournament.listPendingForPlayer({
        playerUserId: fixtures.users.player,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'role_not_allowed',
    });
  });
});
