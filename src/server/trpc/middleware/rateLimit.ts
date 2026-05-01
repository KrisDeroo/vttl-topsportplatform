/**
 * Rate-limit + platform-broadcast-cap middleware (D-13, SEC-07/08/09).
 *
 * This module owns the tRPC rate-limit primitives. It is the second of two files
 * (alongside `src/lib/cache.ts`) that ESLint allowlists for direct `@upstash/redis`
 * imports — necessary because `@upstash/ratelimit` requires a `Redis` instance and
 * we keep that vendor surface scoped to this single file.
 *
 * Limits (D-13):
 *   - perUser:        100 req / 1m   — primary caller-id quota (SEC-07)
 *   - perIp:        1,000 req / 1m   — secondary IP quota (SEC-07; defends against
 *                                       distributed-account attacks)
 *   - fileUpload:    10 req / 1m     — per-user upload burst guard (SEC-08)
 *   - fileUploadDay: 100 req / 1d    — per-user upload daily ceiling (SEC-08)
 *   - broadcast:      1 req / 1h     — per-user broadcast frequency guard (SEC-09)
 *   - PLATFORM_BROADCAST_MAX = 5     — platform-wide concurrent active broadcasts
 *                                       (SEC-09; tracked via SET 'broadcasts:active'
 *                                        cardinality)
 *
 * Defence in depth: per-user AND per-IP counters are checked on every call. An
 * attacker rotating IPs (T-01-05) is still pinned by the per-user counter; a
 * distributed-credentials attack (multiple users from the same IP) is still
 * pinned by the per-IP counter.
 *
 * Public surface:
 *   - rateLimitMiddleware(kind, ctx)  — closure returning Promise<void>; throws
 *                                       TRPCError TOO_MANY_REQUESTS when limited.
 *                                       Used directly by the chaos test harness
 *                                       (tests/helpers/ratelimit-chaos.ts).
 *   - rateLimit(kind)                 — tRPC middleware factory; thin wrapper that
 *                                       reads `ctx.scope.userId` and `ctx.ipAddress`
 *                                       (Plan 11 ctx shape) and delegates.
 *   - markBroadcastActive(broadcastId), markBroadcastDone(broadcastId)
 *                                     — Phase 6 helpers; the broadcast endpoint
 *                                       MUST call markBroadcastActive after the
 *                                       limit check passes and markBroadcastDone
 *                                       when the fan-out completes (or fails).
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §D (D-13),
 *            .planning/phases/01-fundament/01-RESEARCH.md §Rate-limit middleware (lines 1206–1258).
 */
import { Ratelimit } from '@upstash/ratelimit';
// ESLint allowlist: this file is permitted to import @upstash/redis directly
// because @upstash/ratelimit requires a Redis instance. See .eslintrc.json overrides.
import { Redis } from '@upstash/redis';
import { TRPCError } from '@trpc/server';
import { env } from '@/lib/env';
import { cache } from '@/lib/cache';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const perUser = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'),
  prefix: 'rl:user',
  analytics: true,
});

const perIp = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1000, '1 m'),
  prefix: 'rl:ip',
});

const fileUpload = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  prefix: 'rl:upload:min',
});

const fileUploadDay = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 d'),
  prefix: 'rl:upload:day',
});

const broadcast = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, '1 h'),
  prefix: 'rl:broadcast',
});

/** Platform-wide concurrent active broadcast cap (SEC-09). */
export const PLATFORM_BROADCAST_MAX = 5;

const BROADCAST_ACTIVE_KEY = 'broadcasts:active';
/** TTL on the active-broadcast SET; safety net so a crashed broadcast eventually frees its slot. */
const BROADCAST_ACTIVE_TTL_SECONDS = 60 * 60;

export type RateLimitKind = 'user' | 'upload' | 'broadcast';

export interface RateLimitContext {
  /** Authenticated user id, or null for anonymous callers (login, signup, password-reset). */
  userId: string | null;
  /** Resolved client IP. Plan 11 reads this from `x-forwarded-for` / `x-real-ip` / socket. */
  ipAddress: string;
}

