/**
 * Unit tests for src/lib/cache.ts (D-14 vendor-lock-in mitigation barrier)
 * and src/server/auth/revocation.ts (D-09 JWT revocation list).
 *
 * Strategy:
 *   - Mock @upstash/redis at the module boundary so no network is touched.
 *   - Each test imports the SUT via dynamic import after the mock is registered
 *     (vitest.resetModules in beforeEach guarantees a fresh `cache` singleton
 *     bound to the freshly-mocked Redis client).
 *
 * What we are asserting:
 *   - cache.set(k, v, 60) → Upstash set called with `{ ex: 60 }` (TTL plumbing)
 *   - cache.incr first call (counter == 1) → expire is called with the TTL
 *   - cache.incr later call (counter > 1) → expire is NOT called again
 *     (window-extension bug avoidance: TTL only set on the first hit)
 *   - setRevoked → writes `revoked:${userId}` with the reason and ttl
 *   - isRevoked → returns null when key absent, returns the reason when present
 *
 * D-14 hygiene: this test file imports @/lib/cache and @/server/auth/revocation,
 * never @upstash/redis directly — same constraint the rest of the app obeys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level vi.fn() handles so tests can mutate behaviour and inspect calls.
const upstashGet = vi.fn();
const upstashSet = vi.fn();
const upstashDel = vi.fn();
const upstashIncr = vi.fn();
const upstashExpire = vi.fn();
const upstashSadd = vi.fn();
const upstashSrem = vi.fn();
const upstashScard = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: upstashGet,
    set: upstashSet,
    del: upstashDel,
    incr: upstashIncr,
    expire: upstashExpire,
    sadd: upstashSadd,
    srem: upstashSrem,
    scard: upstashScard,
  })),
}));

beforeEach(() => {
  vi.resetModules();
  upstashGet.mockReset();
  upstashSet.mockReset();
  upstashDel.mockReset();
  upstashIncr.mockReset();
  upstashExpire.mockReset();
  upstashSadd.mockReset();
  upstashSrem.mockReset();
  upstashScard.mockReset();
});

describe('lib/cache abstraction (D-14)', () => {
  it('set with ttl calls Upstash set with { ex: ttl }', async () => {
    const { cache } = await import('@/lib/cache');
    await cache.set('k', 'v', 60);
    expect(upstashSet).toHaveBeenCalledWith('k', 'v', { ex: 60 });
  });

  it('set without ttl calls Upstash set without options', async () => {
    const { cache } = await import('@/lib/cache');
    await cache.set('k', 'v');
    expect(upstashSet).toHaveBeenCalledWith('k', 'v');
  });

  it('incr first call (counter == 1) sets TTL via expire', async () => {
    const { cache } = await import('@/lib/cache');
    upstashIncr.mockResolvedValue(1);
    await cache.incr('counter', 60);
    expect(upstashExpire).toHaveBeenCalledWith('counter', 60);
  });

  it('incr subsequent calls (counter > 1) do NOT set TTL again', async () => {
    const { cache } = await import('@/lib/cache');
    upstashIncr.mockResolvedValue(2);
    upstashExpire.mockClear();
    await cache.incr('counter', 60);
    expect(upstashExpire).not.toHaveBeenCalled();
  });

  it('get returns null when Upstash returns null/undefined', async () => {
    const { cache } = await import('@/lib/cache');
    upstashGet.mockResolvedValue(null);
    expect(await cache.get('missing')).toBeNull();
    upstashGet.mockResolvedValue(undefined);
    expect(await cache.get('missing')).toBeNull();
  });

  it('sadd with ttl sets expiry only when member is newly added', async () => {
    const { cache } = await import('@/lib/cache');
    upstashSadd.mockResolvedValue(1); // 1 = newly added
    await cache.sadd('set', 'm1', 3600);
    expect(upstashExpire).toHaveBeenCalledWith('set', 3600);

    upstashExpire.mockClear();
    upstashSadd.mockResolvedValue(0); // 0 = already member
    await cache.sadd('set', 'm1', 3600);
    expect(upstashExpire).not.toHaveBeenCalled();
  });
});

describe('revocation (D-09)', () => {
  it('setRevoked writes revoked:{userId} with the reason as value', async () => {
    const { setRevoked } = await import('@/server/auth/revocation');
    await setRevoked('u1', 'role_changed', 86400);
    expect(upstashSet).toHaveBeenCalledWith('revoked:u1', 'role_changed', { ex: 86400 });
  });

  it('isRevoked returns null when key missing', async () => {
    const { isRevoked } = await import('@/server/auth/revocation');
    upstashGet.mockResolvedValue(null);
    expect(await isRevoked('u1')).toBeNull();
  });

  it('isRevoked returns reason when key present', async () => {
    const { isRevoked } = await import('@/server/auth/revocation');
    upstashGet.mockResolvedValue('parent_link_revoked');
    expect(await isRevoked('u1')).toBe('parent_link_revoked');
  });

  it('clearRevocation deletes the key', async () => {
    const { clearRevocation } = await import('@/server/auth/revocation');
    await clearRevocation('u1');
    expect(upstashDel).toHaveBeenCalledWith('revoked:u1');
  });
});
