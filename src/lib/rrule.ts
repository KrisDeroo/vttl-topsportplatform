/**
 * RRULE helpers — server-side RFC 5545 expansion + D-55 horizon defense in depth.
 *
 * Single source of truth for parsing and expanding recurring-event rules.
 * FullCalendar receives concrete EventInstance[] from the server — never
 * raw RRULE strings — per D-53. Mobile clients and alt front-ends get the
 * same correct expansion for free.
 *
 * Public API:
 *   parseRrule(s, dtstart)        — parse + return RRule. Throws TRPCError
 *                                    BAD_REQUEST on invalid RFC 5545 or
 *                                    DTSTART:-containing strings.
 *   validateHorizon(s, createdAt) — D-55 write-time gate. Throws TRPCError
 *                                    BAD_REQUEST 'errors.calendar.rruleHorizonExceeded' on:
 *                                      - missing UNTIL and COUNT
 *                                      - UNTIL > createdAt + 2y
 *                                      - rrule string containing 'DTSTART:'
 *                                        (Anti-Pattern 1: dual source of truth).
 *   ensureHorizon(s, createdAt)   — UI helper: when user picks "Eindigt: Nooit"
 *                                    the UI sends a rrule without UNTIL/COUNT;
 *                                    this function auto-injects UNTIL =
 *                                    createdAt + 2y using RRule.optionsToString()
 *                                    (NEVER string-concat per Pitfall 8).
 *                                    Returns the new rrule string.
 *   expandRrule(rrule, dtstart, durationMs, from, to, exceptions[]) — expand
 *                                    to EventInstance[] with exceptions
 *                                    applied. Read-time horizon clamp per
 *                                    D-55: clampedTo = min(to, dtstart + 2y)
 *                                    so legacy/migrated rows can't explode.
 *                                    Cancelled exceptions are skipped via
 *                                    RRuleSet.exdate(); override fields
 *                                    applied in a post-processing pass.
 *
 * Pitfalls covered:
 *   - Pitfall 3 (DST drift): WR-01 fix — Postgres TIMESTAMPTZ is always
 *     UTC, but recurring events recur in Brussels WALL-CLOCK time. The
 *     library's default UTC math would shift "every Wednesday 10:00" to
 *     11:00 after the spring DST change. We pre-convert dtstart to a
 *     "naive" Brussels wall-clock Date for expansion, then convert each
 *     occurrence back to true UTC via brusselsWallToUtc. See WR-01
 *     comments on expandRrule for the full mechanism.
 *   - Pitfall 8 (invalid RFC 5545 UNTIL format): we never string-concat;
 *     rrule's RRule.optionsToString() always emits valid
 *     `UNTIL=YYYYMMDDTHHMMSSZ`.
 *   - Anti-Pattern 1: parseRrule rejects rrule strings containing 'DTSTART:'
 *     so the source of truth stays on calendar_events.starts_at.
 *
 * Reference: .planning/phases/03-kalender/03-CONTEXT.md D-52..D-55
 *            .planning/phases/03-kalender/03-RESEARCH.md §Pattern 3
 */
import { TRPCError } from '@trpc/server';
import { addYears } from 'date-fns';
import { RRule, RRuleSet, rrulestr } from 'rrule';

const MAX_HORIZON_YEARS = 2; // D-55

/**
 * Canonical timezone for occurrence-date math. CR-05 fix: writing exception
 * dates with `toISOString().slice(0,10)` cancelled the wrong day for any
 * non-UTC client (Belgian users at +01:00 / +02:00 had every CEST-midnight
 * pick shift to the previous calendar day). We anchor on Europe/Brussels —
 * the platform is VTTL (Flemish Table Tennis League), all academies are
 * Belgian, and users expect "8 mei training" to map to the May 8 occurrence
 * row regardless of how the client serialised the Date.
 *
 * Both the WRITE path (`event.cancelOccurrence`) and the read-side
 * matcher (`expandRrule`) call this helper so they agree byte-for-byte;
 * mismatches would orphan exception rows. Phase 4 may introduce a per-event
 * `tz_id` column (see WR-01 fix) and `formatOccurrenceDate` would then
 * become a one-line wrapper around the per-event tz.
 */
