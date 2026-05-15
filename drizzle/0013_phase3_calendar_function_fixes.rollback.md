# Rollback — 0013_phase3_calendar_function_fixes

**Risk:** Medium. Rolling back this migration restores the broken
3-scalar-argument signature for `overlapping_events_for_users`, which means
EVERY conflict probe in the calendar router throws
`function overlapping_events_for_users(uuid[], tstzrange[]) does not exist`
at runtime. The application code in `src/server/trpc/routers/calendar.ts`
(see CR-01 fix commit) assumes the (UUID[], TSTZRANGE[]) signature; a
rollback without simultaneously reverting that router fix renders
`event.detectConflicts`, `event.create` with participants, and `event.update`
with participants non-functional. Rolling forward (re-applying 0013) is the
preferred recovery; this rollback is for break-glass scenarios only.

**Procedure:**

1. Confirm the application has been redeployed with the matching pre-CR-01
   router code (which called the 3-scalar-arg signature) OR the application
   is being intentionally taken offline.
2. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- Drop the corrected (UUID[], TSTZRANGE[]) signature introduced in 0013.
   DROP FUNCTION IF EXISTS overlapping_events_for_users(UUID[], TSTZRANGE[]);

   -- Re-create the original (broken) 3-scalar-arg signature from 0011 so
   -- the database state matches the pre-0013 snapshot. Identical body to
   -- 0011 § Section 3.
   CREATE OR REPLACE FUNCTION overlapping_events_for_users(
     p_user_ids UUID[],
     p_from TIMESTAMPTZ,
     p_to TIMESTAMPTZ
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
        AND tstzrange(ce.starts_at, ce.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
      ORDER BY ce.starts_at;
   $$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

   REVOKE ALL ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;

   COMMIT;
   ```

**Verification:**

1. `SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'overlapping_events_for_users';`
   returns one row with arguments `p_user_ids uuid[], p_from timestamp with time zone, p_to timestamp with time zone`.
2. Calling the router from the application throws the documented
   `function overlapping_events_for_users(uuid[], tstzrange[]) does not exist`
   error (this is the expected pre-CR-01 behaviour).
