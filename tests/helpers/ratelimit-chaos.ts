/**
 * Chaos harness for the rate-limit middleware (Plan 09 deliverable).
 *
 * Drives `rateLimitMiddleware` with N requests as a single synthetic user and
 * returns the per-request status array (200 = passed, 429 = denied) along with
 * any Retry-After hint extracted from the TRPCError JSON payload.
 *
 * Used by `tests/integration/ratelimit.test.ts` (Plan 17 spec, tightened in Plan 09)
 * to assert that 110 user-keyed requests in 60s produce 9–11 denials with Retry-After.
 *
 * Usage:
 *   const results = await rateLimitChaos({ count: 110, windowMs: 60_000, kind: 'user' });
 *   const denied = results.filter(r => r.status === 429);
 *
 * Notes:
 *   - The userId is randomized per call (`chaos-${Date.now()}-${rand}`) so each
 *     test run starts with a fresh sliding window in Upstash; no test cleanup needed.
 *   - `windowMs` is currently informational only — the middleware's window is fixed
 *     at the rates configured in D-13. Future tests may use it to space requests
 *     across the window boundary (slidingWindow weighted-sum jitter exploration).
 */
import { rateLimitMiddleware, type RateLimitKind } from '@/server/trpc/middleware/rateLimit';

export interface RateLimitChaosArgs {
  count: number;
  windowMs: number;
  kind: RateLimitKind;
}

export interface RateLimitChaosResult {
  status: 200 | 429;
  headers?: Record<string, string>;
}

const SYNTHETIC_IP = '203.0.113.7'; // TEST-NET-3 — RFC 5737 reserved, never collides with real IPs.

export const rateLimitChaos = async (
  args: RateLimitChaosArgs,
): Promise<RateLimitChaosResult[]> => {
  // Fresh user id per harness run so the sliding window starts empty.
  const userId = `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const guard = rateLimitMiddleware(args.kind, { userId, ipAddress: SYNTHETIC_IP });

  const results: RateLimitChaosResult[] = [];
  for (let i = 0; i < args.count; i++) {
    try {
      await guard();
      results.push({ status: 200 });
    } catch (e) {
      // The middleware throws TRPCError({ code: 'TOO_MANY_REQUESTS', message: JSON }).
      // Extract retryAfterMs from the JSON body and convert to a Retry-After header
      // (HTTP semantics: integer seconds).
      const message = (e as Error)?.message ?? '{}';
      let retryAfterSeconds: string | undefined;
      try {
        const data = JSON.parse(message) as { retryAfterMs?: number };
        if (typeof data.retryAfterMs === 'number') {
          retryAfterSeconds = String(Math.max(1, Math.ceil(data.retryAfterMs / 1000)));
        }
      } catch {
        // Non-JSON message — leave retryAfterSeconds undefined; caller asserts on it.
      }
      results.push(
        retryAfterSeconds !== undefined
          ? { status: 429, headers: { 'retry-after': retryAfterSeconds } }
          : { status: 429 },
      );
    }
  }
  return results;
};
