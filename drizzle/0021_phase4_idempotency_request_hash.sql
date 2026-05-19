-- 0021_phase4_idempotency_request_hash.sql
-- Phase 4 CR-02 fix (VERIFICATION.md gaps[1]).
--
-- Adds a `request_hash` text column to idempotency_keys so the middleware
-- can bind cache lookups to canonicalised request input (sorted-keys JSON +
-- sha256). Pre-fix behaviour: cache key is (key, userId, endpoint) only;
-- same idempotencyKey + DIFFERENT input replays the cached response of the
-- first call (correctness break + soft replay surface per T-04-25).
--
-- Migration is additive only:
--   * No NOT NULL constraint on initial add — existing rows have no hash.
--     The 24h TTL means existing rows expire naturally; the middleware
--     treats null request_hash as "legacy — accept any input" for backward
--     compatibility during the 24h grace window.
--   * `response_hash` column is preserved (v2-reserved for response-tamper
--     detection per 04-REVIEW.md §WR-08).
--   * No backfill — historical input is unrecoverable from response_body
--     alone; rows expire within 24h anyway.
--
-- Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[1]
--            .planning/phases/04-kerndomein/04-REVIEW.md §CR-02 §WR-08

ALTER TABLE "idempotency_keys"
  ADD COLUMN "request_hash" text;--> statement-breakpoint

COMMENT ON COLUMN "idempotency_keys"."request_hash"
  IS 'Phase 4 CR-02: sha256 of canonicalised (sorted-keys JSON) raw input. NULL on legacy rows pre-fix; new rows populated by idempotency middleware. Mismatch on cache HIT raises CONFLICT.';
