/**
 * Test helper — `appCaller` builds a tRPC caller bound to a synthetic
 * `CallerContext` so integration tests can exercise the full procedure chain
 * without going through Better Auth.
 *
 * Used by:
 *   - `tests/integration/rbac-matrix.test.ts` (Plan 17 RBAC matrix — D-11
 *     7 roles × 5 resources)
 *   - any future integration test that needs a typed tRPC entrypoint
 *
 * Defaults:
 *   - `fresh: true` — passes `requireFreshSession` by default; tests that need
 *     the stale path pass `fresh: false`.
 *   - `academyIds: []`, `linkedPlayerIds: []`, `locale: 'nl'` — minimal valid
 *     scope; tests override per assertion.
 *   - `requestId` randomised so audit_log rows are distinct between tests.
 *
 * Return type is intentionally `any`: the RBAC matrix test exercises sub-routers
 * (`admin.user.*`, `consent.*`) that are added by later plans (Plan 12 consent,
 * Plan 15 admin). Returning `appRouter.createCaller(ctx)` directly would type
 * those property accesses as compile errors before those plans land. The `any`
 * return type lets the matrix test compile today and run RED until the
 * sub-routers attach to `_app.ts` — matching the existing stub-helper pattern
 * in this repo.
 *
 * Note on `requireCurrentConsent`: tests that go through `protectedProcedure`
 * need a row in `consent_records` for `(userId, 'operational',
 * CURRENT_POLICY.operational.version, withdrawn_at IS NULL)`. The seed
 * helpers (`tests/helpers/seed.ts`) own that fixture; when the seed isn't
 * yet wired (Plan 02 RED), `requireCurrentConsent` will throw `re_consent_required`
 * — that's the contract.
 */
import { log } from '@/lib/log';
import type { Role } from '@/server/auth/permissions';
import { appRouter } from '@/server/trpc/routers/_app';
import type { CallerContext } from '@/server/trpc/trpc';

export interface AppCallerOptions {
  userId: string;
  role: Role;
  academyIds?: string[];
  linkedPlayerIds?: string[];
  locale?: 'nl' | 'en' | 'fr';
  fresh?: boolean;
  issuedAt?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function appCaller(opts: AppCallerOptions): any {
  // The Better Auth Session/User shapes carry many fields we don't need for
  // RBAC tests; cast through `unknown` to satisfy CallerContext without
  // dragging the full Better Auth type surface into test fixtures.
  const fakeUser = {
    id: opts.userId,
    role: opts.role,
    email: `${opts.userId}@test.local`,
    emailVerified: true,
    name: 'test',
  } as unknown as CallerContext['user'];
  const fakeSession = {
    id: `sess-${opts.userId}`,
    userId: opts.userId,
    token: 'test-token',
    expiresAt: new Date(Date.now() + 86_400_000),
  } as unknown as CallerContext['session'];

  const ctx: CallerContext = {
    session: fakeSession,
    user: fakeUser,
    scope: {
      userId: opts.userId,
      role: opts.role,
      academyIds: opts.academyIds ?? [],
      linkedPlayerIds: opts.linkedPlayerIds ?? [],
      locale: opts.locale ?? 'nl',
      issuedAt: opts.issuedAt ?? Date.now(),
      fresh: opts.fresh ?? true,
    },
    requestId: `test-${Math.random().toString(36).slice(2, 8)}`,
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    log: log.child({ test: true }),
  };

  return appRouter.createCaller(ctx);
}
