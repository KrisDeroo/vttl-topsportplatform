-- Migration 0013_phase3_calendar_function_fixes.sql — Phase 3 corrective.
--
-- Fixes CR-01 from 03-REVIEW.md: the SECURITY DEFINER function declared in
-- 0011 used 3 scalar arguments (UUID[], TIMESTAMPTZ, TIMESTAMPTZ), but every
-- router call site in src/server/trpc/routers/calendar.ts invokes it with a
-- (UUID[], TSTZRANGE[]) signature. The mismatch made PostgreSQL throw
-- `function overlapping_events_for_users(uuid[], tstzrange[]) does not exist`
-- on every conflict probe — `event.detectConflicts`, `event.create` with
-- participants, and `event.update` with participants all errored out.
--
-- Forward-only correction (0011 is already applied to the dev DB):
--   1. DROP the old (UUID[], TIMESTAMPTZ, TIMESTAMPTZ) function declaration.
--   2. CREATE the new (UUID[], TSTZRANGE[]) function with identical body
--      semantics — but the second argument is now a range ARRAY, so the
--      overlap predicate iterates the windows. This matches the router and
--      enables future per-occurrence ±15d window expansion (D-56) without
--      another migration.
--   3. Re-apply REVOKE / GRANT (the new signature is a NEW function object;
--      it does not inherit ACLs from the dropped one).
--
-- Why preserve the SECURITY DEFINER + STABLE + search_path lock: same
-- rationale as 0011 — cross-scope conflict detection MUST bypass RLS per
-- D-57, and the service layer (src/lib/calendar/conflicts.ts) is the
-- redaction gate. SET search_path = pg_catalog, public defends against
-- schema-search-path injection.
--
-- IMPORTANT: this migration drops a function visible to app_user. Any
-- in-flight router call between DROP and CREATE will fail with
-- "function does not exist". The window is microseconds and the function
-- was already broken (CR-01); no realistic regression risk.
--
-- Reference: .planning/phases/03-kalender/03-REVIEW.md CR-01
--            drizzle/0011_phase3_calendar_rls_policies.sql §Section 3

-- Drop the broken (3-scalar-arg) signature created in 0011 — explicit
-- signature is required because we do not want to drop any other
-- overload by accident.
DROP FUNCTION IF EXISTS overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ);--> statement-breakpoint

-- Re-create with the (UUID[], TSTZRANGE[]) signature that the router
-- already uses. Body semantics are identical to 0011 except we OR-merge
-- across the supplied window array via `ANY()` so a single call can
-- probe multiple disjoint windows in one shot (paves the way for D-56
-- ±15d per-occurrence expansion).
CREATE OR REPLACE FUNCTION overlapping_events_for_users(
  p_user_ids UUID[],
  p_windows TSTZRANGE[]
)
RETURNS TABLE(
  event_id UUID,
  user_id UUID,
  type_code TEXT,
  title TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  location TEXT,
  created_by UUID
) AS $$
  SELECT ce.id AS event_id,
         cep.user_id,
         ce.type_code,
         ce.title,
         ce.starts_at,
         ce.ends_at,
         ce.location,
         ce.created_by
    FROM calendar_events ce
    JOIN calendar_event_participants cep ON cep.event_id = ce.id
   WHERE cep.user_id = ANY(p_user_ids)
     AND EXISTS (
       SELECT 1
         FROM unnest(p_windows) AS w(range)
        WHERE tstzrange(ce.starts_at, ce.ends_at, '[)') && w.range
     )
   ORDER BY ce.starts_at;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION overlapping_events_for_users(UUID[], TSTZRANGE[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION overlapping_events_for_users(UUID[], TSTZRANGE[]) TO app_user;
