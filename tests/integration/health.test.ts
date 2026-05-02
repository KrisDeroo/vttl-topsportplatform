/**
 * OPS-06 — health endpoints (Plan 01-14, D-17).
 *
 * Two endpoints, two responsibilities:
 *  - /api/health/live  → process liveness only. UptimeRobot-friendly.
 *                        Returns 200 + { status: 'ok' } whether or not Postgres /
 *                        Redis are up. The only thing it tells you is "the Node
 *                        process answers HTTP" — Coolify uses it to decide whether
 *                        the container is alive at all.
 *  - /api/health/ready → dependency check. Probes Postgres (SELECT 1) and Upstash
 *                        Redis (cache.set) inside a 2s timeout each. Coolify's
 *                        deploy gate; returns 503 with per-component status when
 *                        any dependency fails or hangs.
 *
 * Tests run hermetically with vi.doMock() — no live DB / Redis required.
 * vi.resetModules() between tests is mandatory because each test rewires the
 * dependency mocks; without it, Vitest reuses the module-graph from the previous
 * test and the second test gets the first test's mocks.
 *
 * The "503 on timeout" tests use a never-resolving Promise to simulate a slow
 * upstream; the route's `withTimeout(2000ms)` wrapper rejects, allSettled
 * captures the rejection, and the route returns 503 with the failed component
 * marked `status: 'fail'`. Test timeouts are bumped to 5s to give the 2s
 * production timeout room to fire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OPS-06 health endpoints', () => {
  beforeEach(() => {
    // Each test rewires its own mocks — start from a clean module graph.
    vi.resetModules();
  });

  it('/api/health/live returns 200 always (no external probes)', async () => {
    const { GET } = await import('@/app/api/health/live/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('vttl-topsport-web');
    expect(typeof body.timestamp).toBe('string');
  });

  it('/api/health/ready returns 200 when DB + Redis OK', async () => {
    vi.doMock('@/server/db/client', () => ({
      db: { execute: vi.fn().mockResolvedValue([]) },
    }));
    vi.doMock('@/lib/cache', () => ({
      cache: { set: vi.fn().mockResolvedValue(undefined) },
    }));

    const { GET } = await import('@/app/api/health/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'postgres', status: 'ok' }),
        expect.objectContaining({ component: 'redis', status: 'ok' }),
      ]),
    );
  });

  it(
    '/api/health/ready returns 503 when DB times out',
    async () => {
      vi.doMock('@/server/db/client', () => ({
        // Never resolves — withTimeout(2000) should reject with 'timeout'.
        db: { execute: () => new Promise(() => {}) },
      }));
      vi.doMock('@/lib/cache', () => ({
        cache: { set: vi.fn().mockResolvedValue(undefined) },
      }));

      const { GET } = await import('@/app/api/health/ready/route');
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('degraded');
      const pg = body.components.find((c: { component: string }) => c.component === 'postgres');
      expect(pg.status).toBe('fail');
      expect(typeof pg.error).toBe('string');
    },
    5_000,
  );

  it(
    '/api/health/ready returns 503 when Redis times out',
    async () => {
      vi.doMock('@/server/db/client', () => ({
        db: { execute: vi.fn().mockResolvedValue([]) },
      }));
      vi.doMock('@/lib/cache', () => ({
        cache: { set: () => new Promise(() => {}) },
      }));

      const { GET } = await import('@/app/api/health/ready/route');
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('degraded');
      const rd = body.components.find((c: { component: string }) => c.component === 'redis');
      expect(rd.status).toBe('fail');
      expect(typeof rd.error).toBe('string');
    },
    5_000,
  );
});
