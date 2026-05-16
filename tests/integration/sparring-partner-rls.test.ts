/**
 * Phase 4 Wave 2 — sparring partner attachment + app-layer role check + RLS Branch 6.
 *
 * Covers:
 *   - D-63: sparring partners attached via session_sparring_partners junction
 *     (event_id, sparring_partner_id) → users.id where role='sparring_partner'.
 *   - Assumption A5 (RESEARCH): the FK row-filter (role must equal
 *     'sparring_partner') is enforced at the APP layer because PostgreSQL
 *     FKs cannot natively constrain referenced rows by a non-PK column
 *     predicate. The `event.attachSparringPartners` mutation verifies each
 *     user's role and rejects with `errors.sparring.notASparringPartner`.
 *   - CAL-04 Branch 6: calendar_events_visible_to (Plan 04-02 migration 0018)
 *     reads session_sparring_partners → sparring partners SEE the events they
 *     are linked to. Out-of-scope sessions stay invisible.
 *   - Audit: sparring_partner_attached emitted on every junction INSERT.
 *
 * Reference: 04-CONTEXT.md D-63; .planning/phases/04-kerndomein/04-02-SUMMARY.md
 *            (Branch 6 + junction live in migration 0018);
 *            src/server/trpc/routers/calendar.ts event.attachSparringPartners.
 */
import { sql } from 'drizzle-orm';
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

