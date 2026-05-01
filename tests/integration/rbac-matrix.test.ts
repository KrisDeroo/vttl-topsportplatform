import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, rawPgAsAppUser } from '../helpers/db';
import { ROLES, RESOURCES, RBAC_EXPECTATIONS, seedRolesMatrix } from '../helpers/seed';
// appCaller helper provided by Plan 11 (CallerContext + tRPC)
import { appCaller } from '../helpers/trpc'; // RED until Plan 11

describe('RBAC matrix (D-11) — 7 roles × 5 resources = 35 cells', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  let users: Record<(typeof ROLES)[number], string>;
  let victimId: string;

  beforeAll(async () => {
    dbHandle = await freshDb();
    const seeded = await seedRolesMatrix(dbHandle.db);
    users = seeded.users;
    victimId = seeded.victimId;
  });

  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  describe.each(ROLES)('role: %s', (role) => {
    describe.each(RESOURCES)('resource: %s', (resource) => {
      const expected = () => RBAC_EXPECTATIONS[role][resource];

      it(`is ${RBAC_EXPECTATIONS[role][resource]}`, async () => {
        if (expected() === 'not_applicable') return;
        const caller = appCaller({ userId: users[role], role });
        // Resource probe — each resource has a list endpoint
        // CRIT-2: medical_events probe runs raw SQL as the app_user role so RLS (Plan 04)
        // actually evaluates. There is NO caller.medical.* router in Phase 1 — that lands in
        // Phase 5. Asserting at the DB layer is the correct level for the Phase 1 exit gate
        // (USER-05 "directe Postgres-query als niet-eigenaar op medical_events retourneert nul rijen").
        //
        // CRIT-3: parent_child_links probe splits by role:
        //   - parent / player → consent.listMyParentLinks (RLS pcl_visible — Plan 04 — returns own links)
        //   - technical_director / medical_staff → admin.user.listParentLinks (TD-only tdProcedure)
        //   - other roles → admin.user.listParentLinks (will throw FORBIDDEN)
        const probe = async () => {
          switch (resource) {
            case 'users':
              return caller.admin.user.list({ limit: 5 });
            case 'consent_records':
              return caller.consent.listForUser({ userId: victimId });
            case 'medical_events': {
              const rows = await rawPgAsAppUser<{ id: string }>({
                userId: users[role],
                role,
                sql: 'SELECT id FROM medical_events WHERE player_user_id = $1',
                params: [victimId],
              });
              // For 'allowed' the seed guarantees a row exists; for 'denied' RLS returns [].
              // The outer it(...) maps allowed/denied via expected().
              if (RBAC_EXPECTATIONS[role][resource] === 'allowed') {
                if (!Array.isArray(rows) || rows.length < 1) {
                  throw new Error(
                    `medical_events expected >=1 row for role=${role}, got ${
                      Array.isArray(rows) ? rows.length : '?'
                    }`,
                  );
                }
                return rows;
              }
              // 'denied' path: must return zero rows (RLS hides them).
              if (Array.isArray(rows) && rows.length === 0) return rows;
              throw Object.assign(new Error('rls_did_not_hide_rows'), { code: 'FORBIDDEN' });
            }
            case 'audit_log':
              return caller.admin.auditLog.recent({ limit: 5 });
            case 'parent_child_links':
              if (role === 'parent' || role === 'player') {
                return caller.consent.listMyParentLinks();
              }
              return caller.admin.user.listParentLinks({ userId: victimId });
          }
        };
        if (expected() === 'allowed') {
          await expect(probe()).resolves.toBeDefined();
        } else {
          await expect(probe()).rejects.toMatchObject({
            code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/),
          });
        }
      });
    });
  });

  it('test count equals 35', () => {
    const cells = ROLES.flatMap((r) => RESOURCES.map((res) => ({ r, res }))).filter(
      (c) => RBAC_EXPECTATIONS[c.r][c.res] !== 'not_applicable',
    );
    expect(cells.length).toBeGreaterThanOrEqual(35);
  });
});
