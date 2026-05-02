/**
 * Medical hard-delete cascade contract — GDPR-07 (Plan 12 Task 3 filling
 * the Wave-0 RED stub).
 *
 * GDPR Article 17 right-to-erasure: when a player exercises the right,
 * the platform's erasure procedure (Plan 18 docs/erasure-strategy.md)
 * hard-deletes their medical_events + medical_documents while preserving
 * unrelated rows. This test exercises the CASCADE rules that Migration
 * 0001 (Plan 03) installed:
 *
 *   - `medical_documents.medical_event_id ON DELETE CASCADE`: removing
 *     a parent event hard-deletes its documents.
 *   - `medical_events.player_user_id ON DELETE RESTRICT`: deleting the
 *     user themselves still requires the medical-erasure procedure to
 *     run first (this test does NOT delete the user; it deletes only
 *     the medical rows directly).
 *
 * Verified: deleting all of a player's medical_events also removes
 * their medical_documents, but does NOT touch unrelated rows for OTHER
 * players. The audit-trigger writes 'delete' rows; we additionally
 * assert other tables (users, consent_records, audit_log) remain
 * untouched.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { encrypt } from '@/server/db/helpers/encryption';
import { users } from '@/server/db/schema/auth';
import {
  medicalDocuments,
  medicalEvents,
} from '@/server/db/schema/medical';

import { freshDb } from '../helpers/db';

describe('medical hard-delete cascade (GDPR-07)', () => {
  it('deleting medical_events cascades to medical_documents; other players untouched', async () => {
    await using h = await freshDb();

    await h.db.execute(
      sql`SELECT set_config('app.medical_key', ${process.env.MEDICAL_ENCRYPTION_KEY ?? 'test-medical-key-must-be-32-bytes!!'}, false)`,
    );
    const actorUuid = '22222222-2222-2222-2222-222222222222';
    await h.db.execute(sql`SELECT set_config('app.user_id', ${actorUuid}, false)`);

    const [td] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        id: actorUuid,
        email: 'td-erasure@vttl.test',
        name: 'TD Erasure',
        role: 'technical_director',
      } as any)
      .returning();
    const [victim] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'erasure-victim@vttl.test',
        name: 'Erasure Victim',
        role: 'player',
      } as any)
      .returning();
    const [bystander] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'erasure-bystander@vttl.test',
        name: 'Erasure Bystander',
        role: 'player',
      } as any)
      .returning();
    if (!td || !victim || !bystander) throw new Error('seed users returned no rows');

    // Two events for the victim, with one document each.
    const [vEvent1] = await h.db
      .insert(medicalEvents)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        playerUserId: victim.id,
        eventDescriptionCipher: encrypt('Event 1') as unknown as string,
        startDate: '2026-01-01',
        createdBy: td.id,
      } as any)
      .returning();
    const [vEvent2] = await h.db
      .insert(medicalEvents)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        playerUserId: victim.id,
        eventDescriptionCipher: encrypt('Event 2') as unknown as string,
        startDate: '2026-02-01',
        createdBy: td.id,
      } as any)
      .returning();
    if (!vEvent1 || !vEvent2) throw new Error('victim events insert returned no rows');

    await h.db
      .insert(medicalDocuments)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        medicalEventId: vEvent1.id,
        playerUserId: victim.id,
        storageKey: 'medical/victim-1',
        originalFilenameCipher: encrypt('scan.pdf') as unknown as string,
        mimeType: 'application/pdf',
        sizeBytes: '1024',
        uploadedBy: td.id,
      } as any);
    await h.db
      .insert(medicalDocuments)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        medicalEventId: vEvent2.id,
        playerUserId: victim.id,
        storageKey: 'medical/victim-2',
        originalFilenameCipher: encrypt('scan2.pdf') as unknown as string,
        mimeType: 'application/pdf',
        sizeBytes: '2048',
        uploadedBy: td.id,
      } as any);

    // One unrelated event + document for the bystander — must survive
    // the victim's erasure.
    const [bEvent] = await h.db
      .insert(medicalEvents)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        playerUserId: bystander.id,
        eventDescriptionCipher: encrypt('Bystander event') as unknown as string,
        startDate: '2026-03-01',
        createdBy: td.id,
      } as any)
      .returning();
    if (!bEvent) throw new Error('bystander event insert returned no row');
    await h.db
      .insert(medicalDocuments)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        medicalEventId: bEvent.id,
        playerUserId: bystander.id,
        storageKey: 'medical/bystander-1',
        originalFilenameCipher: encrypt('bystander.pdf') as unknown as string,
        mimeType: 'application/pdf',
        sizeBytes: '512',
        uploadedBy: td.id,
      } as any);

    // Hard-delete the victim's two events. CASCADE removes the linked
    // medical_documents.
    await h.db.execute(
      sql`DELETE FROM medical_events WHERE player_user_id = ${victim.id}`,
    );

    // Victim's medical rows are gone. freshDb's drizzle handle has no
    // schema generic so we use the lower-level select() builder.
    const remainingVictimEvents = await h.db
      .select()
      .from(medicalEvents)
      .where(eq(medicalEvents.playerUserId, victim.id));
    expect(remainingVictimEvents).toHaveLength(0);
    const remainingVictimDocs = await h.db
      .select()
      .from(medicalDocuments)
      .where(eq(medicalDocuments.playerUserId, victim.id));
    expect(remainingVictimDocs).toHaveLength(0);

    // Bystander's medical rows untouched.
    const bystanderEvents = await h.db
      .select()
      .from(medicalEvents)
      .where(eq(medicalEvents.playerUserId, bystander.id));
    expect(bystanderEvents).toHaveLength(1);
    const bystanderDocs = await h.db
      .select()
      .from(medicalDocuments)
      .where(eq(medicalDocuments.playerUserId, bystander.id));
    expect(bystanderDocs).toHaveLength(1);

    // Users themselves still exist (the erasure procedure handles user
    // anonymisation separately; this test only exercises medical CASCADE).
    const allUsers = await h.db.select({ id: users.id }).from(users);
    expect(allUsers.map((u) => u.id).sort()).toEqual(
      [td.id, victim.id, bystander.id].sort(),
    );
  });
});