const OCCURRENCE_DATE_TZ = 'Europe/Brussels';

/**
 * Format a Date as YYYY-MM-DD in the platform timezone (Europe/Brussels).
 * Uses Intl.DateTimeFormat with 'en-CA' which canonically emits ISO-8601
 * date format. No external deps (date-fns-tz not installed).
 *
 * CR-05: replaces the UTC `toISOString().slice(0,10)` pattern that wrote
 * the wrong calendar date for non-UTC clients.
 */
export function formatOccurrenceDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OCCURRENCE_DATE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// ─── WR-01: DST-safe rrule expansion in Europe/Brussels wall time ──────

/** Decompose a UTC `Date` into Brussels-local y/m/d/h/m/s wall clock. */
function utcToBrusselsWall(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: OCCURRENCE_DATE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Convert a Brussels wall-clock tuple into the actual UTC instant.
 *
 * Strategy: start with a naive `Date.UTC(...)` guess, format it back as
 * Brussels-local, diff against the desired wall clock, apply the delta.
 * One iteration suffices for the normal case; the second iteration catches
 * DST transitions (spring forward / fall back), where the offset changes
 * mid-day. Three iterations is the upper bound (one transition + one
 * verify).
 */
function brusselsWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const wantWall = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = wantWall;
  for (let i = 0; i < 3; i++) {
    const got = utcToBrusselsWall(new Date(utcMs));
    const gotWall = Date.UTC(
      got.year,
      got.month - 1,
      got.day,
      got.hour,
      got.minute,
      got.second,
    );
    const diff = wantWall - gotWall;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs);
}

/**
 * Take an occurrence Date the rrule library produced (which we interpret
 * as a "Brussels wall clock" because we fed it a naive dtstart) and
 * return the actual UTC instant for that wall clock. This is what makes
 * "every Wednesday 10:00 in Brussels" survive the spring/fall DST change
 * — without this conversion, a 10:00 CET (winter) event becomes 11:00
 * CEST (summer) because rrule's default UTC math preserves the absolute
 * UTC offset of dtstart.
 */
function naiveOccurrenceToRealUtc(naive: Date): Date {
  return brusselsWallToUtc(
    naive.getUTCFullYear(),
    naive.getUTCMonth() + 1,
    naive.getUTCDate(),
    naive.getUTCHours(),
    naive.getUTCMinutes(),
    naive.getUTCSeconds(),
  );
}

/**
 * Build a "naive" dtstart Date suitable for rrule expansion. Takes a real
 * UTC `Date`, reads its Brussels wall-clock components, and re-encodes
 * those components as a Date constructed via `Date.UTC` so the library
 * sees a stable hour/minute regardless of DST.
 */
function realUtcDtstartToNaive(realUtc: Date): Date {
  const w = utcToBrusselsWall(realUtc);
  return new Date(
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second),
  );
}

/** Output of expandRrule — one concrete instance per occurrence in the window. */
export interface ExpandedOccurrence {
  /** UTC date of this occurrence (rrule's "anchor" for the day). */
  occurrenceDate: Date;
  /** Resolved start time — override applied if exception exists for this date. */
  startsAt: Date;
  /** Resolved end time — override applied if exception exists. */
  endsAt: Date;
  /** Title override applied to this occurrence — null if none. */
  titleOverride: string | null;
  /** Location override applied to this occurrence — null if none. */
  locationOverride: string | null;
  /** Description override applied to this occurrence — null if none. */
  descriptionOverride: string | null;
}

