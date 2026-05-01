---
phase: 01-fundament
plan: 09
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/lib/cache.ts
  - src/server/trpc/middleware/rateLimit.ts
  - src/server/auth/revocation.ts
  - tests/helpers/ratelimit-chaos.ts
  - tests/integration/ratelimit.test.ts
autonomous: true
requirements:
  - SEC-07
  - SEC-08
  - SEC-09
threat_refs:
  - T-01-05
  - T-01-07
tags:
  - phase-1
  - infra
  - upstash
  - rate-limit
  - cache

must_haves:
  truths:
    - "lib/cache.ts exposes a Cache interface (get, set, del, incr, sadd, scard) — D-14 abstraction"
    - "Concrete UpstashCache class is the only direct user of @upstash/redis"
    - "rateLimit middleware uses @upstash/ratelimit slidingWindow with prefixes rl:user (100/m), rl:ip (1000/m), rl:upload:min (10/m), rl:upload:day (100/d), rl:broadcast (1/h)"
    - "Platform-wide broadcast cap of 5 enforced via SET 'broadcasts:active' SCARD check (SEC-09)"
    - "JWT revocation list: setRevoked(userId, reason) writes key revoked:{userId} with TTL = 30d; isRevoked(userId) returns the reason string or null (D-09)"
    - "tests/integration/ratelimit.test.ts asserts exactly 11 of 110 user-keyed requests are 429 with Retry-After"
  artifacts:
    - path: "src/lib/cache.ts"
      provides: "Cache interface + UpstashCache implementation; barrier for D-14"
      exports: ["cache", "Cache"]
    - path: "src/server/trpc/middleware/rateLimit.ts"
      provides: "rateLimit('user' | 'upload' | 'broadcast') tRPC middleware"
      exports: ["rateLimit"]
    - path: "src/server/auth/revocation.ts"
      provides: "setRevoked(userId, reason, ttlSeconds), isRevoked(userId) — D-09 JWT revocation"
      exports: ["setRevoked", "isRevoked"]
    - path: "tests/helpers/ratelimit-chaos.ts"
      provides: "rateLimitChaos({ count, windowMs, kind }) used by integration test"
      exports: ["rateLimitChaos"]
  key_links:
    - from: "src/server/trpc/middleware/rateLimit.ts"
      to: "src/lib/env.ts"
      via: "Imports UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN"
      pattern: "env.UPSTASH"
    - from: "src/server/auth/revocation.ts"
      to: "src/lib/cache.ts"
      via: "Uses cache.set(key, reason, ttl)"
      pattern: "cache.set"
---

<objective>
Implement the shared Redis primitive (D-12) behind the abstraction (D-14): rate-limit middleware (SEC-07/08/09), JWT revocation list (D-09), and the abstraction barrier `lib/cache.ts` that lets us swap Upstash for self-hosted Redis with a 1-file change.

Out of scope: BullMQ (Plan 10 handles BullMQ queue + worker — uses ioredis NOT Upstash REST per the gotcha note).

