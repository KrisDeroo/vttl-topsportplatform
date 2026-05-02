/**
 * SEC-03 — requireFreshSession middleware contract.
 *
 * STAYS RED until Plan 11 lands the actual freshSession middleware in
 * `src/server/trpc/middleware/freshSession.ts`. The test below documents the
 * contract: middleware throws TRPCError FORBIDDEN with message `re_auth_required`
 * when the caller's freshUntil window has expired (1h, per Plan 05 auth.ts
 * session.freshAge).
 */
import { describe, it, expect } from 'vitest';

describe('SEC-03 freshSession middleware', () => {
  it('returns FORBIDDEN: re_auth_required when freshUntil expired', async () => {
    const mod = await import('@/server/trpc/middleware/freshSession');
    const ctx = {
      scope: {
        fresh: false,
        userId: 'u1',
        role: 'player',
        academyIds: [],
        linkedPlayerIds: [],
        locale: 'nl',
        issuedAt: Date.now(),
      },
    } as any;
    await expect(
      (mod.requireFreshSession as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 're_auth_required' });
  });
});
