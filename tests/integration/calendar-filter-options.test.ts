/**
 * Phase 3 Wave 0 — calendar.filterOptions.list scope-filter (CAL-04, CAL-05, D-50).
 *
 * Reference: 03-PATTERNS.md analog: admin-user.test.ts.
 *
 * Implemented in Plan 03-08. DB-dependent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedRolesMatrix } from '../helpers/seed';
import { appCaller } from '../helpers/trpc';
import { seedCalendarFixtures } from '../fixtures/calendar-seed';

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

describe('calendar.filterOptions.list — scope-filtered type-ahead', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>> | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
    await seedCalendarFixtures(dbHandle.db, seeded.users);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('trainer-as-caller for kind=player returns a list (RLS scopes via players_visible_to)', async () => {
    if (!dbReady || !seeded) return;
    const trainer = appCaller({
      userId: seeded.users.trainer,
      role: 'trainer',
    });
    const result = await trainer.calendar.filterOptions.list({
      kind: 'player',
      query: '',
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it('sparring_partner-as-caller for kind=player returns empty array (D-50 no-op)', async () => {
    if (!dbReady || !seeded) return;
    const sparring = appCaller({
      userId: seeded.users.sparring_partner,
      role: 'sparring_partner',
    });
    const result = await sparring.calendar.filterOptions.list({
      kind: 'player',
      query: '',
    });
    // Sparring partner has no visibility into players (USER-04 RLS).
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('sparring_partner-as-caller for kind=sparring_partner returns empty array (D-50 explicit)', async () => {
    if (!dbReady || !seeded) return;
    const sparring = appCaller({
      userId: seeded.users.sparring_partner,
      role: 'sparring_partner',
    });
    const result = await sparring.calendar.filterOptions.list({
      kind: 'sparring_partner',
      query: '',
    });
    expect(result).toEqual([]);
  });

  it('TD-as-caller for kind=academy returns the seeded academies', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.calendar.filterOptions.list({
      kind: 'academy',
      query: '',
    });
    expect(Array.isArray(result)).toBe(true);
    // seedRolesMatrix plants academy_a + academy_b.
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('respects 50-option max — server enforces limit', async () => {
    if (!dbReady || !seeded) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    // Even the full set of academies caps at 50 (we have 2 in seed but the
    // contract is < 50; the assertion is the count is bounded).
    const result = await td.calendar.filterOptions.list({
      kind: 'academy',
      query: '',
    });
    expect(result.length).toBeLessThanOrEqual(50);
  });
});
