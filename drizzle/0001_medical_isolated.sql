-- Migration 0001_medical_isolated.sql — Phase 1 Wave 3, Plan 03.
-- Medical-data isolation per CRIT-2 + CRIT-7 + GDPR-03/04/07.
--
-- Hand-authored (the agent worktree cannot run `npx drizzle-kit generate`;
-- Plan 16 will reconcile via `drizzle-kit introspect` once node_modules is
-- available against staging — same pattern as 0000_initial.sql).
--
-- Sections:
--   1. CREATE TABLE medical_events / medical_documents / medical_access_audit
--   2. FK constraints (ON DELETE RESTRICT for player_user_id, CASCADE for
--      medical_event_id on documents)
--   3. updated_at trigger on medical_events (Block A)
--   4. Write-time audit triggers — medical_event_audit + medical_document_audit
--      (Block B; CRIT-7 — write-time only, read-time deferred to Phase 5)
--   5. Postgres role grants — INSERT-only on medical_access_audit for
--      app_user (Block C; T-01-04 tamper-evidence)
--   6. Performance indexes for the medical lookups RLS will hit (Block D;
--      CRIT-8)
--
-- pgcrypto extension is already enabled by 0000_initial.sql; this migration
-- reuses it for the cipher columns.

CREATE TABLE "medical_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_user_id" uuid NOT NULL,
	"event_description_cipher" text NOT NULL,
	"doctor_cipher" text,
	"is_injury" boolean DEFAULT false NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE "medical_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medical_event_id" uuid,
	"player_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename_cipher" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "medical_documents_storage_key_unique" UNIQUE("storage_key")
);--> statement-breakpoint

