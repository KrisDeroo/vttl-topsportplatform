-- 0014_phase4_session_participants_and_sparring_junction.sql
-- Phase 4 (Kerndomein) — operational tables on top of Phase 3 calendar.
-- Corrects Phase 3 D-51 sketch per D-82: session_participants has composite
-- PK (event_id, occurrence_date, user_id), NOT (event_id, user_id). Each
-- occurrence of a recurring training gets its own attendance/score row.
-- Past data immutable per D-83 — enforced at the API layer in Plan 04-03/04-06.
--
-- Tables in this migration:
--   * session_participants    — per-occurrence attendance + 1..10 score + feedback (D-60..D-64 + D-82).
--   * session_sparring_partners — junction filling Phase 3 RLS placeholder
--                                 (calendar_events_visible_to Branch 6).
--
-- RLS, audit, and the 14-day score wall (D-64) live downstream (0018 + Plan 04-03).
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-60..D-64 + §D-82
--            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 4

-- ─── session_participants ─────────────────────────────────────────
CREATE TABLE "session_participants" (
  "event_id"        uuid        NOT NULL REFERENCES "calendar_events"("id") ON DELETE cascade,
  "occurrence_date" date        NOT NULL,                    -- D-82: per-occurrence row
  "user_id"         uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "attended"        boolean,                                 -- nullable (pending)
  "quality_score"   smallint,                                -- D-60 nullable; range checked below
  "feedback_text"   text,
  "created_by"      uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "session_participants_pkey" PRIMARY KEY ("event_id", "occurrence_date", "user_id"),
  CONSTRAINT "session_participants_quality_score_range"
    CHECK ("quality_score" IS NULL OR "quality_score" BETWEEN 1 AND 10),
  CONSTRAINT "session_participants_feedback_length"
    CHECK ("feedback_text" IS NULL OR char_length("feedback_text") <= 2000)
);--> statement-breakpoint

CREATE INDEX "idx_session_participants_user_date" ON "session_participants" ("user_id", "occurrence_date");--> statement-breakpoint
CREATE INDEX "idx_session_participants_event"     ON "session_participants" ("event_id");--> statement-breakpoint
CREATE INDEX "idx_session_participants_pending"   ON "session_participants" ("event_id")
  WHERE "quality_score" IS NULL;--> statement-breakpoint

COMMENT ON TABLE "session_participants" IS 'Per-occurrence attendance + 1..10 quality score + feedback (D-60..D-64 + D-82).';--> statement-breakpoint

-- ─── session_sparring_partners ────────────────────────────────────
-- Junction filling Phase 3 RLS placeholder (calendar_events_visible_to Branch 6).
-- FK target: users.id where role='sparring_partner'. Row-filter enforced
-- in app layer + integration test (no native PG row-filter on FK).
CREATE TABLE "session_sparring_partners" (
  "event_id"            uuid        NOT NULL REFERENCES "calendar_events"("id") ON DELETE cascade,
  "sparring_partner_id" uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_by"          uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "session_sparring_partners_pkey" PRIMARY KEY ("event_id", "sparring_partner_id")
);--> statement-breakpoint

CREATE INDEX "idx_session_sparring_partners_user" ON "session_sparring_partners" ("sparring_partner_id");--> statement-breakpoint

COMMENT ON TABLE "session_sparring_partners" IS 'Junction for SPAR-02 / D-63 — FK to users.id, role filter enforced in app layer.';
