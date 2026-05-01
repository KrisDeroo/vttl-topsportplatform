/**
 * Idempotency keys — VALID-08 (RESEARCH §Idempotency keys, lines 740-757).
 *
 * Inlined from "Migration 003" into Migration 0000 for atomicity:
 * splitting these tables into separate migrations buys nothing because
 * Plan 14 (rate-limit / idempotency middleware) is the first place
 * they're touched, and that lands in the same Phase 1 release as
 * Migration 0000.
 *
 * Lifecycle:
 *  - Client supplies `key` (uuid string) on POST/PUT/DELETE mutations.
 *  - First request: tRPC middleware records (key, userId, endpoint),
 *    runs the handler, stores `responseHash` + `responseBody`, returns
 *    response.
 *  - Replay (same key + same user + same endpoint): middleware short-
 *    circuits, returns the cached response WITHOUT re-running the
 *    handler. Side-effect-free even if user mashes the button.
 *  - `expiresAt` = createdAt + 24h. Expired rows are reclaimed by a
 *    nightly pg_cron job (Plan 13).
 *
 * `key` is text (not uuid) because clients may supply nanoid or any
 * unique opaque string; we hash-compare, not type-compare.
 *
 * `responseBody` (jsonb) is bounded to 8KB by tRPC middleware (Plan 14)
 * — large mutations (file uploads) skip idempotency caching and rely
 * on storage-layer dedup instead.
 */
import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(), // client-supplied unique string (uuid / nanoid)
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  endpoint: text('endpoint').notNull(), // tRPC procedure name
  responseHash: text('response_hash'), // sha256 of stored body for replay verification
  responseBody: jsonb('response_body'),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  expiresAt: tstz('expires_at').notNull(), // createdAt + 24h, reclaimed by pg_cron
});
