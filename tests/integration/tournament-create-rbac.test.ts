/**
 * Phase 4 Wave 4 — tournament create + addParticipant + removeParticipant RBAC (D-79).
 *
 * Covers TOURN-02 + D-79: tournament.create, tournament.addParticipant,
 * tournament.removeParticipant are TD-only. Distinct from result entry
 * (D-73 multi-role).
 *
 * Analog: tests/integration/rbac-matrix.test.ts.
 */
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

describe('tournament create + participant RBAC (D-79)', () => {
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

  const tournamentCreatePayload = () => ({
    naam: 'Test Open RBAC',
    startsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
    city: 'Brussel',
    country: 'BE',
    ageCategoryCode: 'age_senior',
    tournamentTypeCode: 'tournament_belgium',
    description: null,
  });

  it('TD can create tournament', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.tournament.create(tournamentCreatePayload());
    expect(result.eventId).toBeTruthy();
  });

  it('trainer CANNOT create tournament — FORBIDDEN', async () => {
    if (!dbReady || !seeded) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.tournament.create(tournamentCreatePayload()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('player CANNOT create tournament — FORBIDDEN', async () => {
    if (!dbReady || !seeded) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.create(tournamentCreatePayload()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('academy_manager CANNOT create tournament — FORBIDDEN', async () => {
    if (!dbReady || !seeded) return;
    const am = appCaller({
      userId: seeded.users.academy_manager,
      role: 'academy_manager',
    });
    await expect(
      am.tournament.create(tournamentCreatePayload()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('TD can addParticipant', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const t = await td.tournament.create(tournamentCreatePayload());
    const result = await td.tournament.addParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    expect(result.ok).toBe(true);
  });

  it('trainer CANNOT addParticipant — FORBIDDEN', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const t = await td.tournament.create(tournamentCreatePayload());
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.tournament.addParticipant({
        tournamentEventId: t.eventId,
        playerUserId: seeded.users.player,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('TD can removeParticipant', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const t = await td.tournament.create(tournamentCreatePayload());
    await td.tournament.addParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    const result = await td.tournament.removeParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    expect(result.ok).toBe(true);
  });

  it('player CANNOT removeParticipant — FORBIDDEN', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const t = await td.tournament.create(tournamentCreatePayload());
    await td.tournament.addParticipant({
      tournamentEventId: t.eventId,
      playerUserId: seeded.users.player,
    });
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.removeParticipant({
        tournamentEventId: t.eventId,
        playerUserId: seeded.users.player,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