Output: `lib/cache.ts` + `revocation.ts` + `rateLimit` middleware + chaos test passing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: lib/cache.ts abstraction + revocation helpers</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Abstraction (lines 1162–1204) — full UpstashCache class
    - .planning/phases/01-fundament/01-CONTEXT.md §D (D-09, D-12, D-14)
    - .eslintrc.json (Plan 01 + 18) — rule blocking direct @upstash/redis outside lib/cache.ts
  </read_first>
  <files>
    src/lib/cache.ts
    src/server/auth/revocation.ts
    tests/unit/cache.test.ts
  </files>
  <behavior>
    - Test 1 (unit): cache.set('k', 'v', 60) calls Redis with TTL 60
    - Test 2 (unit): cache.incr first call sets TTL, subsequent calls do not
    - Test 3 (unit): setRevoked(userId, reason, ttl) writes `revoked:${userId}` key with the reason as value
    - Test 4 (unit): isRevoked(userId) returns the reason string or null
  </behavior>
  <action>
    Create `src/lib/cache.ts` exactly per RESEARCH lines 1164–1192, plus `sadd`/`scard` for the broadcast platform cap:
    ```ts
    import { Redis } from '@upstash/redis';
    import { env } from './env';

    export interface Cache {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, ttlSeconds?: number): Promise<void>;
      del(key: string): Promise<void>;
      incr(key: string, ttlSeconds?: number): Promise<number>;
      sadd(setKey: string, member: string, ttlSeconds?: number): Promise<number>;
      srem(setKey: string, member: string): Promise<number>;
      scard(setKey: string): Promise<number>;
    }

    class UpstashCache implements Cache {
      private client = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

      async get(key: string) { const v = await this.client.get<string>(key); return v ?? null; }
      async set(key: string, value: string, ttlSeconds?: number) {
        if (ttlSeconds) await this.client.set(key, value, { ex: ttlSeconds });
        else await this.client.set(key, value);
      }
      async del(key: string) { await this.client.del(key); }
      async incr(key: string, ttlSeconds?: number) {
        const v = await this.client.incr(key);
        if (v === 1 && ttlSeconds) await this.client.expire(key, ttlSeconds);
        return v;
      }
      async sadd(setKey: string, member: string, ttlSeconds?: number) {
        const r = await this.client.sadd(setKey, member);
        if (r > 0 && ttlSeconds) await this.client.expire(setKey, ttlSeconds);
        return r;
      }
      async srem(setKey: string, member: string) { return this.client.srem(setKey, member); }
      async scard(setKey: string) { return this.client.scard(setKey); }
    }

    export const cache: Cache = new UpstashCache();
    ```

    Create `src/server/auth/revocation.ts`:
    ```ts
    /**
     * JWT revocation (D-09). Used when a TD downgrades a role / breaks a parent-child link / deactivates an account.
     * Sub-millisecond Upstash GET on every authenticated tRPC request via Plan 11 middleware.
     *
     * Key format: revoked:{userId}; value: human-readable reason; TTL = JWT-lifetime so entries auto-expire.
     */
    import { cache } from '@/lib/cache';

    const DEFAULT_REVOCATION_TTL = 60 * 60 * 24 * 30;  // 30d — same as session.expiresIn (Plan 05)

    export async function setRevoked(userId: string, reason: string, ttlSeconds: number = DEFAULT_REVOCATION_TTL) {
      await cache.set(`revoked:${userId}`, reason, ttlSeconds);
    }

    export async function isRevoked(userId: string): Promise<string | null> {
      return cache.get(`revoked:${userId}`);
    }

    export async function clearRevocation(userId: string) {
      await cache.del(`revoked:${userId}`);
    }
    ```

    Write `tests/unit/cache.test.ts`:
    ```ts
    import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        get: upstashGet, set: upstashSet, del: upstashDel,
        incr: upstashIncr, expire: upstashExpire,
        sadd: upstashSadd, srem: upstashSrem, scard: upstashScard,
      })),
    }));

    beforeEach(() => {
      upstashGet.mockReset(); upstashSet.mockReset(); upstashDel.mockReset();
      upstashIncr.mockReset(); upstashExpire.mockReset();
      upstashSadd.mockReset(); upstashSrem.mockReset(); upstashScard.mockReset();
    });

    describe('lib/cache abstraction (D-14)', () => {
      it('set with ttl calls Upstash set with { ex: ttl }', async () => {
        const { cache } = await import('@/lib/cache');
        await cache.set('k', 'v', 60);
        expect(upstashSet).toHaveBeenCalledWith('k', 'v', { ex: 60 });
      });

      it('incr first call sets TTL', async () => {
        const { cache } = await import('@/lib/cache');
        upstashIncr.mockResolvedValue(1);
        await cache.incr('counter', 60);
        expect(upstashExpire).toHaveBeenCalledWith('counter', 60);
      });

      it('incr later calls do NOT set TTL again', async () => {
        const { cache } = await import('@/lib/cache');
        upstashIncr.mockResolvedValue(2);
        upstashExpire.mockClear();
        await cache.incr('counter', 60);
        expect(upstashExpire).not.toHaveBeenCalled();
      });
    });

    describe('revocation (D-09)', () => {
      it('setRevoked writes revoked:{userId} with reason', async () => {
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
    });
    ```
  </action>
  <verify>
    <automated>test -f src/lib/cache.ts && test -f src/server/auth/revocation.ts && grep -q "interface Cache" src/lib/cache.ts && grep -q "UpstashCache" src/lib/cache.ts && grep -q "scard" src/lib/cache.ts && grep -q "sadd" src/lib/cache.ts && grep -q "setRevoked" src/server/auth/revocation.ts && grep -q "isRevoked" src/server/auth/revocation.ts && grep -q "revoked:\${userId}\|revoked:.*userId" src/server/auth/revocation.ts && npx vitest run tests/unit/cache.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/cache.ts` exports `cache: Cache` instance and `Cache` interface
    - `Cache` interface includes `get`, `set`, `del`, `incr`, `sadd`, `srem`, `scard`
    - `src/server/auth/revocation.ts` exports `setRevoked`, `isRevoked`, `clearRevocation`
    - 6 tests in `tests/unit/cache.test.ts` pass
  </acceptance_criteria>
  <done>Cache abstraction + revocation helpers GREEN.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: rateLimit tRPC middleware (SEC-07/08/09) + chaos integration test</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Rate-limit middleware (lines 1206–1258) — full pattern with prefixes
    - .planning/phases/01-fundament/01-CONTEXT.md §D (D-13: 100/m user, 1000/m IP, 10/m + 100/d uploads, 1/h broadcast, max 5 platform-wide)
    - tests/integration/ratelimit.test.ts (Plan 17 — RED skeleton)
  </read_first>
  <files>
    src/server/trpc/middleware/rateLimit.ts
    tests/helpers/ratelimit-chaos.ts
    tests/integration/ratelimit.test.ts
  </files>
  <behavior>
    - Test 1 (integration): 110 user-keyed requests in 60s → exactly 11 are 429 (or close: sliding window means 100 succeed, 10 over fail)
    - Test 2 (integration): broadcast endpoint denies the 6th platform-wide active broadcast (SEC-09 max=5)
  </behavior>
  <action>
    Create `src/server/trpc/middleware/rateLimit.ts` per RESEARCH §Rate-limit middleware:
    ```ts
    import { Ratelimit } from '@upstash/ratelimit';
    import { Redis } from '@upstash/redis';
    import { TRPCError } from '@trpc/server';
    import { env } from '@/lib/env';
    import { cache } from '@/lib/cache';

    // ESLint exempt: this file is allowlisted to import @upstash/redis directly.
    const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

    const perUser = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 m'), prefix: 'rl:user', analytics: true });
    const perIp = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1000, '1 m'), prefix: 'rl:ip' });
    const fileUpload = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 m'), prefix: 'rl:upload:min' });
    const fileUploadDay = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 d'), prefix: 'rl:upload:day' });
    const broadcast = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1, '1 h'), prefix: 'rl:broadcast' });

    const PLATFORM_BROADCAST_MAX = 5;     // SEC-09
    const BROADCAST_ACTIVE_KEY = 'broadcasts:active';
    const BROADCAST_ACTIVE_TTL = 60 * 60;  // 1h

    type RateLimitKind = 'user' | 'upload' | 'broadcast';

    export function rateLimitMiddleware(kind: RateLimitKind, ctx: {
      userId: string | null;
      ipAddress: string;
    }) {
      return async () => {
        const userKey = ctx.userId ?? `anon:${ctx.ipAddress}`;
        const ipKey = ctx.ipAddress;

        const [u, i] = await Promise.all([perUser.limit(userKey), perIp.limit(ipKey)]);
        if (!u.success || !i.success) {
          const retryAfter = Math.max(u.reset - Date.now(), i.reset - Date.now());
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: JSON.stringify({ retryAfterMs: retryAfter, kind }),
          });
        }

        if (kind === 'upload') {
          const [m, d] = await Promise.all([fileUpload.limit(userKey), fileUploadDay.limit(userKey)]);
          if (!m.success || !d.success) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'upload_limit' });
        }

        if (kind === 'broadcast') {
          const b = await broadcast.limit(userKey);
          if (!b.success) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'broadcast_user_limit' });

          const active = await cache.scard(BROADCAST_ACTIVE_KEY);
          if (active >= PLATFORM_BROADCAST_MAX) {
            throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'platform_broadcast_limit' });
          }
          // Caller is responsible for sadd(BROADCAST_ACTIVE_KEY, broadcastId, BROADCAST_ACTIVE_TTL)
          // and srem(...) when done. Helper exposed below.
        }
      };
    }

    /** Mark a broadcast as active. Phase 6 call site uses this when starting a fan-out. */
    export async function markBroadcastActive(broadcastId: string) {
      await cache.sadd(BROADCAST_ACTIVE_KEY, broadcastId, BROADCAST_ACTIVE_TTL);
    }
    export async function markBroadcastDone(broadcastId: string) {
      await cache.srem(BROADCAST_ACTIVE_KEY, broadcastId);
    }
    ```

    Note: the TRPCError code `TOO_MANY_REQUESTS` maps to HTTP 429 per tRPC convention. The Retry-After header is set by the tRPC HTTP adapter when the error includes timing data — Plan 11 wires the response header from the message JSON. For the chaos test, we capture the raw 429 + the Retry-After-equivalent meta.

    Update `tests/helpers/ratelimit-chaos.ts` (Plan 17 stub):
    ```ts
    import { rateLimitMiddleware } from '@/server/trpc/middleware/rateLimit';

    /** Simulates `count` requests as a single user against the rate-limit middleware.
     *  Returns the per-request status (200=passed, 429=denied) for the chaos test. */
    export async function rateLimitChaos(opts: { count: number; windowMs: number; kind: 'user' | 'upload' | 'broadcast' }) {
      const userId = `chaos-${Date.now()}`;
      const ipAddress = '203.0.113.7';
      const results: { status: 200 | 429; headers?: Record<string, string> }[] = [];

      const rl = rateLimitMiddleware(opts.kind, { userId, ipAddress });

      for (let i = 0; i < opts.count; i++) {
        try {
          await rl();
          results.push({ status: 200 });
        } catch (e: any) {
          let retryAfter: string | undefined;
          try {
            const data = JSON.parse(e.message ?? '{}');
            if (typeof data.retryAfterMs === 'number') retryAfter = String(Math.ceil(data.retryAfterMs / 1000));
          } catch {}
          results.push({ status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : undefined });
        }
      }
      return results;
    }
    ```

    `tests/integration/ratelimit.test.ts` already exists from Plan 17. It imports `rateLimitChaos` and runs the chaos. Confirm:
    - Re-read `tests/integration/ratelimit.test.ts` and verify it asserts `denied.length === 11` (110 - 100 = 10; with sliding-window jitter, allow 9–11 — but RESEARCH spec says 11). Use:
      ```ts
      expect(denied.length).toBeGreaterThanOrEqual(9);
      expect(denied.length).toBeLessThanOrEqual(11);
      ```
    - The first denied entry should have `headers['retry-after']` defined.
  </action>
  <verify>
    <automated>test -f src/server/trpc/middleware/rateLimit.ts && test -f tests/helpers/ratelimit-chaos.ts && grep -q "Ratelimit.slidingWindow(100, '1 m')" src/server/trpc/middleware/rateLimit.ts && grep -q "Ratelimit.slidingWindow(1000, '1 m')" src/server/trpc/middleware/rateLimit.ts && grep -q "Ratelimit.slidingWindow(10, '1 m')" src/server/trpc/middleware/rateLimit.ts && grep -q "Ratelimit.slidingWindow(100, '1 d')" src/server/trpc/middleware/rateLimit.ts && grep -q "Ratelimit.slidingWindow(1, '1 h')" src/server/trpc/middleware/rateLimit.ts && grep -q "PLATFORM_BROADCAST_MAX = 5" src/server/trpc/middleware/rateLimit.ts && grep -q "broadcasts:active" src/server/trpc/middleware/rateLimit.ts && grep -q "TOO_MANY_REQUESTS" src/server/trpc/middleware/rateLimit.ts && grep -q "markBroadcastActive" src/server/trpc/middleware/rateLimit.ts && grep -q "rateLimitChaos" tests/helpers/ratelimit-chaos.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/trpc/middleware/rateLimit.ts` defines 5 Ratelimit instances with the exact limits specified in D-13
    - `PLATFORM_BROADCAST_MAX === 5` (SEC-09)
    - Helper `markBroadcastActive` / `markBroadcastDone` exported for Phase 6
    - `tests/helpers/ratelimit-chaos.ts` exports `rateLimitChaos` returning a status array
    - `tests/integration/ratelimit.test.ts` (Plan 17) is updated to use the real helper (or stays RED until first run against Upstash)
  </acceptance_criteria>
  <done>Rate-limit primitive ready; chaos harness wires Plan 17 test.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App ↔ Upstash REST | Token-authenticated; only via `lib/cache.ts` interface (D-14) |
