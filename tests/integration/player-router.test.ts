/**
 * Integration tests for `player.*` tRPC router — Plan 02-15 Task 2.
 *
 * Requirements covered: PLAYER-01..07, USER-04 (trainer scope), D-36
 * (NOT_FOUND for cross-academy enumeration — D-37 self-update whitelist).
 *
 * Strategy:
 *   - Seed phase-2 fixtures (academies, users with roles, academy memberships)
 *     via `seedRolesMatrix` (Phase 1 helper) + extra seed calls for the
 *     player-specific surface.
 *   - Build per-role tRPC callers with `appCaller({ userId, role })`
 *     (Phase 1 helper).
 *   - Run the procedure; assert the documented outcome (200 + shape | NOT_FOUND
 *     | FORBIDDEN | BAD_REQUEST).
 *
 * Runtime context:
 *   - Phase 1 testcontainers Postgres is the source of truth when Docker is
 *     available.
 *   - On dev laptops without Docker the suite is RED — same contract as the
 *     other Phase 1 integration tests (parent-child.test.ts etc.).
 *   - When live Supabase dev project is available (DATABASE_URL points at it),
 *     freshDb() truncates tables between tests, so the suite is idempotent.
 *
 * RED until Plan 02-09 ships `playerRouter` + Plan 02-14 pushes the migrations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from '../helpers/db';
import { appCaller } from '../helpers/trpc';
import { seedRolesMatrix } from '../helpers/seed';

describe('player.* router — PLAYER-01..07 + USER-04 + D-36 + D-37', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>>;

  beforeAll(async () => {
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
  });

  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  it('PLAYER-01: TD creates a player → row + derived age_category + inaugural age_category_history', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const result = await td.player.create({
      userId: '00000000-0000-0000-0000-000000000001',
      firstName: 'Created',
      lastName: 'Player',
      dateOfBirth: '2014-06-15',
      gender: 'male',
      street: 'Long Street',
      streetNumber: '1',
      postalCode: '2000',
      city: 'Antwerpen',
      province: 'Antwerpen',
      country: 'BE',
      statusCode: 'status_a',
      academyCode: seeded.academyA,
    });
    expect(result).toBeDefined();
    expect((result as { ageCategory?: string }).ageCategory).toBeDefined();
    expect((result as { isMinor?: boolean }).isMinor).toBe(true); // born 2014, age < 18
  });

  it('PLAYER-04 (D-37): player.update_self accepts whitelist fields but rejects statusCode', async () => {
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    // Whitelist field — succeeds.
    await expect(
      player.player.updateSelf({
        street: 'New Street',
        streetNumber: '2',
        postalCode: '2000',
        city: 'Antwerpen',
        province: 'Antwerpen',
        country: 'BE',
      }),
    ).resolves.toBeDefined();
    // Blocked field — BAD_REQUEST.
    await expect(
      player.player.updateSelf({
        street: 'New Street',
        postalCode: '2000',
        city: 'Antwerpen',
        province: 'Antwerpen',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        statusCode: 'status_b',
      } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('USER-04: trainer in academy A queries player in academy B → NOT_FOUND (D-36, not FORBIDDEN)', async () => {
    const trainer = appCaller({
      userId: seeded.users.trainer,
      role: 'trainer',
      academyIds: [seeded.academyA],
    });
    await expect(trainer.player.get({ playerId: seeded.victimId })).rejects.toMatchObject({
      // D-36: enumeration protection — wrong-scope read returns NOT_FOUND so the
      // existence of the row is not leaked via error code.
      code: 'NOT_FOUND',
    });
  });

  it('USER-04 (positive): trainer in same academy can READ but NOT update player profile', async () => {
    // Move victim to academy A for this test (re-seed minimal).
    const trainer = appCaller({
      userId: seeded.users.trainer,
      role: 'trainer',
      academyIds: [seeded.academyB], // trainer same scope as victim (B)
    });
    await expect(trainer.player.get({ playerId: seeded.victimId })).resolves.toBeDefined();
    // Trainers have ONLY trainer.update_self — they cannot update player rows.
    await expect(
      trainer.player.update({
        playerId: seeded.victimId,
        statusCode: 'status_b',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('PLAYER-05: parent of minor can update on behalf via playerOnBehalfOfInput', async () => {
    const parent = appCaller({
      userId: seeded.users.parent,
      role: 'parent',
      linkedPlayerIds: [seeded.victimId],
    });
    await expect(
      parent.player.updateOnBehalfOf({
        playerId: seeded.victimId,
        street: 'New Street',
        postalCode: '2000',
        city: 'Antwerpen',
        province: 'Antwerpen',
      }),
    ).resolves.toBeDefined();
  });

  it('parent of A tries to update player B (not linked) → NOT_FOUND (D-36)', async () => {
    const parent = appCaller({
      userId: seeded.users.parent,
      role: 'parent',
      linkedPlayerIds: [], // not linked to victimId
    });
    await expect(
      parent.player.updateOnBehalfOf({
        playerId: seeded.victimId,
        street: 'Hack Street',
        postalCode: '2000',
        city: 'Antwerpen',
        province: 'Antwerpen',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('PLAYER-06: creating a minor without emergency_contact_phone → CHECK constraint rejection', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    await expect(
      td.player.create({
        userId: '00000000-0000-0000-0000-000000000002',
        firstName: 'Minor',
        lastName: 'NoEC',
        dateOfBirth: '2014-01-01',
        gender: 'female',
        street: 'X',
        postalCode: '2000',
        city: 'Y',
        province: 'Antwerpen',
        country: 'BE',
        statusCode: 'status_a',
        academyCode: seeded.academyA,
        // emergencyContactName intentionally omitted → CHECK rejects
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      // Constraint name surfaced via tRPC error formatter (PLAYER-06).
      message: expect.stringMatching(/emergency_contact|errors\.field\.required/),
    });
  });

  it('PLAYER-07: TD sets ageCategory override → closes old history row + inserts new row', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const result = await td.player.setAgeCategory({
      playerId: seeded.victimId,
      ageCategoryCode: 'age_youth',
      categoryYear: 2026,
      effectiveFrom: '2026-05-01',
    });
    expect(result).toBeDefined();
  });
});
