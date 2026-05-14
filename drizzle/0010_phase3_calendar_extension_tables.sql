-- Migration 0010_phase3_calendar_extension_tables.sql — Phase 3 Wave 1.
-- ADDITIVE ONLY:
--   * 6 new tables (one per event_type code): training_sessions,
--     tournaments, meetings, stages, eval_conversations, medical_appointments
--   * 0 ALTER on Phase 1/2 tables
--   * 0 DROP
-- Each extension table follows class-table inheritance per D-49:
--     event_id uuid PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE
-- + type-specific domain columns per REQUIREMENTS.md §TRAIN/§TOURN/etc.
--
-- D-47 scope contract: Phase 3 ships ALL domain-specific fields per the
-- relevant REQUIREMENTS section. Phase 4 reduces to operational layer
-- (session_participants quality scores; tournament_results; ranking_entries).
-- ZERO changes to these extension schemas in Phase 4 (D-51).
--
-- D-58 RSVP decline: the junction (calendar_event_participants) carries
-- accepted/declined; extension tables do NOT need their own RSVP fields.
--
-- medical_appointments — IMPORTANT (CONTEXT integration-point):
--   This extension stores NON-Article-9 metadata: doctor name (free text,
--   borderline — flag for Phase 5 legal review), is_injury bool. Article-9
--   medical data (diagnosis details, scan documents) lives EXCLUSIVELY in
--   Phase 1's medical_events + medical_documents tables with pgcrypto
--   cipher columns and stricter RLS.
--   No pgcrypto columns in this extension. Do NOT add diagnosis/body/etc.
--
-- Hand-authored — same governance rule as Phase 1+2 migrations.
--
-- Sections:
--   1. training_sessions       — TRAIN-01 fields
--   2. tournaments             — TOURN-01 fields
--   3. meetings                — minimal base (title/location/desc covered by calendar_events)
--   4. stages                  — AGE-01 fields (multi-day camp, country)
--   5. eval_conversations      — AGE-03 fields (evaluator + player FKs)
--   6. medical_appointments    — MED-EVENT fields (non-Article-9 only)
--   7. ALTER TABLE ... ADD CONSTRAINT for FKs.

-- ============================================================================
-- Section 1: training_sessions — TRAIN-01.
-- ============================================================================
-- Columns per REQUIREMENTS TRAIN-01 (verbatim):
--   datum (= calendar_events.starts_at — not duplicated)
--   starttijd (= calendar_events.starts_at)
--   duur (= duration_minutes — REQUIRED redundancy per TRAIN-01 spec —
--         training reports show "60 min" not "10:00–11:00"; redundancy
--         with ends_at is acceptable since both are write-time-derived)
--   trainingtype (= training_type_code FK)
--   organisatie (= organisation_code FK)
--   trainer (= trainer_id FK)
--   locatie (= calendar_events.location — free text — not duplicated)

CREATE TABLE "training_sessions" (
    "event_id" uuid PRIMARY KEY NOT NULL,
    "duration_minutes" integer NOT NULL,
    "training_type_code" text NOT NULL,
    "organisation_code" text NOT NULL,
    "trainer_id" uuid NOT NULL,
    CONSTRAINT "training_sessions_duration_positive" CHECK ("duration_minutes" > 0)
);
--> statement-breakpoint

-- ============================================================================
-- Section 2: tournaments — TOURN-01.
-- ============================================================================
-- Columns per REQUIREMENTS TOURN-01:
--   naam (= calendar_events.title)
--   startdatum (= calendar_events.starts_at)
--   stad (= city; free text — proper noun, NOT in lookup per I18N-06)
--   land (= country; ISO-3166-1 alpha-2, default 'BE')
--   leeftijdscategorie (= age_category_code FK to ageCategories)
--   tornooitype (= tournament_type_code FK to tournamentType)
-- TOURN-01 does NOT mandate end-date; calendar_events.ends_at carries it
-- (a one-day tournament: ends_at = starts_at + 1 day or session length).

CREATE TABLE "tournaments" (
    "event_id" uuid PRIMARY KEY NOT NULL,
    "city" text NOT NULL,
    "country" text NOT NULL DEFAULT 'BE',
    "age_category_code" text NOT NULL,
    "tournament_type_code" text NOT NULL,
    CONSTRAINT "tournaments_country_iso2" CHECK (char_length("country") = 2)
);
--> statement-breakpoint

