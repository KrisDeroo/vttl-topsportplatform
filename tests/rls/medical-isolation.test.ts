import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, rawPgAsAppUser } from '../helpers/db';

describe('RLS medical isolation — GDPR-03, CRIT-2', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  const trainerId = '11111111-1111-1111-1111-111111111111';
  const foreignPlayerId = '22222222-2222-2222-2222-222222222222';
  const tdId = '33333333-3333-3333-3333-333333333333';

  beforeAll(async () => {
    dbHandle = await freshDb();
  });
  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  it('trainer SELECT on medical_events for foreign player returns 0 rows', async () => {
    await using cx = (await rawPgAsAppUser({ userId: trainerId, role: 'trainer' })) as Exclude<
      Awaited<ReturnType<typeof rawPgAsAppUser>>,
      unknown[]
    >;
    const r = await cx.query(`SELECT id FROM medical_events WHERE player_user_id = $1`, [
      foreignPlayerId,
    ]);
    expect(r.rows.length).toBe(0);
  });

  it('technical_director SELECT on medical_events returns the event', async () => {
    await using cx = (await rawPgAsAppUser({
      userId: tdId,
      role: 'technical_director',
    })) as Exclude<Awaited<ReturnType<typeof rawPgAsAppUser>>, unknown[]>;
    const r = await cx.query(`SELECT id FROM medical_events WHERE player_user_id = $1`, [
      foreignPlayerId,
    ]);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('app_user has NO direct SELECT on medical_access_audit (block-all policy)', async () => {
    await using cx = (await rawPgAsAppUser({
      userId: tdId,
      role: 'technical_director',
    })) as Exclude<Awaited<ReturnType<typeof rawPgAsAppUser>>, unknown[]>;
    const r = await cx.query(`SELECT id FROM medical_access_audit LIMIT 1`);
    expect(r.rows.length).toBe(0); // policy USING (false) — no rows ever
  });
});
