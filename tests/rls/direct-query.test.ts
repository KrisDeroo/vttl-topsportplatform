import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, rawPgAsAppUser } from '../helpers/db';

describe('RLS direct-query — USER-05, CRIT-1', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  const trainerId = '11111111-1111-1111-1111-111111111111';
  const foreignPlayerId = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    dbHandle = await freshDb();
    // Seed: 1 trainer + 1 foreign player (no academy overlap) + 1 medical_event for the foreign player
    // Filled when Plan 02 schema lands.
  });
  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  it('trainer connecting via raw pg as app_user role cannot SELECT foreign player rows', async () => {
    await using cx = (await rawPgAsAppUser({ userId: trainerId, role: 'trainer' })) as Exclude<
      Awaited<ReturnType<typeof rawPgAsAppUser>>,
      unknown[]
    >;
    const r = await cx.query(`SELECT id FROM users WHERE id = $1`, [foreignPlayerId]);
    expect(r.rows.length).toBe(0); // RLS hides the row
  });

  it('app_user role does NOT have UPDATE permission on audit_log', async () => {
    await using cx = (await rawPgAsAppUser({ userId: trainerId, role: 'trainer' })) as Exclude<
      Awaited<ReturnType<typeof rawPgAsAppUser>>,
      unknown[]
    >;
    await expect(cx.query(`UPDATE audit_log SET outcome = 'tampered' WHERE id = 1`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});
