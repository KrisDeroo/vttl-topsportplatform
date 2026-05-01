/**
 * BullMQ Redis connection (D-15).
 *
 * BullMQ requires a persistent TCP/TLS Redis connection because it relies on
 * Lua scripts and blocking commands (BRPOPLPUSH). The `@upstash/redis` REST
 * client (used by Plan 09 for ratelimit + JWT revocation against
 * `UPSTASH_REDIS_REST_URL`) cannot run BullMQ — see RESEARCH.md §Critical
 * Upstash + BullMQ pitfall (lines 491–492).
 *
 * Therefore we maintain TWO Redis primitives in this codebase:
 *  - `@upstash/redis` REST against UPSTASH_REDIS_REST_URL → ratelimit, revocation
 *  - ioredis TCP/TLS against REDIS_URL (rediss://...)     → BullMQ Queue + Worker
 *
 * Both env vars are validated by src/lib/env.ts.
 *
 * Connection options:
 *  - maxRetriesPerRequest=null  → BullMQ handles command retries internally;
 *                                 ioredis must not preempt or jobs leak.
 *  - enableReadyCheck=false     → avoids BullMQ blocking on ready-check during
 *                                 graceful shutdown (verified BullMQ docs).
 */
import IORedis from 'ioredis';
import { env } from '@/lib/env';

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
