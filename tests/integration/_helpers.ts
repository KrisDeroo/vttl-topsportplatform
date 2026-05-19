/**
 * Phase 4 gap-closure integration test plumbing.
 *
 * Single source of truth for the canConnect + freshDb + rawPgAsAppUser
 * trio used across the gap-closure batch (Plans 04-10 .. 04-16). Removes
 * the 11-line inline canConnect duplication that would otherwise land in
 * 6 test files.
 *
 * Pre-existing tests/integration/rbac-matrix-phase4.test.ts defined
 * canConnect inline (lines 34-44); the implementation here is identical.
 * Gap-closure tests import via `from './_helpers'` and the rbac-matrix
 * file keeps its inline copy (no breaking-change refactor).
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[0..8]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-01..09
 */
import { freshDb, rawPgAsAppUser } from '../helpers/db';

export { freshDb, rawPgAsAppUser };

/**
 * canConnect — returns true if a real Postgres DB is reachable via
 * DATABASE_URL and is not a stub-URL marker. Used by every gap-closure
 * test to skip-gate cleanly when no testcontainer is available. The
 * implementation roundtrips through `freshDb()` to verify both the URL
 * is parseable AND the truncate path executes.
 *
 * Verbatim copy of tests/integration/rbac-matrix-phase4.test.ts:34-44.
 */
export async function canConnect(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('stub')) return false;
  try {
    const h = await freshDb();
    await h[Symbol.asyncDispose]();
    return true;
  } catch {
    return false;
  }
}
