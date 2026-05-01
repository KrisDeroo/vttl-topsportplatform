import { describe, it, expect } from 'vitest';
import { rateLimitChaos } from '../helpers/ratelimit-chaos'; // RED until Plan 09

describe('rate-limit chaos — SEC-07', () => {
  it(
    '110 user requests in 60s → exactly 11 are 429 with Retry-After',
    async () => {
      const results = await rateLimitChaos({ count: 110, windowMs: 60_000, kind: 'user' });
      const denied = results.filter((r) => r.status === 429);
      expect(denied.length).toBe(11);
      expect(denied[0]?.headers?.['retry-after']).toBeDefined();
    },
    90_000,
  );
});
