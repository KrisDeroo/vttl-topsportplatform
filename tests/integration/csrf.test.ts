/**
 * SEC-02 — Origin-mismatch CSRF middleware contract.
 *
 * Better Auth's session cookie defaults to SameSite=Lax which blocks most
 * cross-site CSRF on state-changing requests. The csrf middleware here is the
 * belt for non-browser clients (curl, native apps) that bypass cookie SameSite
 * rules — it validates the Origin header against env.NEXT_PUBLIC_APP_URL.
 *
 * Three cases:
 *   1. Foreign Origin -> FORBIDDEN with message csrf_origin_mismatch
 *   2. Matching Origin -> next() executes and returns its value
 *   3. No Origin (server-to-server, same-origin first-party) -> next() executes
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  // Stub env values needed by csrf middleware before module load.
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
});

describe('SEC-02 CSRF — Origin validation', () => {
  it('rejects request with foreign Origin', async () => {
    const { csrfMiddleware } = await import('@/server/trpc/middleware/csrf');
    const mw = csrfMiddleware(() => 'http://evil.example');
    await expect(
      (mw as any)({ next: async () => 'ok' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'csrf_origin_mismatch' });
  });

  it('passes request with matching Origin', async () => {
    const { csrfMiddleware } = await import('@/server/trpc/middleware/csrf');
    const mw = csrfMiddleware(() => 'http://localhost:3000');
    await expect((mw as any)({ next: async () => 'ok' })).resolves.toBe('ok');
  });

  it('passes request with no Origin (server-to-server)', async () => {
    const { csrfMiddleware } = await import('@/server/trpc/middleware/csrf');
    const mw = csrfMiddleware(() => null);
    await expect((mw as any)({ next: async () => 'ok' })).resolves.toBe('ok');
  });
});