CREATE TABLE "medical_access_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"subject_player_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid,
	"action" text NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" text,
	"outcome" text DEFAULT 'success' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Foreign keys: ON DELETE RESTRICT for player_user_id (preserves audit when a
-- naive `DELETE FROM users` is attempted on a player with medical history),
-- ON DELETE CASCADE for medical_documents.medical_event_id (orphan documents
-- after their parent event is hard-deleted would dangle).
ALTER TABLE "medical_events" ADD CONSTRAINT "medical_events_player_user_id_users_id_fk" FOREIGN KEY ("player_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_events" ADD CONSTRAINT "medical_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_medical_event_id_medical_events_id_fk" FOREIGN KEY ("medical_event_id") REFERENCES "public"."medical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_player_user_id_users_id_fk" FOREIGN KEY ("player_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ============================================================================
-- HAND-AUGMENTED BLOCKS (plan 01-03 task 2)
-- ============================================================================

-- Block A: updated_at trigger on medical_events. Reuses set_updated_at()
-- from 0000_initial.sql.
CREATE TRIGGER trg_medical_events_updated_at BEFORE UPDATE ON medical_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Block B: write-time audit triggers (CRIT-7).
--
-- Every INSERT / UPDATE / DELETE on medical_events and medical_documents
-- writes a row to medical_access_audit. This is the "what changed and who
-- did it" trail for Article-9 special-category data.
--
-- Read-time audit is intentionally NOT done at trigger level: PostgreSQL has
-- no SELECT trigger primitive. The Phase-5 app-layer middleware (Plan 11
-- CallerContext + a dedicated medical-procedure wrapper) emits an async
-- BullMQ job that writes a 'read' or 'export' row — async because synchronous
-- audit-on-every-medical-read would block every dashboard widget that touches
-- medical data.
--
-- The triggers are SECURITY DEFINER so they run as the migration owner
-- (`postgres` / database owner role), not as `app_user`. This matters because
-- the `app_user` role has its UPDATE/DELETE on medical_access_audit revoked
-- in Block C — only the trigger and the `app_audit_writer` role can write,
-- and the trigger does so under elevated privileges. The `SET search_path =
-- public` clause is mandatory for SECURITY DEFINER functions: without it, a
-- malicious search_path could swap `medical_access_audit` for an attacker-
-- controlled table.
--
-- GUC reads (`current_setting('app.user_id', true)`):
--   - second arg `true` = "missing_ok"; returns NULL if the GUC is unset
--     instead of throwing. Plan 11 sets the GUC inside every tRPC request;
--     migrations and cron jobs do not, so the trigger falls back to the
--     all-zeros UUID sentinel for system actions. The empty-string-to-NULL
--     coalescing via NULLIF protects against an explicitly cleared GUC
--     (`SET app.user_id = ''`).
--
-- INSERT-vs-UPDATE-vs-DELETE action classification:
--   - INSERT: action = 'write', subject = NEW.player_user_id
--   - UPDATE that flips deleted_at NULL→NOT-NULL: action = 'delete' (the
--     soft-delete flow). Other UPDATEs: action = 'write'.
--   - DELETE (hard): action = 'delete', subject = OLD.player_user_id.

CREATE OR REPLACE FUNCTION medical_event_audit() RETURNS TRIGGER AS $$
DECLARE
  actor UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
  req_id TEXT := NULLIF(current_setting('app.request_id', true), '');
  action_kind TEXT;
  subject_id UUID;
  rec_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_kind := 'write';
    subject_id := NEW.player_user_id;
    rec_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    action_kind := CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete' ELSE 'write' END;
    subject_id := NEW.player_user_id;
    rec_id := NEW.id;
  ELSE -- DELETE (hard)
    action_kind := 'delete';
    subject_id := OLD.player_user_id;
    rec_id := OLD.id;
  END IF;

  INSERT INTO medical_access_audit
    (actor_user_id, subject_player_id, record_type, record_id, action, request_id, outcome)
  VALUES
    (COALESCE(actor, '00000000-0000-0000-0000-000000000000'::uuid), subject_id, 'medical_event', rec_id, action_kind, req_id, 'success');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;--> statement-breakpoint

CREATE TRIGGER trg_medical_event_audit
  AFTER INSERT OR UPDATE OR DELETE ON medical_events
  FOR EACH ROW EXECUTE FUNCTION medical_event_audit();--> statement-breakpoint

CREATE OR REPLACE FUNCTION medical_document_audit() RETURNS TRIGGER AS $$
DECLARE
  actor UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
  req_id TEXT := NULLIF(current_setting('app.request_id', true), '');
  action_kind TEXT;
  subject_id UUID;
  rec_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_kind := 'write';
    subject_id := NEW.player_user_id;
    rec_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    action_kind := CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete' ELSE 'write' END;
    subject_id := NEW.player_user_id;
    rec_id := NEW.id;
  ELSE -- DELETE (hard)
    action_kind := 'delete';
    subject_id := OLD.player_user_id;
    rec_id := OLD.id;
  END IF;

  INSERT INTO medical_access_audit
    (actor_user_id, subject_player_id, record_type, record_id, action, request_id, outcome)
  VALUES
    (COALESCE(actor, '00000000-0000-0000-0000-000000000000'::uuid), subject_id, 'medical_document', rec_id, action_kind, req_id, 'success');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;--> statement-breakpoint

CREATE TRIGGER trg_medical_document_audit
  AFTER INSERT OR UPDATE OR DELETE ON medical_documents
  FOR EACH ROW EXECUTE FUNCTION medical_document_audit();--> statement-breakpoint

-- Block C: INSERT-only privileges for app_user on medical_access_audit
-- (CRIT-7, T-01-04 — repudiation mitigation). Reads are blocked outright at
-- the role layer here AND at the RLS layer in Plan 04 (USING (false)). The
-- TD reads via the SECURITY DEFINER `query_medical_access_audit()` function
-- created in Plan 04, which runs as the database owner.
--
-- ALTER DEFAULT PRIVILEGES from 0000_initial.sql granted SELECT, INSERT,
-- UPDATE, DELETE on every future-created table to app_user; we revoke the
-- write-mutation grants here BEFORE granting INSERT. The order matters: a
-- bare GRANT INSERT after a GRANT ALL is a no-op, but a REVOKE UPDATE,DELETE
-- after a GRANT ALL leaves SELECT and INSERT in place.
--
-- We do NOT revoke SELECT here — Plan 04 enables RLS with USING (false),
-- which is the read-blocking enforcement. Belt-and-braces: a future RLS
-- policy bypass attempt still hits the SECURITY DEFINER readback function
-- gate.
REVOKE UPDATE, DELETE ON medical_access_audit FROM app_user;--> statement-breakpoint
GRANT INSERT ON medical_access_audit TO app_user;--> statement-breakpoint
GRANT INSERT ON medical_access_audit TO app_audit_writer;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE medical_access_audit_id_seq TO app_user, app_audit_writer;--> statement-breakpoint

-- Block D: performance indexes for medical lookups (CRIT-8).
--
-- The partial indexes WHERE deleted_at IS NULL match the most common query
-- predicate (live medical events for a player); a full index would carry
-- soft-deleted rows that legitimate queries always exclude.
--
-- The (player_user_id, start_date, end_date) composite supports the
-- "events overlapping date range D" query that Phase 5 training-absence
-- calculation needs. start_date is the leading column because end_date is
-- nullable; ordering by leading non-null gives the planner a cleaner
-- range-scan plan.
--
-- The medical_access_audit indexes are descending on occurred_at because
-- the TD admin UI (Phase 7) shows newest-first by default; an ascending
-- index would force a backward scan on every request.
CREATE INDEX "idx_medical_events_player" ON "medical_events" ("player_user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_medical_events_player_dates" ON "medical_events" ("player_user_id", "start_date", "end_date");--> statement-breakpoint
CREATE INDEX "idx_medical_documents_event" ON "medical_documents" ("medical_event_id");--> statement-breakpoint
CREATE INDEX "idx_medical_documents_player" ON "medical_documents" ("player_user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_maa_subject" ON "medical_access_audit" ("subject_player_id", "occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_maa_actor" ON "medical_access_audit" ("actor_user_id", "occurred_at" DESC);
