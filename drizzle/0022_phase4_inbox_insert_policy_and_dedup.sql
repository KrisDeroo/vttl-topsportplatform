-- 0022_phase4_inbox_insert_policy_and_dedup.sql
-- Phase 4 CR-06 + CR-07 fix (VERIFICATION.md gaps[5] + gaps[6]).
--
-- CR-06: system_inbox has FORCE RLS but NO INSERT policy. On Supabase
-- (where the migration role is non-superuser owner), FORCE RLS applies to
-- the owner too — SECURITY DEFINER cron INSERTs from 0019 silently fail.
-- D-67 ch2 + D-72 ch2 degrade to no-ops.
--
-- CR-07: No anti-duplicate constraint. Daily cron stacks rows; 14-day
-- window produces 14 inbox rows per trainer with one unscored session.
--
-- This migration:
--   1. Adds INSERT policy WITH CHECK (true) — combined with REVOKE app_user
--      below, only roles with explicit INSERT grants (the SECURITY DEFINER
--      function owner) can deposit.
--   2. Adds partial UNIQUE INDEX on (user_id, kind, Brussels-day(created_at))
--      for daily cron ON CONFLICT DO NOTHING idempotency.
--
-- Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[5,6]
--            .planning/phases/04-kerndomein/04-REVIEW.md §CR-06 §CR-07

CREATE POLICY "system_inbox_insert_security_definer" ON "system_inbox"
  FOR INSERT WITH CHECK (true);--> statement-breakpoint

COMMENT ON POLICY "system_inbox_insert_security_definer" ON "system_inbox"
  IS 'Phase 4 CR-06: explicit INSERT policy required under FORCE RLS. WITH CHECK (true); actual gating via REVOKE INSERT FROM app_user.';--> statement-breakpoint

REVOKE INSERT, DELETE ON "system_inbox" FROM "app_user";--> statement-breakpoint

CREATE UNIQUE INDEX "uq_system_inbox_daily" ON "system_inbox" (
  "user_id",
  "kind",
  ((("created_at" AT TIME ZONE 'Europe/Brussels'))::date)
);--> statement-breakpoint

COMMENT ON INDEX "uq_system_inbox_daily"
  IS 'Phase 4 CR-07: at most one inbox row per (user_id, kind, Brussels-day). Daily cron uses ON CONFLICT DO NOTHING.';
