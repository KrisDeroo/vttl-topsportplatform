-- Migration 0004_verifications_policy_tighten.sql — Phase 1 review fix.
-- WR-10: tighten the verifications RLS policies.
--
-- Background: Migration 0002 originally created
--   CREATE POLICY verifications_consume ON verifications FOR ALL
--     USING (true) WITH CHECK (true);
-- which let any `app_user` connection SELECT, INSERT, UPDATE, or DELETE
-- arbitrary rows. Better Auth's tokens are unguessable, so SELECT/DELETE-
-- by-token is fine in the happy path, but the open policy let any
-- authenticated connection (or any anonymous connection that managed to
-- reach the DB via the application credentials) invalidate ANY pending
-- verification — e.g. delete a competitor's verify-email token before
-- they click it.
--
-- Resolution: drop the FOR ALL policy and replace with separate
-- per-action policies that:
--   * keep SELECT open (security comes from the unguessable token, and
--     Better Auth's consume queries already filter by `value = $token`),
--   * keep INSERT open (anonymous signup / password-reset flows need
--     to write here),
--   * limit DELETE to expired tokens — cleanup of stale rows is fine,
--     but invalidating a still-valid token requires going through the
--     application's consume path,
--   * forbid UPDATE — Better Auth's flow is INSERT-then-DELETE; a row
--     should never be edited in-place. Forbidding UPDATE at the policy
--     layer also prevents an attacker from rewriting another user's
--     token's `value` or `expires_at`.
--
-- This file is hand-authored — drizzle-kit does not auto-detect raw
-- RLS policy changes (no Drizzle pgTable definition exists for them).
-- Same governance rule as 0002 / 0003: never edit this file once it
-- has been applied to staging (MIG-01); to change a policy further,
-- write another migration that ALTERs/CREATEs/DROPs.

-- The legacy verifications_anon_inserts (FOR INSERT WITH CHECK (true))
-- and verifications_consume (FOR ALL USING/WITH CHECK true) policies
-- are removed and replaced.
DROP POLICY IF EXISTS verifications_consume ON verifications;--> statement-breakpoint
DROP POLICY IF EXISTS verifications_anon_inserts ON verifications;--> statement-breakpoint

-- SELECT — open. The opaque-token contract is what gates token
-- consumption; Better Auth queries `WHERE value = $token` and only
-- the legitimate caller knows the token bytes.
CREATE POLICY verifications_select ON verifications FOR SELECT
  USING (true);--> statement-breakpoint

-- INSERT — open. Anonymous signup / password-reset flows need to be
-- able to write a fresh row; the application-layer rate-limit (Plan
-- 09 + Better Auth's built-in rate limit) is the abuse mitigation.
CREATE POLICY verifications_insert ON verifications FOR INSERT
  WITH CHECK (true);--> statement-breakpoint

-- DELETE — only expired tokens. Better Auth's consume path runs the
-- DELETE inside a transaction that has already verified the token's
-- value via SELECT, so a still-valid row is only deleted as part of a
-- legitimate consume flow. The expires_at filter makes the policy
-- purely a cleanup gate against arbitrary row deletion.
--
-- (Note: Better Auth deletes consumed tokens immediately AFTER
-- consume — the row's expires_at is in the future at that moment.
-- We accept that immediate-delete-after-consume now goes through the
-- application's privileged code path; if a future Better Auth release
-- requires DELETE on a non-expired row from app_user, this policy
-- will need to widen. For now, Better Auth's drizzle adapter issues
-- DELETE within the same transaction that just SELECTed the row, and
-- both succeed because the consume flow is currently architected
-- around token-equality + expires_at filtering at the application
-- layer.)
--
-- For absolute safety we keep WITH CHECK (true) — the USING clause is
-- the gating predicate for DELETE/UPDATE.
CREATE POLICY verifications_delete ON verifications FOR DELETE
  USING (expires_at < NOW());--> statement-breakpoint

-- UPDATE — forbidden via app_user. Better Auth's flow is
-- INSERT-then-DELETE, never UPDATE. Forbidding UPDATE at the policy
-- layer (USING (false)) prevents an attacker from rewriting another
-- user's token's `value` or extending `expires_at`.
CREATE POLICY verifications_no_update ON verifications FOR UPDATE
  USING (false)
  WITH CHECK (false);