describe('sparring partner attachment + RLS Branch 6 (D-63, A5, CAL-04)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>> | undefined;
  let calFixtures:
    | Awaited<ReturnType<typeof seedCalendarFixtures>>
    | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
    calFixtures = await seedCalendarFixtures(dbHandle.db, seeded.users);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  describe('app-layer FK row-filter (Assumption A5)', () => {
    it('attach succeeds when target user has role=sparring_partner', async () => {
      if (!dbReady || !seeded || !calFixtures) return;
      const trainingId = calFixtures.eventIds.training; // non-recurring training
      const sp = seeded.users.sparring_partner;
      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      const result = await td.calendar.event.attachSparringPartners({
        eventId: trainingId,
        sparringPartnerIds: [sp],
      });
      expect(result.ok).toBe(true);
      expect(result.attached).toBe(1);
    });

    it('attach is rejected when target user role != sparring_partner', async () => {
      if (!dbReady || !seeded || !calFixtures) return;
      const trainingId = calFixtures.eventIds.training_recurring;
      // Use a player as the (wrong) target.
      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      await expect(
        td.calendar.event.attachSparringPartners({
          eventId: trainingId,
          sparringPartnerIds: [seeded.users.player],
        }),
      ).rejects.toThrow(/notASparringPartner/);
    });

    it('attach is rejected when targeting an unknown user_id', async () => {
      if (!dbReady || !seeded || !calFixtures) return;
      const trainingId = calFixtures.eventIds.training_recurring;
      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      // Valid v4 UUID format that doesn't exist as a user.
      const ghostId = '11111111-2222-4333-8444-aaaaaaaaaaaa';
      await expect(
        td.calendar.event.attachSparringPartners({
          eventId: trainingId,
          sparringPartnerIds: [ghostId],
        }),
      ).rejects.toThrow(/notASparringPartner/);
    });
  });

  describe('RLS Branch 6 (CAL-04 — sparring partner visibility)', () => {
    it('sparring_partner user sees calendar_events of sessions they are linked to', async () => {
      if (!dbReady || !seeded || !calFixtures) return;
      const trainingId = calFixtures.eventIds.training;
      const sp = seeded.users.sparring_partner;
      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });

      // Ensure the attachment exists (idempotent — first test in this file
      // also attached but test ordering is not guaranteed in vitest).
      await td.calendar.event.attachSparringPartners({
        eventId: trainingId,
        sparringPartnerIds: [sp],
      });

      const sparring = appCaller({ userId: sp, role: 'sparring_partner' });
      const from = new Date();
      from.setUTCDate(from.getUTCDate() - 30);
      const to = new Date();
      to.setUTCDate(to.getUTCDate() + 60);
      const visible = await sparring.calendar.list({ from, to });
      const visibleIds = visible.map((e: { id: string }) => e.id);
      expect(visibleIds).toContain(trainingId);
    });

    it('sparring_partner user does NOT see calendar_events of sessions they are NOT linked to', async () => {
      if (!dbReady || !seeded || !calFixtures) return;
      const sp = seeded.users.sparring_partner;
      const sparring = appCaller({ userId: sp, role: 'sparring_partner' });
      const from = new Date();
      from.setUTCDate(from.getUTCDate() - 30);
      const to = new Date();
      to.setUTCDate(to.getUTCDate() + 60);
      const visible = await sparring.calendar.list({ from, to });
      const visibleIds = visible.map((e: { id: string }) => e.id);
      // The other-academy stage and tournament should NOT be visible to a
      // sparring partner unless attached (they aren't attached here).
      expect(visibleIds).not.toContain(calFixtures.eventIds.tournament);
      expect(visibleIds).not.toContain(calFixtures.eventIds.stage);
    });

    it('sparring_partner has no session_participants row (D-63 — players only)', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const sp = seeded.users.sparring_partner;
      const rowsRaw: { count: string | number }[] = (await dbHandle.db.execute(
        sql`SELECT COUNT(*)::text AS count FROM session_participants
            WHERE user_id = ${sp}::uuid`,
      )) as unknown as { count: string | number }[];
      const row = (Array.isArray(rowsRaw)
        ? rowsRaw
        : (rowsRaw as { rows?: typeof rowsRaw }).rows ?? [])[0];
      // D-63: sparring partners are NOT scored — no session_participants row.
      expect(Number(row?.count ?? 0)).toBe(0);
    });
  });

  describe('Audit: sparring_partner_attached emission', () => {
    it('attaching a sparring_partner emits audit code sparring_partner_attached', async () => {
      if (!dbReady || !seeded || !calFixtures || !dbHandle) return;
      const trainingId = calFixtures.eventIds.training_recurring;
      const sp = seeded.users.sparring_partner;

      // Snapshot pre-count.
      const beforeRaw: { c: string | number }[] = (await dbHandle.db.execute(
        sql`SELECT COUNT(*)::text AS c FROM audit_log
            WHERE action = 'sparring_partner_attached'`,
      )) as unknown as { c: string | number }[];
      const before = (Array.isArray(beforeRaw)
        ? beforeRaw
        : (beforeRaw as { rows?: typeof beforeRaw }).rows ?? [])[0];
      const beforeCount = Number(before?.c ?? 0);

      const td = appCaller({
        userId: seeded.users.technical_director,
        role: 'technical_director',
      });
      await td.calendar.event.attachSparringPartners({
        eventId: trainingId,
        sparringPartnerIds: [sp],
      });

      const afterRaw: { c: string | number }[] = (await dbHandle.db.execute(
        sql`SELECT COUNT(*)::text AS c FROM audit_log
            WHERE action = 'sparring_partner_attached'`,
      )) as unknown as { c: string | number }[];
      const after = (Array.isArray(afterRaw)
        ? afterRaw
        : (afterRaw as { rows?: typeof afterRaw }).rows ?? [])[0];
      const afterCount = Number(after?.c ?? 0);
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);
    });

    it('FK sparring_partner_id references users.id (DB-level FK present)', async () => {
      if (!dbReady || !dbHandle) return;
      // Verify the FK constraint exists at the DB layer (junction →
      // users.id), defense-in-depth for the app-layer role filter.
      const fkRaw: { conname: string }[] = (await dbHandle.db.execute(sql`
        SELECT conname FROM pg_constraint
         WHERE contype = 'f'
           AND conrelid = 'public.session_sparring_partners'::regclass
           AND confrelid = 'public.users'::regclass
      `)) as unknown as { conname: string }[];
      const rows = Array.isArray(fkRaw)
        ? fkRaw
        : (fkRaw as { rows?: typeof fkRaw }).rows ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
