-- Migration 0009_phase3_calendar_base_lookup_participants_exceptions.sql — Phase 3 Wave 1.
-- ADDITIVE ONLY (MIG-02 expand-contract first phase):
--   * 4 new tables: event_type (lookup), calendar_events,
--     calendar_event_participants (junction), calendar_event_exceptions
--   * 0 ALTER on Phase 1/2 tables
--   * 0 DROP
-- RLS policies are intentionally NOT in this file — they live in 0011 so
-- this migration can be applied independently and rolled back without
-- breaking Phase 1+2 RLS coverage.
--
-- Lookup seed data is in 0012 (separated so schema + data have independent
-- rollback paths — Phase 2 pattern: 0006 schema / 0007 RLS / 0008 seeds).
--
-- Phase 4 schema-handover contract (D-51, NON-NEGOTIABLE):
--   Phase 4 adds ONLY operational tables on top of these schemas:
--     - session_participants(event_id, user_id, quality_score, feedback_text)
--     - session_sparring_partners(event_id, sparring_partner_id)
--     - tournament_results, match_results, ranking_entries
--   NO changes to calendar_events, calendar_event_participants,
--   calendar_event_exceptions, training_sessions, tournaments, meetings,
--   stages, eval_conversations, medical_appointments are permitted in Phase 4.
--
-- D-58 hard-delete contract: calendar_events has NO `deleted_at` column.
-- Forensic recovery uses the audit_log JSONB snapshot written pre-DELETE
-- (see 03-RESEARCH §Example 2 — calendar.event.delete handler).
--
-- Hand-authored — same governance rule as Phase 1+2 migrations.
--
-- Sections:
--   1. CREATE TABLE event_type (lookup) — referenced by calendar_events FK.
--   2. CREATE TABLE calendar_events — base table per D-49.
--   3. CREATE TABLE calendar_event_participants — junction per D-50.
--   4. CREATE TABLE calendar_event_exceptions — single-occurrence override per D-54.
--   5. ALTER TABLE ... ADD CONSTRAINT for FKs.
--   6. CREATE INDEX for performance indexes per RESEARCH §Pattern 2.

-- ============================================================================
-- Section 1: event_type lookup.
-- ============================================================================
-- Same shape as tournament_type / training_type in 0000_initial.sql.

