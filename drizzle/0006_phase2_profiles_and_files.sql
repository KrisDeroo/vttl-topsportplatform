-- Migration 0006_phase2_profiles_and_files.sql — Phase 2 Wave 2.
-- ADDITIVE ONLY (MIG-02 expand-contract first phase):
--   * 6 new tables: players, trainers, uploaded_files, age_category_history,
--     age_categories, trainer_diploma
--   * 0 ALTER on Phase 1 tables (users, sessions, memberships, etc.)
--   * 0 DROP
-- RLS policies are intentionally NOT in this file — they live in 0007 so this
-- migration can be applied independently and rolled back without bringing
-- down Phase 1 RLS coverage.
--
-- Lookup seed data is in 0008 (separated so schema + data have independent
-- rollback paths).
--
-- Hand-authored — same governance rule as Phase 1 migrations (0000..0005 are
-- all hand-authored because the agent worktree historically lacked
-- `drizzle-kit generate`). Locally `drizzle-kit generate` was executed once
-- against the TS schema in 02-02 to confirm the column shapes; its output was
-- the full schema (no prior snapshot to diff against), so this file is the
-- hand-extracted additive subset. Plan 02-14 will reconcile via
-- `drizzle-kit introspect` against staging (MIG-01: never edit a committed
-- migration once applied).
--
-- Sections:
--   1. CREATE TABLE for the 2 new lookup tables (age_categories,
--      trainer_diploma) — referenced by FKs below, so created first.
--   2. CREATE TABLE uploaded_files — referenced by players + trainers via
--      profile_photo_file_id; CHECK constraints inline.
--   3. CREATE TABLE players + age_category_history — players is the parent
--      of age_category_history's player_id FK, so players first.
--   4. CREATE TABLE trainers.
--   5. ALTER TABLE ... ADD CONSTRAINT for every FK (Drizzle Kit emits these
--      as separate statements after every CREATE TABLE).
--   6. CREATE INDEX for the 5 performance indexes locked in 02-02.

-- ============================================================================
-- Section 1: Lookup tables (no FKs into Phase 1 tables; create first because
-- players / trainers / age_category_history have FKs into these).
-- ============================================================================

CREATE TABLE "age_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"born_after_or_equal" integer,
	"born_before_or_equal" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint

CREATE TABLE "trainer_diploma" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Section 2: uploaded_files — single source of truth for all platform files
-- (D-30). Phase 2 uses bucket='profiles'; Phase 4+ will reuse with
-- bucket='evaluations' and bucket='medical'.
--
-- CHECK constraints:
--   * uploaded_files_scan_status_enum: pending/clean/infected enum
--     (Postgres has no native CHECK-on-text-enum without it)
--   * uploaded_files_sha256_format: 64-hex-char digest (NULL while scan
--     pending; the worker sets it via mark_scan_result() in 0007)
-- UNIQUE: storage_key (no two files may share an R2 path)
-- INDEX: (owner_user_id, scan_status) — supports "list pending scans for
-- a user" queries that Plan 02-06 worker uses.
-- ============================================================================

CREATE TABLE "uploaded_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"scan_completed_at" timestamp with time zone,
	"sha256" text,
	"superseded_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_uploaded_files_storage_key" UNIQUE("storage_key"),
	CONSTRAINT "uploaded_files_scan_status_enum" CHECK ("uploaded_files"."scan_status" IN ('pending', 'clean', 'infected')),
	CONSTRAINT "uploaded_files_sha256_format" CHECK ("uploaded_files"."sha256" IS NULL OR "uploaded_files"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint

-- ============================================================================
-- Section 3: players + age_category_history (DOM-CAT-01).
--
-- players:
--   * user_id IS the PK (D-26 — a player IS a user with extra fields).
--   * is_minor denormalised from users.is_minor (kept in sync by
--     deriveAgeCategory() helper; Plan 02-04 documents the contract).
--   * CHECK players_minor_emergency_contact: minors MUST have emergency
--     contact name + phone populated (PLAYER-06 hard rule).
--   * 2 indexes: idx_players_academy (list players per academy) +
--     idx_players_status (status_a / status_b / status_c filter on the
--     player roster page).
-- age_category_history:
--   * BIGSERIAL id (audit trail of category transitions).
--   * UNIQUE(player_id, effective_from): at most one transition per
--     player per day (a same-day rollback overwrites instead of stacking).
--   * CHECK age_history_effective_to_after_from: closes a row chronological
--     gap (effective_to >= effective_from or open-ended NULL).
--   * Composite INDEX idx_age_history_lookup supports the
--     getAgeCategoryAt(playerId, asOf) lookup (Pattern 2 in 02-RESEARCH).
-- ============================================================================

CREATE TABLE "players" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" text NOT NULL,
	"school" text,
	"street" text NOT NULL,
	"street_number" text,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"country" text DEFAULT 'BE' NOT NULL,
	"phone" text,
	"email" text,
	"club" text,
	"status_code" text NOT NULL,
	"academy_code" text NOT NULL,
	"age_category" text NOT NULL,
	"category_year" integer NOT NULL,
	"is_minor" boolean NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relation" text,
	"profile_photo_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_minor_emergency_contact" CHECK ((NOT "players"."is_minor") OR ("players"."emergency_contact_name" IS NOT NULL AND "players"."emergency_contact_phone" IS NOT NULL))
);
--> statement-breakpoint

