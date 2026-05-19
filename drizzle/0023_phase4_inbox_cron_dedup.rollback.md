# Rollback: 0023_phase4_inbox_cron_dedup.sql

**Risk:** LOW (in isolation) / MEDIUM (combined with 0022). Reverting restores
pre-CR-07 stacking. If 0022 also rolled back, the ON CONFLICT clause
dangles — they MUST roll back together.

**Procedure:**

Re-apply 0019's original function bodies (CREATE OR REPLACE without
ON CONFLICT). The cleanest path is to copy the exact function bodies
from drizzle/0019_phase4_pg_cron_nudges.sql lines 26-102 (skip the
EXTENSION + cron.schedule statements — they remain valid).

```sql
-- Sketch (use 0019 as source of truth):
CREATE OR REPLACE FUNCTION run_daily_trainer_score_nudge()
RETURNS void AS $$
DECLARE
  brussels_hour text := (now() AT TIME ZONE 'Europe/Brussels')::time::text;
BEGIN
  IF brussels_hour NOT LIKE '18:%' THEN
    RAISE NOTICE 'run_daily_trainer_score_nudge: Brussels time is %, skipping', brussels_hour;
    RETURN;
  END IF;
  INSERT INTO system_inbox (user_id, kind, payload)
  SELECT ts.trainer_id, 'trainer_score_nudge',
         jsonb_build_object('pendingCount', COUNT(*), 'maxDaysSinceEnd',
                            MAX(EXTRACT(EPOCH FROM (now() - ce.ends_at)) / 86400)::int,
                            'generatedAt', now())
    FROM training_sessions ts
    JOIN calendar_events ce ON ce.id = ts.event_id
    JOIN session_participants sp ON sp.event_id = ts.event_id AND sp.quality_score IS NULL
   WHERE ce.ends_at < now() AND ce.ends_at >= now() - INTERVAL '14 days'
   GROUP BY ts.trainer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- Same shape for run_daily_player_tournament_result_nudge (see 0019).
```

**Verification:**

- `pg_get_functiondef('run_daily_trainer_score_nudge'::regproc)` does NOT
  contain `ON CONFLICT`.
- Running the function twice in the same Brussels day deposits 2 rows.
- `pnpm test tests/integration/system-inbox-daily-dedup.test.ts --run`
  assertion fails (expected post-rollback).

**Reference:**

- .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[6]
- .planning/phases/04-kerndomein/04-REVIEW.md §CR-07
- drizzle/0019_phase4_pg_cron_nudges.sql (original function bodies)
