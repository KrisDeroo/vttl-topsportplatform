-- Migration 0003_users_is_minor.sql — Phase 1 Wave 6, Plan 12.
-- GDPR-02 minor-consent enforcement: add `is_minor` STORED generated column
-- to `users` so the `canActivate(userId)` guard in
-- `src/server/auth/activate.ts` can rely on a Postgres-computed truth value
-- (rather than recomputing age in TypeScript on every check, which drifts
-- across timezone boundaries on the day of a user's 16th birthday).
--
-- Hand-authored. The agent worktree cannot run `npx drizzle-kit generate`
-- against a live Postgres instance; Plan 16 reconciles via
-- `drizzle-kit introspect` once node_modules is available against staging,
-- same pattern as 0000_initial.sql / 0001_medical_isolated.sql.
--
-- Rules:
--   * NULL when `date_of_birth IS NULL` — staff/TD users without DOB are
--     neither minor nor non-minor; the activation guard treats NULL as
--     "not a minor" because no parent consent is required for a user with
--     no DOB on file.
--   * TRUE when `(CURRENT_DATE - date_of_birth) < INTERVAL '16 years'`.
--   * FALSE otherwise.
--
-- The Belgian Art. 8 threshold is 13 (digital service provider consent
-- per Belgian implementation of GDPR Art. 8(1) — Wet 30 juli 2018), but
-- VTTL-specific policy (PROJECT.md + RESEARCH.md §Belgian minor-consent
-- enforcement) sets 16 as the platform threshold to align with Belgian
-- youth-sport oversight and the Patient Rights Act expectations on minors
-- in elite-sport medical follow-up. The threshold is centralised here as
-- the SQL `INTERVAL '16 years'` literal — changing the policy means a new
-- migration (0004), never an in-place edit (MIG-01).

ALTER TABLE "users"
  ADD COLUMN "is_minor" boolean
  GENERATED ALWAYS AS (
    CASE
      WHEN date_of_birth IS NULL THEN NULL
      WHEN (CURRENT_DATE - date_of_birth) < INTERVAL '16 years' THEN TRUE
      ELSE FALSE
    END
  ) STORED;