CREATE TABLE "age_category_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"age_category_code" text NOT NULL,
	"category_year" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_age_history_player_effective_from" UNIQUE("player_id","effective_from"),
	CONSTRAINT "age_history_effective_to_after_from" CHECK ("age_category_history"."effective_to" IS NULL OR "age_category_history"."effective_to" >= "age_category_history"."effective_from")
);
--> statement-breakpoint

-- ============================================================================
-- Section 4: trainers (TRAINER-01..02, D-26/D-38).
--
-- Same 1:1-to-users pattern as players (user_id IS the PK). Diploma
-- references the new trainer_diploma lookup; pedagogical-qualification is
-- a boolean toggle (TRAINER-02). Index on diploma_code supports the
-- "list trainers per diploma" admin filter.
-- ============================================================================

CREATE TABLE "trainers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" text NOT NULL,
	"street" text NOT NULL,
	"street_number" text,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"country" text DEFAULT 'BE' NOT NULL,
	"phone" text,
	"email" text,
	"diploma_code" text NOT NULL,
	"has_pedagogical_qualification" boolean DEFAULT false NOT NULL,
	"profile_photo_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Section 5: Foreign keys.
--
-- ON DELETE behaviour summary:
--   * users.id → players/trainers/uploaded_files.user_id|owner_user_id:
--     CASCADE. Deleting the underlying user removes the profile row
--     (the user IS the player/trainer).
--   * uploaded_files.id → players/trainers.profile_photo_file_id:
--     SET NULL (D-29). Deleting a file row clears the reference instead
--     of blocking the user delete or orphaning the profile.
--   * age_categories.code → players.age_category, age_category_history.age_category_code,
--     status.code → players.status_code, academy.code → players.academy_code,
--     trainer_diploma.code → trainers.diploma_code: RESTRICT. Lookup
--     codes are referenced from data rows; deleting an in-use code would
--     orphan the data. To retire a code use `active=false` instead.
--   * players.user_id → age_category_history.player_id: CASCADE. Deleting
--     the player removes their category-transition history (the history
--     has no value without its subject).
--   * users.id → age_category_history.set_by: NO ACTION (default). The
--     audit row preserves who set the category; if the setter user is
--     deleted, the audit row keeps a NULL FK rather than blocking the
--     deletion. (Per Phase 1 audit pattern; see 0000_initial.sql for the
--     same convention on linked_by columns.)
-- ============================================================================

ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_category_history" ADD CONSTRAINT "age_category_history_player_id_players_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_category_history" ADD CONSTRAINT "age_category_history_age_category_code_age_categories_code_fk" FOREIGN KEY ("age_category_code") REFERENCES "public"."age_categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_category_history" ADD CONSTRAINT "age_category_history_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_status_code_status_code_fk" FOREIGN KEY ("status_code") REFERENCES "public"."status"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_academy_code_academy_code_fk" FOREIGN KEY ("academy_code") REFERENCES "public"."academy"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_age_category_age_categories_code_fk" FOREIGN KEY ("age_category") REFERENCES "public"."age_categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_profile_photo_file_id_uploaded_files_id_fk" FOREIGN KEY ("profile_photo_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_diploma_code_trainer_diploma_code_fk" FOREIGN KEY ("diploma_code") REFERENCES "public"."trainer_diploma"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_profile_photo_file_id_uploaded_files_id_fk" FOREIGN KEY ("profile_photo_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ============================================================================
-- Section 6: Performance indexes (locked in 02-02 must_haves).
--
-- idx_uploaded_files_owner_scan: composite (owner_user_id, scan_status)
--   supports "list pending scans for a user" (Plan 02-06 worker) and
--   "list clean files for a user" (profile photo gallery).
-- idx_age_history_lookup: composite (player_id, effective_from DESC NULLS LAST,
--   effective_to) supports the index-only getAgeCategoryAt() lookup
--   (Pattern 2 in 02-RESEARCH). DESC on effective_from because the typical
--   query is "latest active row as of date D".
-- idx_players_academy / idx_players_status: single-column btree for roster
--   filters on the admin player list page.
-- idx_trainers_diploma: single-column btree for "list trainers per diploma"
--   on the trainer roster page.
-- ============================================================================

CREATE INDEX "idx_uploaded_files_owner_scan" ON "uploaded_files" USING btree ("owner_user_id","scan_status");--> statement-breakpoint
CREATE INDEX "idx_age_history_lookup" ON "age_category_history" USING btree ("player_id","effective_from" DESC NULLS LAST,"effective_to");--> statement-breakpoint
CREATE INDEX "idx_players_academy" ON "players" USING btree ("academy_code");--> statement-breakpoint
CREATE INDEX "idx_players_status" ON "players" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "idx_trainers_diploma" ON "trainers" USING btree ("diploma_code");
