/**
 * CallerContext middleware contract tests (Plan 11).
 *
 * The bulk of these are unit-style tests that mount each middleware in
 * isolation, hand it a stub `ctx`, and assert the canonical TRPCError shapes.
 * They run without a Postgres testcontainer (mocked Upstash, no DB I/O).
 *
 * MAJOR-11 note: the D-08 JWT-claim cache is deferred to v1.1; Phase 1 ships
 * "always fresh" mode (createContext rebuilds scope every request). The
 * `STALENESS_MS` / `scope_stale` gate from earlier drafts has been removed —
 * see `src/server/trpc/middleware/auth.ts` block-comment for rationale. The
 * test for `scope_stale` is intentionally absent.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the revocation list before any middleware module loads — `requireAuth`
// imports `isRevoked` at top level, so the spy must be installed first.
vi.mock('@/server/auth/revocation', () => ({
  isRevoked: vi.fn().mockResolvedValue(null),
  setRevoked: vi.fn(),
  clearRevocation: vi.fn(),
}));

describe('requireAuth — D-09 revocation (D-08 cache deferred to v1.1)', () => {
  it('throws UNAUTHORIZED when scope is null', async () => {
    const { requireAuth } = await import('@/server/trpc/middleware/auth');
    const ctx = {
      session: null,
      scope: null,
      log: { info: vi.fn() },
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requireAuth as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('throws session_revoked when revocation list returns reason', async () => {
    const { isRevoked } = await import('@/server/auth/revocation');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (isRevoked as any).mockResolvedValueOnce('role_changed');
    const { requireAuth } = await import('@/server/trpc/middleware/auth');
    const ctx = {
      session: { user: { id: 'u1' } },
      scope: {
        userId: 'u1',
        role: 'player',
        academyIds: [],
        linkedPlayerIds: [],
        locale: 'nl',
        issuedAt: Date.now(),
        fresh: true,
      },
      log: { info: vi.fn() },
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requireAuth as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'session_revoked',
    });
  });

  it('passes when revocation list is empty', async () => {
    const { isRevoked } = await import('@/server/auth/revocation');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (isRevoked as any).mockResolvedValueOnce(null);
    const { requireAuth } = await import('@/server/trpc/middleware/auth');
    const ctx = {
      session: { user: { id: 'u1' } },
      scope: {
        userId: 'u1',
        role: 'player',
        academyIds: [],
        linkedPlayerIds: [],
        locale: 'nl',
        issuedAt: Date.now(),
        fresh: true,
      },
      log: { info: vi.fn() },
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requireAuth as any)({ ctx, next: async () => 'ok' }),
    ).resolves.toBe('ok');
  });
});

describe('requireFreshSession — SEC-03', () => {
  it('throws re_auth_required when scope.fresh === false', async () => {
    const { requireFreshSession } = await import(
      '@/server/trpc/middleware/freshSession'
    );
    const ctx = { scope: { fresh: false } };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requireFreshSession as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 're_auth_required',
    });
  });

  it('passes when scope.fresh === true', async () => {
    const { requireFreshSession } = await import(
      '@/server/trpc/middleware/freshSession'
    );
    const ctx = { scope: { fresh: true } };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requireFreshSession as any)({ ctx, next: async () => 'ok' }),
    ).resolves.toBe('ok');
  });

  it('throws re_auth_required when scope is null', async () => {
    const { requireFreshSession } = await import(
      '@/server/trpc/middleware/freshSession'
    );
    const ctx = { scope: null };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (requireFreshSession as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 're_auth_required',
    });
  });
});

describe('requireRole', () => {
  it('throws role_not_allowed for wrong role', async () => {
    const { requireRole } = await import(
      '@/server/trpc/middleware/freshSession'
    );
    const mw = requireRole('technical_director');
    const ctx = { scope: { role: 'player' } };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mw as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'role_not_allowed',
    });
  });

  it('passes when role matches', async () => {
    const { requireRole } = await import(
      '@/server/trpc/middleware/freshSession'
    );
    const mw = requireRole('technical_director', 'medical_staff');
    const ctx = { scope: { role: 'medical_staff' } };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mw as any)({ ctx, next: async () => 'ok' }),
    ).resolves.toBe('ok');
  });

  it('throws when scope is null', async () => {
    const { requireRole } = await import(
      '@/server/trpc/middleware/freshSession'
    );
    const mw = requireRole('technical_director');
    const ctx = { scope: null };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mw as any)({ ctx, next: async () => undefined }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'role_not_allowed',
    });
  });
});

describe('audit middleware — writeAudit shape', () => {
  it('writeAudit passes all fields to db.insert', async () => {
    const inserted: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: async (row: unknown) => {
          inserted.push(row);
        },
      }),
    };
    const { writeAudit } = await import('@/server/trpc/middleware/audit');
    const ctx = {
      db: fakeDb,
      scope: { userId: 'u1' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-1',
    };
    await writeAudit(ctx, {
      action: 'user.deactivate',
      resourceType: 'user',
      resourceId: 'victim',
      newValues: { active: false },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      actorUserId: 'u1',
      action: 'user.deactivate',
      resourceType: 'user',
      resourceId: 'victim',
      newValues: { active: false },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-1',
      outcome: 'success',
    });
  });
});
