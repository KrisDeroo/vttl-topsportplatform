/**
 * Vendor-neutral cache abstraction (D-14).
 *
 * Purpose: this file is the single boundary between the application and Upstash Redis.
 * Everything else in the codebase imports `cache` from here — never `@upstash/redis`
 * directly. The ESLint rule `no-restricted-imports` enforces this; only this file and
 * `src/server/trpc/middleware/rateLimit.ts` (which uses @upstash/ratelimit, which itself
 * needs the Redis instance) are allowlisted.
 *
 * Migration story: replacing Upstash with self-hosted Redis (Hetzner container, etc.)
 * is a one-file change — swap the `UpstashCache` class for a `NodeRedisCache` class
 * implementing the same `Cache` interface. No call site in the rest of the app changes.
 *
 * Forbidden Upstash-specific calls (D-14): `client.publish`, `client.xadd`, `client.lua`,
 * raw HASH ops outside this file. The `Cache` interface is a strict subset that maps
 * cleanly onto any Redis-compatible backend.
 *
 * Used by:
 *   - src/server/auth/revocation.ts (D-09 JWT revocation list)
 *   - src/server/trpc/middleware/rateLimit.ts (SEC-09 platform broadcast SET tracking)
 *   - Phase 7 dashboard cache (VIEW-05) — future
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §D (D-12, D-14),
 *            .planning/phases/01-fundament/01-RESEARCH.md §Abstraction (lines 1162–1204).
 */
import { Redis } from '@upstash/redis';
import { env } from './env';

export interface Cache {
  /** Returns the stored string value, or null if the key does not exist. */
  get(key: string): Promise<string | null>;
  /** Sets the value. If `ttlSeconds` is provided, the key expires after that many seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Removes the key. No-op if the key does not exist. */
  del(key: string): Promise<void>;
  /** Atomic increment. On the first hit (counter == 1) sets the TTL if provided —
   *  subsequent calls do NOT extend the TTL (window-extension bug avoidance). */
  incr(key: string, ttlSeconds?: number): Promise<number>;
  /** Adds `member` to the SET at `setKey`. Returns 1 if newly added, 0 if already present.
   *  When the member is newly added AND `ttlSeconds` is provided, sets the TTL on the SET. */
  sadd(setKey: string, member: string, ttlSeconds?: number): Promise<number>;
  /** Removes `member` from the SET at `setKey`. Returns 1 if removed, 0 if absent. */
  srem(setKey: string, member: string): Promise<number>;
  /** Returns the cardinality (number of members) of the SET at `setKey`. */
  scard(setKey: string): Promise<number>;
}

class UpstashCache implements Cache {
  private client = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  async get(key: string): Promise<string | null> {
    const v = await this.client.get<string>(key);
    return v ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, { ex: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const v = await this.client.incr(key);
    if (v === 1 && ttlSeconds) {
      await this.client.expire(key, ttlSeconds);
    }
    return v;
  }

  async sadd(setKey: string, member: string, ttlSeconds?: number): Promise<number> {
    const r = await this.client.sadd(setKey, member);
    if (r > 0 && ttlSeconds) {
      await this.client.expire(setKey, ttlSeconds);
    }
    return r;
  }

  async srem(setKey: string, member: string): Promise<number> {
    return this.client.srem(setKey, member);
  }

  async scard(setKey: string): Promise<number> {
    return this.client.scard(setKey);
  }
}

export const cache: Cache = new UpstashCache();
