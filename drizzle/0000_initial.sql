-- Migration 0000_initial.sql — Phase 1 Wave 2, Plan 02.
-- Hand-augmented drizzle-kit output:
--   * Section 1 (auto): CREATE TYPE / CREATE TABLE / FK constraints
--   * Section 2 (manual append): pgcrypto extension, two-role separation,
--     set_updated_at() trigger function + triggers, RLS-helper indexes.
--
-- The hand-authored sections (block A..D) correspond exactly to the
-- plan's task 3 spec; CI will run `npx drizzle-kit generate --name=initial`
-- and assert zero diff against this file (RESEARCH §Migration Governance,
-- MIG-01: never edit a committed migration).

CREATE TYPE "public"."locale" AS ENUM('nl', 'en', 'fr');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('technical_director', 'academy_manager', 'trainer', 'player', 'parent', 'sparring_partner', 'medical_staff');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'player' NOT NULL,
	"preferred_locale" "locale" DEFAULT 'nl' NOT NULL,
	"date_of_birth" date,
	"active" boolean DEFAULT false NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"fresh_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"password" text
);--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "status" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "academy" (
	"code" text PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "tournament_type" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "ranking_type" (
	"code" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "training_type" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "organisation" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "outcome_level" (
	"code" text PRIMARY KEY NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE "academy_memberships" (
	"user_id" uuid NOT NULL,
	"academy_code" text NOT NULL,
	"role" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" uuid,
	CONSTRAINT "academy_memberships_user_id_academy_code_role_pk" PRIMARY KEY("user_id","academy_code","role")
);--> statement-breakpoint
CREATE TABLE "parent_child_links" (
	"parent_user_id" uuid NOT NULL,
	"child_user_id" uuid NOT NULL,
	"consent_given_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" uuid,
	CONSTRAINT "parent_child_links_parent_user_id_child_user_id_pk" PRIMARY KEY("parent_user_id","child_user_id"),
	CONSTRAINT "uniq_child_user" UNIQUE("child_user_id")
);--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_category" text NOT NULL,
	"policy_version" varchar(32) NOT NULL,
	"locale" text NOT NULL,
	"consent_text_snapshot" text NOT NULL,
	"consent_text_sha256" varchar(64) NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"consenting_party_user_id" uuid,
	"ip_address" "inet" NOT NULL,
	"user_agent" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" text,
	"outcome" text DEFAULT 'success' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"response_hash" text,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_memberships" ADD CONSTRAINT "academy_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_memberships" ADD CONSTRAINT "academy_memberships_academy_code_academy_code_fk" FOREIGN KEY ("academy_code") REFERENCES "public"."academy"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_memberships" ADD CONSTRAINT "academy_memberships_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child_links" ADD CONSTRAINT "parent_child_links_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child_links" ADD CONSTRAINT "parent_child_links_child_user_id_users_id_fk" FOREIGN KEY ("child_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child_links" ADD CONSTRAINT "parent_child_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_consenting_party_user_id_users_id_fk" FOREIGN KEY ("consenting_party_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ============================================================================
-- HAND-AUGMENTED BLOCKS (plan 01-02 task 3, RESEARCH §Two-role Postgres model)
-- ============================================================================

-- Block A: pgcrypto extension (used by Plan 03 medical schema for AES-256
-- column encryption via pgp_sym_encrypt).
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

-- Block B: Two Postgres roles (T-01-04, CRIT-7) — tamper-evidence for audit_log.
-- Passwords come from session-set GUCs so the migration file never carries
-- secrets. CI invokes drizzle-kit migrate with:
--   PGOPTIONS="-c app.app_user_pw=$APP_USER_PW -c app.app_audit_writer_pw=$APP_AUDIT_WRITER_PW"
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format('CREATE ROLE app_user LOGIN PASSWORD %L', current_setting('app.app_user_pw', true));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_audit_writer') THEN
    EXECUTE format('CREATE ROLE app_audit_writer LOGIN PASSWORD %L', current_setting('app.app_audit_writer_pw', true));
  END IF;
END $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user, app_audit_writer;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;--> statement-breakpoint
-- Sequence privileges: Postgres only accepts USAGE / SELECT / UPDATE on
-- sequences (INSERT/DELETE are table-only and raise 0LP01 when issued
-- against sequence objects). Granting all three sequence privileges keeps
-- app_user able to call currval, nextval, and setval on every public-schema
-- sequence — which matches the intent of the table-level grant on line 179.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_user;--> statement-breakpoint

-- audit_log: app_user has INSERT only (no UPDATE/DELETE — tamper-evidence).
-- The TD reads via a Plan-04 SECURITY DEFINER function, not directly.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;--> statement-breakpoint
GRANT INSERT ON audit_log TO app_user;--> statement-breakpoint
GRANT INSERT ON audit_log TO app_audit_writer;--> statement-breakpoint

-- consent_records: snapshot+sha256 is the legal record (D-04..07). UPDATE is
-- limited via Plan-04 RLS to the `withdrawn_at` column only; DELETE forbidden
-- here at the role layer regardless of RLS.
REVOKE DELETE ON consent_records FROM app_user;--> statement-breakpoint

-- Block C: set_updated_at() trigger function + trigger on users.
-- Plan 03 will add a similar trigger on medical_events; lookups,
-- consent_records, audit_log, and idempotency_keys are append-mostly
-- and don't need the trigger (consent UPDATE only flips withdrawn_at,
-- which is timestamped explicitly).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Block D: Performance indexes for RLS lookups (RESEARCH lines 1010-1020,
-- CRIT-8). Without these, every RLS predicate that joins parent_child_links
-- or academy_memberships does a Seq Scan; with them the planner picks Index
-- Scan. Verified by Plan 04 EXPLAIN test on 200-player corpus.
CREATE INDEX "idx_pcl_parent" ON "parent_child_links" ("parent_user_id");--> statement-breakpoint
CREATE INDEX "idx_pcl_child" ON "parent_child_links" ("child_user_id");--> statement-breakpoint
CREATE INDEX "idx_am_user_role" ON "academy_memberships" ("user_id", "role");--> statement-breakpoint
CREATE INDEX "idx_am_academy_role" ON "academy_memberships" ("academy_code", "role");--> statement-breakpoint
CREATE INDEX "idx_consent_user" ON "consent_records" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_log" ("actor_user_id", "occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_log" ("resource_type", "resource_id");
