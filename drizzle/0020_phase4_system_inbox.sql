-- 0020_phase4_system_inbox.sql
-- Phase 4 minimal stub for D-67 channel 2 / D-72 channel 2 nudge messages.
-- Replaced/extended by Phase 6 Inbox UI. The pg_cron jobs from 0019 INSERT
-- here; Phase 6 takes over with thread/compose/attachment UX.
--
-- Scope:
--   * One table: system_inbox(id, user_id, kind, payload jsonb, read_at, created_at).
--   * RLS: ENABLE + FORCE; SELECT-own + UPDATE-own policies (read your own nudges
--     + mark them read). No INSERT policy — only the SECURITY DEFINER cron functions
--     from 0019 (or future system-level processes) can deposit. No DELETE policy
--     here — GDPR-06 erasure is a Phase 7 admin path.
--   * 2 indexes: unread-only (partial) + all-rows (full). Frequent queries are
--     "show my unread" and "list all my recent".
--
-- The `kind` column is CHECK-enum-constrained to known kinds — extend the
-- list when Phase 6 ships richer message types.
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §operational_concerns
--            drizzle/0019_phase4_pg_cron_nudges.sql (writers of this table)

CREATE TABLE "system_inbox" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid        NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind"        text        NOT NULL,                       -- 'trainer_score_nudge' | 'player_result_nudge' | ...
  "payload"     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "read_at"     timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "system_inbox_kind_enum"
    CHECK ("kind" IN ('trainer_score_nudge','player_result_nudge'))
);--> statement-breakpoint

-- Partial index for unread-only listing (the most frequent UI query).
CREATE INDEX "idx_system_inbox_user_unread" ON "system_inbox" ("user_id", "created_at" DESC) WHERE "read_at" IS NULL;--> statement-breakpoint
-- Full index for all-rows listing (less frequent — history view).
CREATE INDEX "idx_system_inbox_user_all"    ON "system_inbox" ("user_id", "created_at" DESC);--> statement-breakpoint

COMMENT ON TABLE "system_inbox" IS 'Phase 4 minimal nudge inbox. Phase 6 absorbs/extends with full messaging UI (threads, compose, attachments).';--> statement-breakpoint

-- ENABLE + FORCE RLS — caller sees only own rows.
ALTER TABLE "system_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_inbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- SELECT: own rows only.
CREATE POLICY "system_inbox_select_own" ON "system_inbox" FOR SELECT USING (
  user_id = current_user_id()
);--> statement-breakpoint

-- UPDATE: own rows only (allows marking read_at via UPDATE; user can't
-- escalate to another user_id via the WITH CHECK clause).
CREATE POLICY "system_inbox_update_own" ON "system_inbox" FOR UPDATE
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());--> statement-breakpoint

-- INSERT: no per-action policy at the app_user level. The SECURITY DEFINER
-- cron functions from 0019 deposit rows by virtue of running as the
-- function-owner role (which bypasses RLS or is granted explicit privileges
-- depending on hosting tier). Future Phase 6 message-compose routes will
-- run under SECURITY DEFINER service procedures or add an explicit policy.

-- DELETE: no per-action policy — GDPR-06 erasure runs as a privileged
-- service procedure (Phase 7); end-users cannot delete their own inbox
-- rows directly (audit/forensics concern).
COMMENT ON POLICY "system_inbox_select_own" ON "system_inbox" IS 'Phase 4 D-67 + D-72 nudge inbox — own-rows-only read scope.';