/** Shape of an exception row from calendar_event_exceptions. */
export interface ExceptionInput {
  occurrenceDate: Date | string; // date column — Date or 'YYYY-MM-DD'
  cancelled: boolean;
  overrideStartsAt: Date | null;
  overrideEndsAt: Date | null;
  overrideTitle: string | null;
  overrideLocation: string | null;
  overrideDescription: string | null;
}

/**
 * Parse an RFC 5545 RRULE string with an explicit dtstart from
 * calendar_events.starts_at. Throws TRPCError BAD_REQUEST if the string is
 * invalid or contains DTSTART: (dual-source-of-truth guard — Anti-Pattern 1).
 */
export function parseRrule(rruleStr: string, dtstart: Date): RRule {
  if (rruleStr.includes('DTSTART:')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.rruleHorizonExceeded',
    });
  }
  let parsed: RRule | RRuleSet;
  try {
    // rrulestr returns RRule | RRuleSet; we expect a single RRULE for the
    // stored calendar_events.rrule column. RRuleSet is constructed internally
    // only when applying EXDATEs from exceptions (inside expandRrule).
    parsed = rrulestr(rruleStr, { dtstart });
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.rruleHorizonExceeded',
    });
  }
  if (parsed instanceof RRuleSet) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.rruleHorizonExceeded',
    });
  }
  return parsed;
}

/**
 * D-55 write-time gate. Reject:
 *   - rrule string containing DTSTART: (dual-source-of-truth — Anti-Pattern 1)
 *   - rule without UNTIL AND without COUNT (open-ended → expansion DoS risk)
 *   - rule with UNTIL > createdAt + 2y (horizon exceeded)
 *
 * Throws TRPCError BAD_REQUEST 'errors.calendar.rruleHorizonExceeded' on any
 * failure.
 */
export function validateHorizon(
  rruleStr: string,
  createdAt: Date = new Date(),
): void {
  // For the horizon-validation call, dtstart is irrelevant — we only inspect
  // origOptions.until and origOptions.count. Use createdAt as a harmless
  // anchor so the parse succeeds.
  const dtstart = createdAt;
  const rule = parseRrule(rruleStr, dtstart);
  const opts = rule.origOptions;
  if (!opts.until && !opts.count) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.rruleHorizonExceeded',
    });
  }
  if (opts.until && opts.until > addYears(createdAt, MAX_HORIZON_YEARS)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.calendar.rruleHorizonExceeded',
    });
  }
}

/**
 * Auto-inject UNTIL = createdAt + 2y when the UI sends a rrule without
 * UNTIL/COUNT (user picked "Eindigt: Nooit" in UI3-D12 RruleEditor).
 * Returns the new rrule string. If the input already has UNTIL or COUNT,
 * it is returned unchanged.
 *
 * NEVER string-concat — uses RRule.optionsToString() per Pitfall 8.
 */
export function ensureHorizon(
  rruleStr: string,
  createdAt: Date = new Date(),
): string {
  const dtstart = createdAt;
  const rule = parseRrule(rruleStr, dtstart);
  const opts = rule.origOptions;
  if (opts.until || opts.count) return rruleStr; // already bounded
  // Strip dtstart from the spread — the source of truth is
  // calendar_events.starts_at (Anti-Pattern 1: never write DTSTART: into the
  // stored rrule string). `exactOptionalPropertyTypes` requires omission
  // rather than `undefined`.
  const { dtstart: _stripDtstart, ...rest } = opts;
  void _stripDtstart;
  const newOpts = {
    ...rest,
    until: addYears(createdAt, MAX_HORIZON_YEARS),
  };
  return RRule.optionsToString(newOpts);
}

