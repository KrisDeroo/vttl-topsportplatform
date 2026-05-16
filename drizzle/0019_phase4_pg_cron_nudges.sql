-- 0019_phase4_pg_cron_nudges.sql
-- Phase 4 daily nudge jobs at 18:00 Europe/Brussels (D-67 ch2, D-72 ch2).
-- Supabase pg_cron is UTC-only; we schedule both 17:00 UTC (covers CET
-- winter 18:00) and 16:00 UTC (covers CEST summer 18:00), with a guard
-- in the function body that checks Europe/Brussels current hour and
-- exits if not 18:xx. See RESEARCH §Pitfall 2 dual-schedule.
--
-- The 2 nudge functions use plpgsql (NOT sql) so the body's reference to
-- `system_inbox` is resolved at call-time, not CREATE-FUNCTION-time. This
-- allows 0019 to apply before 0020 (which creates system_inbox), without
-- breaking — the first actual cron run is at 17:00 UTC at the earliest,
-- by which point 0020 has applied.
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-67 §D-72
--            .planning/phases/04-kerndomein/04-RESEARCH.md §Pitfall 2

CREATE EXTENSION IF NOT EXISTS pg_cron;--> statement-breakpoint

-- ─── Trainer score nudge function (D-67) ──────────────────────────
-- Walks training_sessions whose calendar_event.ends_at falls within the
-- last 14 days AND has at least one session_participants row with NULL
-- quality_score. Groups by trainer_id and emits one system_inbox row
-- per trainer with the pending count + maxDaysSinceEnd for tone escalation
-- in the client (day 7 / day 10 / day 12 escalation per D-67).

CREATE OR REPLACE FUNCTION run_daily_trainer_score_nudge()
RETURNS void AS $$
DECLARE
  brussels_hour text := (now() AT TIME ZONE 'Europe/Brussels')::time::text;
BEGIN
  -- Brussels DST guard — abort if not 18:xx local.
  IF brussels_hour NOT LIKE '18:%' THEN
    RAISE NOTICE 'run_daily_trainer_score_nudge: Brussels time is %, skipping (only runs at 18:xx local)', brussels_hour;
    RETURN;
  END IF;

  -- One inbox row per trainer with at least one pending score in the last 14d.
  -- payload includes pendingCount + maxDaysSinceEnd for client-side tone
  -- escalation copy in the daily message.
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
  GROUP BY ts.trainer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION run_daily_trainer_score_nudge() FROM PUBLIC;--> statement-breakpoint
-- Only cron's executor needs EXECUTE; no GRANT to app_user (app shouldn't
-- trigger this directly).

-- ─── Player tournament-result nudge function (D-72) ───────────────
-- Walks calendar_events that are tournaments (JOIN tournaments) ending in
-- the last 14d, finds calendar_event_participants who have NO matching
-- tournament_results row, groups by player. Emits one inbox row per
-- player with the pending tournament count.

CREATE OR REPLACE FUNCTION run_daily_player_tournament_result_nudge()
RETURNS void AS $$
DECLARE
  brussels_hour text := (now() AT TIME ZONE 'Europe/Brussels')::time::text;
BEGIN
  IF brussels_hour NOT LIKE '18:%' THEN
    RAISE NOTICE 'run_daily_player_tournament_result_nudge: Brussels time is %, skipping', brussels_hour;
    RETURN;
  END IF;

  -- One inbox row per player with at least one pending tournament result in the last 14d.
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
    AND tr.tournament_event_id IS NULL  -- no result row yet
  GROUP BY cep.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION run_daily_player_tournament_result_nudge() FROM PUBLIC;--> statement-breakpoint

-- ─── Schedule dual-time jobs (DST safe) ───────────────────────────
-- 17:00 UTC = 18:00 CET (winter) ; 16:00 UTC = 18:00 CEST (summer).
-- Function body's Brussels-hour guard ensures only the correct half-year fires.
-- IF NOT EXISTS guard via WHERE NOT IN — cron.schedule itself throws on
-- duplicate jobname; the unschedule-then-schedule pattern is the idiomatic
-- way to make this migration idempotent on re-apply.

-- Trainer score nudges
SELECT cron.unschedule('daily_trainer_score_nudge_17utc')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_trainer_score_nudge_17utc');--> statement-breakpoint
SELECT cron.schedule(
  'daily_trainer_score_nudge_17utc',
  '0 17 * * *',
  $cron$SELECT run_daily_trainer_score_nudge();$cron$
);--> statement-breakpoint

SELECT cron.unschedule('daily_trainer_score_nudge_16utc')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_trainer_score_nudge_16utc');--> statement-breakpoint
SELECT cron.schedule(
  'daily_trainer_score_nudge_16utc',
  '0 16 * * *',
  $cron$SELECT run_daily_trainer_score_nudge();$cron$
);--> statement-breakpoint

-- Player tournament-result nudges
SELECT cron.unschedule('daily_player_tournament_result_nudge_17utc')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_player_tournament_result_nudge_17utc');--> statement-breakpoint
SELECT cron.schedule(
  'daily_player_tournament_result_nudge_17utc',
  '0 17 * * *',
  $cron$SELECT run_daily_player_tournament_result_nudge();$cron$
);--> statement-breakpoint

SELECT cron.unschedule('daily_player_tournament_result_nudge_16utc')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_player_tournament_result_nudge_16utc');--> statement-breakpoint
SELECT cron.schedule(
  'daily_player_tournament_result_nudge_16utc',
  '0 16 * * *',
  $cron$SELECT run_daily_player_tournament_result_nudge();$cron$
);
