/**
 * Rate-limit chaos integration test (SEC-07).
 *
 * Drives the real `rateLimitMiddleware` (Plan 09) with 110 user-keyed requests
 * inside a 60s sliding window and asserts that the per-user limit (100/min, D-13)
 * denies the overflow with a 429 + Retry-After.
 *
 * RUN MODE: this test talks to a live Upstash Redis instance (REST API). It is
 * skipped automatically when `UPSTASH_REDIS_REST_URL` is not present so the CI
 * pipeline can run the rest of the suite without provisioning Upstash. CI must
 * provide a dedicated CI tenant (separate from staging/prod) via encrypted
 * GitHub Action secrets — see SUMMARY 01-09 §MINOR-17.
 *
 * Sliding-window jitter: the @upstash/ratelimit slidingWindow algorithm computes
 * a weighted sum across two adjacent fixed windows and may permit slightly more
 * or fewer than the configured ceiling depending on where the request burst
 * lands relative to the window boundary. The plan (per RESEARCH spec) targets
 * 11 denials out of 110 requests; we allow 9–11 to absorb that jitter without
 * making the test flaky.
 */
import { describe, it, expect } from 'vitest';
import { rateLimitChaos } from '../helpers/ratelimit-chaos';

const hasUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

describe.skipIf(!hasUpstash)('rate-limit chaos — SEC-07', () => {
  it(
    '110 user requests in 60s → 9–11 are 429 with Retry-After',
    async () => {
      const results = await rateLimitChaos({ count: 110, windowMs: 60_000, kind: 'user' });
      const denied = results.filter((r) => r.status === 429);
      expect(denied.length).toBeGreaterThanOrEqual(9);
      expect(denied.length).toBeLessThanOrEqual(11);
      expect(denied[0]?.headers?.['retry-after']).toBeDefined();
    },
    90_000,
  );
});