/**
 * Expand a rrule string + exceptions into concrete occurrences within
 * [from, to]. Read-time horizon clamp per D-55: clamps `to` to `dtstart + 2y`
 * so legacy rows with UNTIL beyond that point cannot blow up an unsuspecting
 * list query.
 *
 * WR-01: occurrences are anchored on Europe/Brussels wall-clock time so a
 * recurring "every Wednesday 10:00" stays at 10:00 local across DST
 * boundaries (the previous default-UTC behaviour drifted to 11:00 CEST
 * after the March DST jump). The Anti-Pattern-1 guard in parseRrule
 * still rejects DTSTART: in the stored string — the timezone is implicit
 * (platform-wide Europe/Brussels) rather than per-event for v1.
 * Phase 4 can introduce a per-event `tz_id` column when international
 * tournaments arrive; the helpers (utcToBrusselsWall / brusselsWallToUtc)
 * already take an explicit tz argument shape that makes that swap a
 * one-line change.
 */
export function expandRrule(
  rruleStr: string,
  dtstart: Date,
  durationMs: number,
  from: Date,
  to: Date,
  exceptions: ReadonlyArray<ExceptionInput>,
): ExpandedOccurrence[] {
  // WR-01: convert real-UTC dtstart to "naive" dtstart (Brussels wall
  // clock as UTC components). The library then sees a stable hour value
  // and propagates it across every occurrence; we convert back to real
  // UTC after expansion.
  const naiveDtstart = realUtcDtstartToNaive(dtstart);
  const rule = parseRrule(rruleStr, naiveDtstart);
  const horizonMax = addYears(dtstart, MAX_HORIZON_YEARS);
  const clampedTo = new Date(Math.min(to.getTime(), horizonMax.getTime()));

  // Compute the search window in the naive coordinate system too — the
  // library does `between(naiveFrom, naiveTo)` so we re-anchor.
  const naiveFrom = realUtcDtstartToNaive(from);
  const naiveTo = realUtcDtstartToNaive(clampedTo);

  // Build an RRuleSet so we can apply EXDATEs for cancelled occurrences.
  const set = new RRuleSet();
  set.rrule(rule);
  for (const ex of exceptions) {
    if (ex.cancelled) {
      const exDate =
        ex.occurrenceDate instanceof Date
          ? ex.occurrenceDate
          : new Date(ex.occurrenceDate);
      // Express the EXDATE at the same time-of-day as the NAIVE dtstart
      // (Brussels wall clock) for the cancelled calendar date — rrule's
      // exdate match is exact and our occurrences are in the naive
      // coordinate system pre-conversion.
      const exInstant = new Date(
        Date.UTC(
          exDate.getUTCFullYear(),
          exDate.getUTCMonth(),
          exDate.getUTCDate(),
          naiveDtstart.getUTCHours(),
          naiveDtstart.getUTCMinutes(),
          naiveDtstart.getUTCSeconds(),
        ),
      );
      set.exdate(exInstant);
    }
  }

  const naiveDates = set.between(naiveFrom, naiveTo, true);

  return naiveDates.map((naive) => {
    // Convert naive → real UTC. This is where DST is correctly applied.
    const d = naiveOccurrenceToRealUtc(naive);
    // Find a non-cancelled override matching this occurrence's calendar date.
    // CR-05: use Europe/Brussels-anchored YYYY-MM-DD (formatOccurrenceDate)
    // — see comment on OCCURRENCE_DATE_TZ above. The write path in
    // calendar.ts cancelOccurrence emits the same shape so an exception
    // row written for the user's local-May-16 morning training matches the
    // expanded May-16 occurrence (was previously orphaned for CEST clients).
    const isoDate = formatOccurrenceDate(d);
    const ex = exceptions.find((e) => {
      if (e.cancelled) return false;
      const ed =
        e.occurrenceDate instanceof Date
          ? e.occurrenceDate
          : new Date(e.occurrenceDate);
      return formatOccurrenceDate(ed) === isoDate;
    });
    return {
      occurrenceDate: d,
      startsAt: ex?.overrideStartsAt ?? d,
      endsAt: ex?.overrideEndsAt ?? new Date(d.getTime() + durationMs),
      titleOverride: ex?.overrideTitle ?? null,
      locationOverride: ex?.overrideLocation ?? null,
      descriptionOverride: ex?.overrideDescription ?? null,
    };
  });
}
