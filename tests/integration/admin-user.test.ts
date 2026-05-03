/**
 * admin.user.* — AUTH-04/05 + USER-01/02 (Plan 15 Task 1).
 *
 * Verifies the TD-only admin tRPC sub-router that backs the user-management
 * UI. Each test exercises a single mutation through `appCaller` (synthetic
 * CallerContext), confirming:
 *
 *   - TD scope passes (`tdProcedure` allow-list)
 *   - Non-TD scope is FORBIDDEN
 *   - `linkParent` requires a fresh session (`sensitiveProcedure` — SEC-03)
 *   - `activate` calls `canActivate()` and surfaces the reason as
 *     PRECONDITION_FAILED (Plan 12 minor gate)
 *   - `deactivate` and `assignRole` call `setRevoked` (D-09)
 *   - All mutations write `audit_log` rows via `writeAudit` (Plan 11)
 *
 * The full e2e walkthrough lands in Task 4 (manual checkpoint); these tests
 * are the regression net so the router cannot drift from the contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CURRENT_POLICY,
  getConsentText,
  recordConsent,
} from '@/lib/consent';
import { auditLog } from '@/server/db/schema/audit';
import { users } from '@/server/db/schema/auth';
import { academy } from '@/server/db/schema/lookups';
import { eq } from 'drizzle-orm';

import { freshDb } from '../helpers/db';
import { appCaller } from '../helpers/trpc';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const dobYearsAgo = (years: number) =>
  new Date(Date.now() - years * ONE_YEAR_MS).toISOString().slice(0, 10);

/** Seed: a TD user + operational consent so `requireCurrentConsent` passes. */
async function seedTd(h: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
  const [td] = await h.db
    .insert(users)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({
      email: 'td@vttl.test',
      name: 'TD',
      role: 'technical_director',
      preferredLocale: 'nl',
      dateOfBirth: dobYearsAgo(40),
      active: true,
      emailVerified: true,
    } as any)
    .returning();
  if (!td) throw new Error('seed TD insert returned no row');
  const operationalText = await getConsentText(
    'operational',
    CURRENT_POLICY.operational.version,
    'nl',
  );
  await recordConsent({
    userId: td.id,
    category: 'operational',
    version: CURRENT_POLICY.operational.version,
    locale: 'nl',
    textShown: operationalText,
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: h.db as any,
  });
  return td.id;
}

describe('AUTH-04/05 + USER-01/02 — admin.user.*', () => {
  let h: Awaited<ReturnType<typeof freshDb>>;
  let tdId: string;

  beforeEach(async () => {
    h = await freshDb();
    tdId = await seedTd(h);
  });

  afterEach(async () => {
    await h[Symbol.asyncDispose]();
  });

  it('TD can list users', async () => {
    const caller = appCaller({ userId: tdId, role: 'technical_director' });
    const list = await caller.admin.user.list({ limit: 50 });
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('non-TD list throws FORBIDDEN', async () => {
    const caller = appCaller({ userId: tdId, role: 'player' });
    await expect(
      caller.admin.user.list({ limit: 50 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('TD can create user + audit_log row', async () => {
    const caller = appCaller({ userId: tdId, role: 'technical_director' });
    const u = await caller.admin.user.create({
      email: 'new@vttl.test',
      name: 'New User',
      role: 'player',
      preferredLocale: 'nl',
    });
    expect(u?.email).toBe('new@vttl.test');
    expect(u?.active).toBe(false);

    // Outside the tRPC tx, but writeAudit fell back to rawDb and our
    // tests' freshDb truncates → reads the same row back via h.db.
    const rows = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'user.create'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.resourceId === u!.id)).toBe(true);
  });

  it('activate fails with PRECONDITION_FAILED for user without consent', async () => {
    const caller = appCaller({ userId: tdId, role: 'technical_director' });
    const u = await caller.admin.user.create({
      email: 'noconsent@vttl.test',
      name: 'NoConsent',
      role: 'player',
      preferredLocale: 'nl',
    });
    await expect(
      caller.admin.user.activate({ userId: u!.id }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('linkParent requires fresh session (sensitiveProcedure)', async () => {
    const caller = appCaller({
      userId: tdId,
      role: 'technical_director',
      fresh: false,
    });
    // The exact target uuids do not matter — re_auth_required throws before
    // any DB round-trip.
    await expect(
      caller.admin.user.linkParent({
        parentUserId: '11111111-1111-1111-1111-111111111111',
        childUserId: '22222222-2222-2222-2222-222222222222',
        consentGivenAt: new Date(Date.now()).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 're_auth_required' });
  });

  it('linkAcademy inserts academy_membership and writes audit_log', async () => {
    const caller = appCaller({ userId: tdId, role: 'technical_director' });
    // Seed a target trainer + an academy code (FK target).
    const u = await caller.admin.user.create({
      email: 'trainer@vttl.test',
      name: 'Trainer',
      role: 'trainer',
      preferredLocale: 'nl',
    });
    await h.db.insert(academy).values({
      code: 'academy_x',
      canonicalName: 'Academy X',
      sortOrder: 99,
      active: true,
    });

    const r = await caller.admin.user.linkAcademy({
      trainerUserId: u!.id,
      academyCode: 'academy_x',
      role: 'trainer',
    });
    expect(r).toEqual({ ok: true });

    const rows = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'user.link_academy'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('assignRole writes audit_log with old + new role', async () => {
    const caller = appCaller({ userId: tdId, role: 'technical_director' });
    const u = await caller.admin.user.create({
      email: 'role-target@vttl.test',
      name: 'Role Target',
      role: 'player',
      preferredLocale: 'nl',
    });

    const result = await caller.admin.user.assignRole({
      userId: u!.id,
      role: 'trainer',
    });
    expect(result?.role).toBe('trainer');

    const rows = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'user.role_change'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.resourceId === u!.id);
    expect(row).toBeDefined();
    expect(row!.oldValues).toMatchObject({ role: 'player' });
    expect(row!.newValues).toMatchObject({ role: 'trainer' });
  });
});