| Per-user counter ↔ per-IP counter | Sliding window enforced server-side; bypass via IP rotation requires also bypassing per-user limit |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-05 | Denial of Service | Rate-limit bypass via IP rotation or distributed login | mitigate | Both per-user AND per-IP counters checked; per-user (`rl:user`) catches IP rotation; per-IP catches distributed-account attacks |
| T-01-07 | Elevation of Privilege | Stale JWT after scope downgrade | mitigate | `revoked:{userId}` Upstash key with TTL = JWT lifetime; Plan 11 middleware checks every authenticated request (sub-ms) |
</threat_model>

<verification>
- `npx vitest run tests/unit/cache.test.ts` GREEN
- `tests/integration/ratelimit.test.ts` is wired (RED until first Upstash deploy; succeeds in CI when staging Upstash credentials provided)
- `npx tsc --noEmit` exits 0
- ESLint allowlist permits `@upstash/redis` import in `src/server/trpc/middleware/rateLimit.ts` (Plan 01 override)
</verification>

<success_criteria>
- D-14 abstraction barrier in `lib/cache.ts`
- All 5 rate-limit slidingWindow rules + platform broadcast cap of 5
- D-09 revocation helpers
- Chaos test harness wired for Plan 17 integration
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-09-SUMMARY.md` documenting:
- Confirmation that no Upstash-specific API (HASH/PUBSUB/streams) used (D-14 hygiene)
- **MINOR-17 — CI prerequisite:** the chaos test (`tests/integration/ratelimit.test.ts`) only runs against a live Upstash instance. CI MUST provision `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` as encrypted secrets pointing at a dedicated CI tenant (separate from staging/prod). Without these the test must `it.skip` or `describe.skipIf(!process.env.UPSTASH_REDIS_REST_URL)`. Document the secret configuration in this SUMMARY plus the `.github/workflows/ci.yml` env block.
- Plan 11 must use `isRevoked()` in its `requireAuth` middleware
- Plan 15 (TD admin UI) must call `setRevoked()` on `deactivate` and `assignRole` mutations
</output>
