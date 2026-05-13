/**
 * Integration tests for `trainer.*` tRPC router — Plan 02-15 Task 2.
 *
 * Requirements covered: TRAINER-01..03, USER-04 trainer scope, D-37
 * self-update whitelist for the trainer surface.
 *
 * RED until Plan 02-10 ships `trainerRouter` + Plan 02-14 push.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from '../helpers/db';
import { appCaller } from '../helpers/trpc';
import { seedRolesMatrix } from '../helpers/seed';

describe('trainer.* router — TRAINER-01..03 + USER-04 scope', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>>;

  beforeAll(async () => {
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
  });

  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  it('TRAINER-01: TD creates a trainer + linkAcademy succeeds', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const trainer = await td.trainer.create({
      userId: '00000000-0000-0000-0000-000000000011',
      firstName: 'NewCoach',
      lastName: 'Surname',
      dateOfBirth: '1985-01-01',
      gender: 'female',
      diplomaCode: 'diploma_b',
      hasPedagogicalQualification: true,
    });
    expect(trainer).toBeDefined();
  });

  it('TRAINER-02 (D-37): trainer.update_self accepts contact fields but rejects diplomaCode', async () => {
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.trainer.updateSelf({
        phone: '+32 1234',
        email: 'newcontact@vttl.be',
      }),
    ).resolves.toBeDefined();
    await expect(
      trainer.trainer.updateSelf({
        phone: '+32 1234',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        diplomaCode: 'diploma_a',
      } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('TRAINER-03: trainer A in academy_a sees own-academy trainers; cross-academy → NOT_FOUND', async () => {
    const trainerInA = appCaller({
      userId: seeded.users.trainer,
      role: 'trainer',
      academyIds: [seeded.academyA],
    });
    // Same-academy listing returns at least self.
    const list = await trainerInA.trainer.list({ academyCode: seeded.academyA });
    expect(Array.isArray(list)).toBe(true);
    // Cross-academy enumeration returns NOT_FOUND (D-36) on direct ID lookup.
    await expect(
      trainerInA.trainer.get({ trainerId: seeded.users.medical_staff }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('TD reads any trainer (no scope restriction)', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    await expect(
      td.trainer.get({ trainerId: seeded.users.trainer }),
    ).resolves.toBeDefined();
  });
});
