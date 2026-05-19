/**
 * Player domain helpers — age-category derivation and historical lookup.
 *
 * `deriveAgeCategory(dob, asOfDate)`:
 *   Computes which age-category code matches a player's calendar birth year
 *   on `asOfDate` (default `new Date()`). Logic:
 *     1. Read all rows from `age_categories` WHERE active = true, ordered
 *        by sort_order ASC so a deterministic first-match wins.
 *     2. Compute the player's calendar birth year (UTC) and the category
 *        year (UTC year component of asOfDate).
 *     3. Pick the first row whose [bornAfterOrEqual, bornBeforeOrEqual]
 *        range contains the birth year (NULL endpoints = open-ended).
 *     4. If no row matches, return code 'age_unknown' (seeded with
 *        sort_order=99 in plan 02-08; it is therefore evaluated last and
 *        only chosen when no real category fits).
 *
 *   `categoryYear` returned is the YEAR component of `asOfDate` — convention
 *   chosen to match how toernooi-validatie (Phase 4) treats "category for
 *   season N" as "category as of season N's start year" (RESEARCH §A2).
 *
 * `getAgeCategoryAt(playerId, date)`:
 *   Reads from `age_category_history` the row whose
 *   `effective_from <= date AND (effective_to IS NULL OR effective_to >= date)`.
 *   Returns `null` if no row covers the date (e.g., before player was
 *   created). Uses the composite index `idx_age_history_lookup` on
 *   `(player_id, effective_from DESC, effective_to)` for an index-only scan
 *   (Pattern 2 in 02-RESEARCH).
 *
 * Both helpers run under the RLS-bound db client; RLS filters
 * `age_category_history` to rows the caller can see (player owner + TD +
 * scope-trainer per 02-05 policies). Tests can pass a custom `dbHandle`
 * bound to a test transaction.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-31, D-33
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 2
 */
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';

import { db, type DbClient } from '@/server/db/client';
import { ageCategories } from '@/server/db/schema/lookups';
import { ageCategoryHistory } from '@/server/db/schema/players';

import { formatOccurrenceDate } from './rrule';

export interface AgeCategoryResult {
  code: string;
  year: number;
}

/**
 * Derive the age-category code for a given DOB as of `asOfDate`.
 *
 * Returns `'age_unknown'` when no seeded boundary row matches — this is
 * the documented fallback while TD-confirmed boundaries are pending
 * (RESEARCH §Open Questions point 4 / A2 mitigation). The `age_unknown`
 * code is seeded with sort_order=99 so it is evaluated last; deterministic
 * ASC ordering on `sort_order` prevents Postgres from returning rows in
 * arbitrary order and accidentally picking `age_unknown` first.
 */
export async function deriveAgeCategory(
  dob: Date,
  asOfDate: Date = new Date(),
  dbHandle: DbClient = db,
): Promise<AgeCategoryResult> {
  const birthYear = dob.getUTCFullYear();
  const categoryYear = asOfDate.getUTCFullYear();

  const rows = await dbHandle.query.ageCategories.findMany({
    where: eq(ageCategories.active, true),
    orderBy: (t, { asc }) => [asc(t.sortOrder)],
  });

  for (const row of rows) {
    const lowerOk =
      row.bornAfterOrEqual === null || birthYear >= row.bornAfterOrEqual;
    const upperOk =
      row.bornBeforeOrEqual === null || birthYear <= row.bornBeforeOrEqual;
    if (lowerOk && upperOk) {
      return { code: row.code, year: categoryYear };
    }
  }

  return { code: 'age_unknown', year: categoryYear };
}

/**
 * Look up the age category that was in effect for `playerId` on `date`.
 *
 * Phase 4 toernooi-validatie will call this with `tournament.start_date`.
 * Returns `null` if no history row covers the date (e.g., date precedes
 * the player's first age-category-history row).
 *
 * `effective_from` / `effective_to` are PostgreSQL DATE columns; the
 * YYYY-MM-DD string is the canonical wire format and Drizzle 0.45 binds
 * string operands for `date` columns natively (driver coerces). Avoids
 * the `as unknown as string` double-cast workaround that nudges
 * executors toward `any`.
 */
export async function getAgeCategoryAt(
  playerId: string,
  date: Date,
  dbHandle: DbClient = db,
): Promise<AgeCategoryResult | null> {
  // CR-09: Brussels-anchored YYYY-MM-DD via formatOccurrenceDate.
  // The previous `date.toISOString().slice(0, 10)` returned the UTC day,
  // which drifted one day for evening events in Brussels (a tournament
  // starting 2026-01-01 02:00 Brussels = 2025-12-31 23:00 UTC would have
  // queried age_category_history at '2025-12-31', picking up the 2025 row
  // instead of the 2026 row). DOM-CAT-02 snapshot now resolves the
  // calendar day on the canonical platform timezone.
  const dateIso = formatOccurrenceDate(date); // Brussels-anchored YYYY-MM-DD

  const row = await dbHandle.query.ageCategoryHistory.findFirst({
    where: and(
      eq(ageCategoryHistory.playerId, playerId),
      lte(ageCategoryHistory.effectiveFrom, dateIso),
      or(
        isNull(ageCategoryHistory.effectiveTo),
        gte(ageCategoryHistory.effectiveTo, dateIso),
      ),
    ),
    orderBy: (t, { desc }) => [desc(t.effectiveFrom)],
  });

  if (!row) return null;
  return { code: row.ageCategoryCode, year: row.categoryYear };
}
