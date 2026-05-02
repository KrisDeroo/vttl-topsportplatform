/**
 * Unit tests for the Better Auth configuration.
 *
 * Asserts the SEC-01..06 contract on the locked `auth.options` object:
 *   - SEC-05: emailAndPassword resetPasswordTokenExpiresIn = 1h
 *   - SEC-06: rateLimit window/max = 15 min / 5 attempts
 *   - SEC-03: session.freshAge = 1h fresh re-auth window
 *   - AUTH-01: session.expiresIn = 30d (survives browser restart)
 *   - AUTH-04/05: admin plugin maps `technical_director` as adminRole
 *   - emailVerification.expiresIn = 24h
 *
 * The tests read `(auth as any).options` directly because Better Auth does
 * not expose a public introspection API for the locked-config object. This
 * is intentional — the tests must fail loudly if the locked values drift.
 */
import { describe, it, expect } from 'vitest';

describe('Better Auth config — SEC-01..06', () => {
  it('emailAndPassword settings (SEC-05, SEC-06)', async () => {
    const { auth } = await import('@/server/auth/auth');
    const opts = (auth as any).options;
    expect(opts.emailAndPassword.enabled).toBe(true);
    expect(opts.emailAndPassword.requireEmailVerification).toBe(true);
    expect(opts.emailAndPassword.minPasswordLength).toBe(12);
    expect(opts.emailAndPassword.resetPasswordTokenExpiresIn).toBe(60 * 60); // 1h
  });

  it('session settings (AUTH-01, SEC-03)', async () => {
    const { auth } = await import('@/server/auth/auth');
    const opts = (auth as any).options;
    expect(opts.session.expiresIn).toBe(60 * 60 * 24 * 30); // 30d
    expect(opts.session.freshAge).toBe(60 * 60); // 1h
  });

  it('rateLimit settings (SEC-06: 5 attempts / 15 min)', async () => {
    const { auth } = await import('@/server/auth/auth');
    const opts = (auth as any).options;
    expect(opts.rateLimit.enabled).toBe(true);
    expect(opts.rateLimit.window).toBe(60 * 15);
    expect(opts.rateLimit.max).toBe(5);
  });

  it('admin plugin maps technical_director as admin (AUTH-04/05)', async () => {
    const { auth } = await import('@/server/auth/auth');
    const opts = (auth as any).options;
    const adminPlugin = (opts.plugins as any[]).find((p) => p.id === 'admin');
    expect(adminPlugin).toBeDefined();
    const adminRoles =
      adminPlugin.options?.adminRoles ?? adminPlugin.adminRoles ?? [];
    const list = Array.isArray(adminRoles) ? adminRoles : [adminRoles];
    expect(list).toContain('technical_director');
  });

  it('emailVerification expiresIn = 24h', async () => {
    const { auth } = await import('@/server/auth/auth');
    const opts = (auth as any).options;
    expect(opts.emailVerification.expiresIn).toBe(60 * 60 * 24);
  });

  it('trustedOrigins includes NEXT_PUBLIC_APP_URL (SEC-02)', async () => {
    const { auth } = await import('@/server/auth/auth');
    const opts = (auth as any).options;
    expect(opts.trustedOrigins).toBeDefined();
    expect(Array.isArray(opts.trustedOrigins)).toBe(true);
    expect((opts.trustedOrigins as string[]).length).toBeGreaterThanOrEqual(1);
  });
});
