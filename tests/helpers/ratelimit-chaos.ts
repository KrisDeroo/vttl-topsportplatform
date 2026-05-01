/**
 * RED stub — rateLimitChaos is provided by Plan 09 (Upstash cache + rate limiting).
 *
 * Until Plan 09 lands, calling rateLimitChaos(...) at runtime throws and the dependent
 * tests (tests/integration/ratelimit.test.ts) are RED. This stub exists only so Vitest
 * can collect and parse the test files without "cannot find module" errors.
 *
 * Once Plan 09 is implemented, replace this file with a real implementation that drives
 * the rate-limit middleware with N requests within a window and returns the full result
 * set with status codes and headers (Retry-After).
 */
export interface RateLimitChaosArgs {
  count: number;
  windowMs: number;
  kind: 'user' | 'ip' | 'auth';
}

export interface RateLimitChaosResult {
  status: number;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const rateLimitChaos = async (
  _args: RateLimitChaosArgs,
): Promise<RateLimitChaosResult[]> => {
  throw new Error('rateLimitChaos not implemented yet — Plan 09 (Upstash + ratelimit)');
};
