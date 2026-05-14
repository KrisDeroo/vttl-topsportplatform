/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * USER-04 RLS direct DB query — `calendar_events`. The Drizzle client runs as
 * the schema-owner role (bypasses RLS by design — used to plant fixture
 * rows). The probe runs as the `app_user` Postgres role with
 * `app.user_id` / `app.user_role` GUCs bound inside a transaction so RLS
 * policies actually evaluate.
 *
 * Cells:
 *   1. trainer-as-participant sees only events they participate in or created.
 *   2. trainer-non-participant sees 0 rows for non-academy events.
 *   3. no GUC bound → 0 rows (default-deny baseline).
 *   4. sparring_partner sees 0 rows in Phase 3 (D-50 no-op).
 *
 * Reference: USER-04 (RLS direct-query requirement);
 *            03-CONTEXT.md D-50 (sparring no-op);
 *            03-PATTERNS.md analog: players-direct-query.test.ts;
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 2 migration `drizzle/0011_phase3_calendar_rls_policies.sql`
 * ships per-action RLS policies on `calendar_events`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, rawPgAsAppUser } from '../helpers/db';

describe('USER-04 RLS direct DB query — calendar_events', () => {
  it.todo('trainer-as-participant sees only events they participate in or created');
  it.todo('trainer-non-participant sees 0 rows for non-academy events');
  it.todo('no GUC bound → 0 rows (default-deny baseline)');
  it.todo('sparring_partner sees 0 rows in Phase 3 (D-50 no-op)');
});