/**
 * Closure-style rate-limit primitive. Call it once to get a guard function bound
 * to a `(kind, ctx)` pair, then invoke the guard before running the protected work.
 *
 * Thrown TRPCErrors carry a JSON body in `.message` so the HTTP adapter (Plan 11
 * formatError) can extract `retryAfterMs` and emit a Retry-After response header.
 *
 * @throws TRPCError with code TOO_MANY_REQUESTS on any tripped limit.
 */
export function rateLimitMiddleware(kind: RateLimitKind, ctx: RateLimitContext) {
  return async (): Promise<void> => {
    const userKey = ctx.userId ?? `anon:${ctx.ipAddress}`;
    const ipKey = ctx.ipAddress;

    // Check per-user AND per-IP in parallel — defence in depth (T-01-05).
    const [u, i] = await Promise.all([perUser.limit(userKey), perIp.limit(ipKey)]);
    if (!u.success || !i.success) {
      const now = Date.now();
      const retryAfterMs = Math.max(u.reset - now, i.reset - now, 0);
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: JSON.stringify({ retryAfterMs, kind, scope: !u.success ? 'user' : 'ip' }),
      });
    }

    if (kind === 'upload') {
      const [m, d] = await Promise.all([
        fileUpload.limit(userKey),
        fileUploadDay.limit(userKey),
      ]);
      if (!m.success || !d.success) {
        const now = Date.now();
        const retryAfterMs = Math.max(m.reset - now, d.reset - now, 0);
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: JSON.stringify({
            retryAfterMs,
            kind: 'upload',
            scope: !m.success ? 'upload_minute' : 'upload_day',
          }),
        });
      }
    }

    if (kind === 'broadcast') {
      const b = await broadcast.limit(userKey);
      if (!b.success) {
        const retryAfterMs = Math.max(b.reset - Date.now(), 0);
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: JSON.stringify({ retryAfterMs, kind: 'broadcast', scope: 'user' }),
        });
      }

      // Platform-wide concurrent cap (SEC-09). The caller is responsible for
      // markBroadcastActive(broadcastId) AFTER this check passes and the broadcast
      // actually starts; markBroadcastDone(broadcastId) when fan-out completes.
      const active = await cache.scard(BROADCAST_ACTIVE_KEY);
      if (active >= PLATFORM_BROADCAST_MAX) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: JSON.stringify({
            retryAfterMs: BROADCAST_ACTIVE_TTL_SECONDS * 1000,
            kind: 'broadcast',
            scope: 'platform',
          }),
        });
      }
    }
  };
}

/**
 * tRPC middleware factory (Plan 11 wires this into the procedure builders).
 *
 * Expected ctx shape (defined in Plan 11):
 *   ctx.scope.userId : string | null
 *   ctx.ipAddress    : string
 *
 * Usage:
 *   protectedProcedure.use(rateLimit('user'))
 *   protectedProcedure.use(rateLimit('upload'))
 *   protectedProcedure.use(rateLimit('broadcast'))
 *
 * The middleware is exported as a plain async function rather than via tRPC's
 * `middleware()` factory because the tRPC factory is constructed in Plan 11
 * (`src/server/trpc/trpc.ts`). Plan 11 will wrap this with `t.middleware(...)`
 * at the call site.
 */
export const rateLimit = (kind: RateLimitKind) => {
  return async (opts: {
    ctx: { scope?: { userId?: string | null }; ipAddress?: string };
    next: () => Promise<unknown>;
  }) => {
    const userId = opts.ctx.scope?.userId ?? null;
    const ipAddress = opts.ctx.ipAddress ?? '0.0.0.0';
    const guard = rateLimitMiddleware(kind, { userId, ipAddress });
    await guard();
    return opts.next();
  };
};

/** Mark a broadcast as active. Phase 6 call site uses this when starting a fan-out. */
export async function markBroadcastActive(broadcastId: string): Promise<void> {
  await cache.sadd(BROADCAST_ACTIVE_KEY, broadcastId, BROADCAST_ACTIVE_TTL_SECONDS);
}

/** Mark a broadcast as finished. Phase 6 call site uses this in finally{} or on completion event. */
export async function markBroadcastDone(broadcastId: string): Promise<void> {
  await cache.srem(BROADCAST_ACTIVE_KEY, broadcastId);
}
