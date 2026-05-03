/**
 * Medical write-time audit trigger contract — CRIT-7, GDPR-04 (Plan 12 Task 3
 * filling the Wave-0 RED stub).
 *
 * Migration 0001 (Plan 03) installed two SECURITY DEFINER triggers:
 *   - `trg_medical_event_audit`     after INSERT/UPDATE/DELETE on medical_events
 *   - `trg_medical_document_audit`  after INSERT/UPDATE/DELETE on medical_documents
 *
 * Each trigger writes a `medical_access_audit` row with action='write' on
 * INSERT, 'write' on a non-deleting UPDATE, and 'delete' on either a
 * soft-delete (UPDATE flipping `deleted_at`) or a hard DELETE.
 *
 * This integration test asserts the basic INSERT path: writing a single
 * encrypted medical_event row produces ONE audit row with the expected
 * fields. The full read-time audit pattern lives in Phase 5 (CRIT-7
 * read-time audit deferred to async BullMQ); Phase 1 only checks the
 * write-time trigger primitive that the schema migration installs.
 *
 * The test sets `app.user_id` and `app.medical_key` GUCs via raw SQL —
 * mirrors what `withRlsContext` (Plan 11) does in production for tRPC
 * requests. Without those GUCs the encrypt() helper fails with
 * `unrecognized configuration parameter`, which is the correct fail-loud
 * behaviour but inconvenient in tests.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { encrypt } from '@/server/db/helpers/encryption';
import { users } from '@/server/db/schema/auth';
import {
  medicalAccessAudit,
  medicalEvents,
} from '@/server/db/schema/medical';

import { freshDb } from '../helpers/db';

describe('medical write-time audit (CRIT-7, GDPR-04)', () => {
  it('INSERT into medical_events writes one audit row with action=write', async () => {
    await using h = await freshDb();

    // Set the per-connection encryption key — the medical_events insert
    // uses pgp_sym_encrypt(plaintext, current_setting('app.medical_key')).
    // Same GUC the production pool initializer sets (Plan 06 db client).
    await h.db.execute(
      sql`SELECT set_config('app.medical_key', ${process.env.MEDICAL_ENCRYPTION_KEY ?? 'test-medical-key-must-be-32-bytes!!'}, false)`,
    );

    // Identity for the audit trigger to attribute the write to.
    const actorUuid = '11111111-1111-1111-1111-111111111111';
    await h.db.execute(sql`SELECT set_config('app.user_id', ${actorUuid}, false)`);
    await h.db.execute(
      sql`SELECT set_config('app.request_id', 'test-medical-audit', false)`,
    );

    // Seed the actor (TD) + the player (subject) — both need to exist
    // because medical_events.created_by + medical_events.player_user_id
    // reference users.id with FK constraints.
    const [td] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        id: actorUuid,
        email: 'td-audit@vttl.test',
        name: 'TD Audit',
        role: 'technical_director',
      } as any)
      .returning();
    const [player] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'player-audit@vttl.test',
        name: 'Player Audit',
        role: 'player',
      } as any)
      .returning();
    if (!td || !player) throw new Error('seed users returned no rows');

    // INSERT the medical event — pgp_sym_encrypt wraps the plaintext.
    // The trigger fires AFTER INSERT and writes a medical_access_audit row.
    const [event] = await h.db
      .insert(medicalEvents)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        playerUserId: player.id,
        eventDescriptionCipher: encrypt('Knee strain — light training only') as unknown as string,
        startDate: '2026-05-01',
        createdBy: td.id,
        isInjury: true,
      } as any)
      .returning();
    if (!event) throw new Error('medical_events insert returned no row');

    // Assert: exactly one audit row exists, action='write', referencing
    // the player + record we just inserted. The freshDb helper does not
    // attach the schema generic to its drizzle handle (relational
    // queries unavailable), so we use the lower-level select() builder.
    const audit = await h.db
      .select()
      .from(medicalAccessAudit)
      .where(eq(medicalAccessAudit.recordId, event.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('write');
    expect(audit[0]?.recordType).toBe('medical_event');
    expect(audit[0]?.subjectPlayerId).toBe(player.id);
    expect(audit[0]?.actorUserId).toBe(actorUuid);
    expect(audit[0]?.outcome).toBe('success');
  });
});