CREATE TABLE "event_type" (
    "code" text PRIMARY KEY NOT NULL,
    "sort_order" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Section 2: calendar_events base table — D-49 class-table inheritance root.
-- ============================================================================
-- Common columns shared across all 6 event types. Domain-specific columns
-- live on the 6 extension tables in migration 0010.
--
-- NO deleted_at column (D-58). Hard delete with FK CASCADE.
--
-- CHECK calendar_events_ends_after_starts uses >= (not >) so a 0-duration
-- "marker" event (e.g. a tournament's seeding deadline at exactly noon) is
-- representable. The 24h max-duration rule (errors.calendar.rangeTooLarge)
-- is enforced at the Zod layer per UI-SPEC line 686 — not as a DB check
-- (a check would forbid legitimate multi-day stages).

CREATE TABLE "calendar_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type_code" text NOT NULL,
    "title" text NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "all_day" boolean DEFAULT false NOT NULL,
    "location" text,
    "description" text,
    "rrule" text,
    "created_by" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "calendar_events_ends_after_starts" CHECK ("calendar_events"."ends_at" >= "calendar_events"."starts_at")
);
--> statement-breakpoint

-- ============================================================================
-- Section 3: calendar_event_participants junction — D-50 polymorphic.
-- ============================================================================
-- Composite PRIMARY KEY (event_id, user_id) prevents duplicate participation.
-- Phase 3 carries the role_in_event + rsvp_status fields on the junction
-- itself (not a separate table) — sparring partners are NOT modelled here
-- in Phase 3 (D-50 no-op); Phase 4 adds session_sparring_partners as a
-- SECOND junction parallel to this one.
--
-- D-58 RSVP decline: calendar.event.declineParticipation updates
-- rsvp_status='declined' for the calling user; mutation row-WHERE clause
-- + RLS prevents declining another user's invite.

CREATE TABLE "calendar_event_participants" (
    "event_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "role_in_event" text NOT NULL,
    "rsvp_status" text DEFAULT 'pending' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "calendar_event_participants_pk" PRIMARY KEY ("event_id", "user_id"),
    CONSTRAINT "cep_role_enum" CHECK ("role_in_event" IN ('organizer','participant','invitee')),
    CONSTRAINT "cep_rsvp_enum" CHECK ("rsvp_status" IN ('pending','accepted','declined'))
);
--> statement-breakpoint

-- ============================================================================
-- Section 4: calendar_event_exceptions — D-54 single-occurrence override.
-- ============================================================================
-- Phase 3 scope: "Deze afspraak" radio in UI3-D12 maps to ONE row in this
-- table per modified occurrence. Phase 4 adds "Deze en toekomstige" +
-- "Alle in de reeks" handling without schema changes.
--
-- override_* columns are nullable; the service layer applies an override
-- only when the value is non-null. cancelled=true is the dominant flag
-- (skip the occurrence entirely regardless of override values).
--
-- UNIQUE(event_id, occurrence_date) prevents writing two exceptions for
-- the same occurrence — the unique index is created as a separate
-- CREATE UNIQUE INDEX in Section 6.

CREATE TABLE "calendar_event_exceptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_id" uuid NOT NULL,
    "occurrence_date" date NOT NULL,
    "cancelled" boolean DEFAULT false NOT NULL,
    "override_starts_at" timestamp with time zone,
    "override_ends_at" timestamp with time zone,
    "override_title" text,
    "override_location" text,
    "override_description" text,
    "created_by" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "cee_override_times_consistent" CHECK (
        ("override_starts_at" IS NULL AND "override_ends_at" IS NULL)
        OR ("override_starts_at" IS NOT NULL AND "override_ends_at" IS NOT NULL AND "override_ends_at" >= "override_starts_at")
    )
);
--> statement-breakpoint

-- ============================================================================
-- Section 5: Foreign keys (separate ALTER per FK — Phase 2 0006 convention).
-- ============================================================================
-- ON DELETE behaviour rationale:
--   - calendar_events.type_code → event_type: RESTRICT (admin must
--     deactivate the lookup row first; never drop an event type that has
--     events).
--   - calendar_events.created_by → users: RESTRICT (deleting a user
--     with calendar history must fail loudly; Phase 7 erasure runs
--     anonymisation BEFORE this constraint can fire).
--   - calendar_event_participants.event_id → calendar_events: CASCADE
--     (D-58: deleting the event drops participants atomically).
--   - calendar_event_participants.user_id → users: CASCADE (deleting a
--     user removes their participation; the event itself survives for
--     other participants — consistent with anonymisation strategy).
--   - calendar_event_exceptions.event_id → calendar_events: CASCADE (D-58).
--   - calendar_event_exceptions.created_by → users: RESTRICT (audit trail
--     of who created the exception must survive).

ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_type_code_event_type_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."event_type"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "cep_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "cep_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "cee_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "cee_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- ============================================================================
-- Section 6: Indexes for performance per 03-RESEARCH §Pattern 2 (lines 510-518).
-- ============================================================================
-- B-tree composite on (starts_at, ends_at) for range queries; no GiST in
-- v1 (RESEARCH Open Question 2 — defer until perf test fails the 200ms budget).
-- (user_id, event_id) on participants prioritises scope queries — RLS
-- helper unionneert via cep.user_id = caller_id first.

CREATE INDEX "idx_calendar_events_starts_ends" ON "calendar_events" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_type" ON "calendar_events" USING btree ("type_code");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_creator" ON "calendar_events" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_cep_user_event" ON "calendar_event_participants" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "idx_cee_event" ON "calendar_event_exceptions" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_calendar_event_exceptions_event_occurrence" ON "calendar_event_exceptions" USING btree ("event_id","occurrence_date");
