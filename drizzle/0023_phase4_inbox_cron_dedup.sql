-- 0023_phase4_inbox_cron_dedup.sql
-- Phase 4 CR-07 fix (VERIFICATION.md gaps[6]).
--
-- CREATE OR REPLACE the two SECURITY DEFINER cron functions from 0019 to
-- append ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING on
-- the INSERT. Combined with the partial unique index from 0022, this makes
-- the daily cron tick idempotent — a trainer with one unscored session
-- gets ONE row, not 14.
--
-- Both functions retain the Brussels-DST guard from 0019 + SECURITY DEFINER
-- + SET search_path. Only the INSERT statement changes.
--
-- Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[6]
--            .planning/phases/04-kerndomein/04-REVIEW.md §CR-07

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
  SELECT
    ts.trainer_id AS user_id,
    'trainer_score_nudge' AS kind,
    jsonb_build_object(
      'pendingCount', COUNT(*),
      'maxDaysSinceEnd', MAX(EXTRACT(EPOCH FROM (now() - ce.ends_at)) / 86400)::int,
      'generatedAt', now()
    ) AS payload
  FROM training_sessions ts
  JOIN calendar_events ce ON ce.id = ts.event_id
  JOIN session_participants sp ON sp.event_id = ts.event_id
   AND sp.quality_score IS NULL
  WHERE ce.ends_at < now()
    AND ce.ends_at >= now() - INTERVAL '14 days'
  GROUP BY ts.trainer_id
  ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION run_daily_trainer_score_nudge() FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION run_daily_player_tournament_result_nudge()
RETURNS void AS $$
DECLARE
  brussels_hour text := (now() AT TIME ZONE 'Europe/Brussels')::time::text;
BEGIN
  IF brussels_hour NOT LIKE '18:%' THEN
    RAISE NOTICE 'run_daily_player_tournament_result_nudge: Brussels time is %, skipping', brussels_hour;
    RETURN;
  END IF;

  INSERT INTO system_inbox (user_id, kind, payload)
  SELECT
    cep.user_id AS user_id,
    'player_result_nudge' AS kind,
    jsonb_build_object(
      'pendingCount', COUNT(*),
      'maxDaysSinceEnd', MAX(EXTRACT(EPOCH FROM (now() - ce.ends_at)) / 86400)::int,
      'generatedAt', now()
    ) AS payload
  FROM calendar_events ce
  JOIN tournaments t ON t.event_id = ce.id
  JOIN calendar_event_participants cep ON cep.event_id = ce.id
  LEFT JOIN tournament_results tr
    ON tr.tournament_event_id = ce.id
   AND tr.player_user_id = cep.user_id
  WHERE ce.ends_at < now()
    AND ce.ends_at >= now() - INTERVAL '14 days'
    AND tr.tournament_event_id IS NULL
  GROUP BY cep.user_id
  ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION run_daily_player_tournament_result_nudge() FROM PUBLIC;