-- ============================================================================
-- Section 3: meetings — D-47 + UI-SPEC base meeting type.
-- ============================================================================
-- A meeting only needs the base calendar_events fields (title, start/end,
-- location, description, participants via junction). The extension table
-- exists to satisfy the polymorphism contract — every type_code has a
-- corresponding extension row even if it adds zero columns.
-- Future Phase: AGE-02 recurring meetings already use calendar_events.rrule;
-- meeting_invitations workflow per AGE-02 invitations beyond participants
-- (accept/decline) reuses calendar_event_participants.rsvp_status.

CREATE TABLE "meetings" (
    "event_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Section 4: stages — AGE-01.
-- ============================================================================
-- Columns per REQUIREMENTS AGE-01:
--   naam (= calendar_events.title)
--   plaats (= place — free text, distinct from generic location field)
--   land (= country, ISO-3166-1 alpha-2)
--   startdatum (= calendar_events.starts_at)
--   einddatum (= calendar_events.ends_at)
--   deelnemende spelers (= via calendar_event_participants)
--   deelnemende trainers (= via calendar_event_participants)
-- The country/place are stage-specific (different from calendar_events.location
-- which is the generic free-text), since AGE-01 splits geography vs venue.

CREATE TABLE "stages" (
    "event_id" uuid PRIMARY KEY NOT NULL,
    "place" text NOT NULL,
    "country" text NOT NULL DEFAULT 'BE',
    CONSTRAINT "stages_country_iso2" CHECK (char_length("country") = 2)
);
--> statement-breakpoint

-- ============================================================================
-- Section 5: eval_conversations — AGE-03.
-- ============================================================================
-- Columns per REQUIREMENTS AGE-03:
--   datum (= calendar_events.starts_at)
--   startuur/einduur (= calendar_events.starts_at/ends_at)
--   evaluator (= evaluator_user_id — trainer or TD)
--   speler (= player_user_id)
-- Both evaluator + player should also appear in calendar_event_participants
-- as participants. The dedicated FKs here let the conversation surface
-- (Phase 5 evaluation router) read the relationship without scanning the
-- junction.

CREATE TABLE "eval_conversations" (
    "event_id" uuid PRIMARY KEY NOT NULL,
    "evaluator_user_id" uuid NOT NULL,
    "player_user_id" uuid NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Section 6: medical_appointments — MED-EVENT (non-Article-9).
-- ============================================================================
-- Columns per REQUIREMENTS MED-01 mapped onto a calendar event:
--   medisch event (= calendar_events.title — free text)
--   blessure (= is_injury bool toggle)
--   dokter (= doctor — free text; borderline per CONTEXT integration-point
--            — flag for Phase 5 legal review; if review pushes to encrypt,
--            Phase 5 ships an additive migration)
--   startdatum (= calendar_events.starts_at)
--   einddatum (= calendar_events.ends_at)
-- NOTE: Phase 1's medical_events table (with pgcrypto cipher columns for
-- diagnosis body) is the Article-9 store. This table is the calendar-event
-- shadow only — light metadata for scheduling. The MED-04 traffic-light
-- coach view STILL reads medical_events, NOT this table.

CREATE TABLE "medical_appointments" (
    "event_id" uuid PRIMARY KEY NOT NULL,
    "is_injury" boolean NOT NULL DEFAULT false,
    "doctor" text
);
--> statement-breakpoint

-- ============================================================================
-- Section 7: Foreign keys (separate ALTER per FK — Phase 2 0006 convention).
-- ============================================================================
-- Every event_id is ON DELETE CASCADE per D-49 (deleting the base row
-- cascades to the extension; calendar_events DELETE drops everything).
-- Lookup FKs are ON DELETE RESTRICT (a code in use cannot be dropped).
-- trainer_id / evaluator_user_id / player_user_id are ON DELETE RESTRICT
-- (anonymisation runs first per Phase 7 GDPR-06).

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_training_type_fk" FOREIGN KEY ("training_type_code") REFERENCES "public"."training_type"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_organisation_fk" FOREIGN KEY ("organisation_code") REFERENCES "public"."organisation"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_trainer_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_age_category_fk" FOREIGN KEY ("age_category_code") REFERENCES "public"."age_categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_tournament_type_fk" FOREIGN KEY ("tournament_type_code") REFERENCES "public"."tournament_type"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "stages" ADD CONSTRAINT "stages_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "eval_conversations" ADD CONSTRAINT "eval_conversations_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_conversations" ADD CONSTRAINT "eval_conversations_evaluator_fk" FOREIGN KEY ("evaluator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_conversations" ADD CONSTRAINT "eval_conversations_player_fk" FOREIGN KEY ("player_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "medical_appointments" ADD CONSTRAINT "medical_appointments_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;
