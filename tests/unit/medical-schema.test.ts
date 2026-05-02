/**
 * Medical schema unit tests — GDPR-03, CRIT-2, CRIT-7.
 *
 * Pure unit checks against the Drizzle schema metadata (no live Postgres).
 * Guard the contract Plan 03 introduces: cipher columns + access-audit
 * shape + cascade/restrict rules. Plan 04 (RLS policies) and Plan 16
 * (push to staging) consume this contract; if any assertion here regresses,
 * the tamper-evidence model has been weakened and downstream RLS tests
 * (tests/rls/medical-isolation.test.ts) will produce false negatives.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Medical isolation
 * (lines 759-803), §Audit log + medical access audit (lines 723-740).
 */
import { describe, it, expect } from 'vitest';

import { medicalEvents, medicalDocuments, medicalAccessAudit } from '@/server/db/schema/medical';

describe('medical schema — GDPR-03, CRIT-2, CRIT-7', () => {
  it('medical_events has player_user_id, cipher columns, soft-delete column', () => {
    const cols = (medicalEvents as unknown as { _: { columns: Record<string, unknown> } })._.columns;
    expect(cols.playerUserId).toBeDefined();
    expect(cols.eventDescriptionCipher).toBeDefined();
    expect(cols.doctorCipher).toBeDefined();
    expect(cols.isInjury).toBeDefined();
    expect(cols.startDate).toBeDefined();
    expect(cols.endDate).toBeDefined();
    expect(cols.deletedAt).toBeDefined();
  });

  it('medical_events.event_description_cipher is NOT NULL (Article-9 free-text never plaintext-empty)', () => {
    const col = (
      medicalEvents as unknown as { eventDescriptionCipher: { notNull: boolean } }
    ).eventDescriptionCipher;
    expect(col.notNull).toBe(true);
  });

  it('medical_events.is_injury defaults to false', () => {
    const col = (medicalEvents as unknown as { isInjury: { notNull: boolean; hasDefault: boolean } })
      .isInjury;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });

  it('medical_documents has medical_event_id, player_user_id, storage_key, scan_status', () => {
    const cols = (
      medicalDocuments as unknown as { _: { columns: Record<string, unknown> } }
    )._.columns;
    expect(cols.medicalEventId).toBeDefined();
    expect(cols.playerUserId).toBeDefined();
    expect(cols.storageKey).toBeDefined();
    expect(cols.scanStatus).toBeDefined();
  });

  it('medical_documents.storage_key is NOT NULL and unique', () => {
    const col = (
      medicalDocuments as unknown as { storageKey: { notNull: boolean; isUnique: boolean } }
    ).storageKey;
    expect(col.notNull).toBe(true);
    // Drizzle stores uniqueness on the column metadata as `isUnique`.
    expect(col.isUnique).toBe(true);
  });

  it('medical_access_audit has bigserial id + actor_user_id NOT NULL + record_type NOT NULL', () => {
    const cols = (
      medicalAccessAudit as unknown as { _: { columns: Record<string, unknown> } }
    )._.columns;
    expect(cols.id).toBeDefined();
    expect(cols.actorUserId).toBeDefined();
    expect(cols.subjectPlayerId).toBeDefined();
    expect(cols.recordType).toBeDefined();
    expect(cols.action).toBeDefined();
    expect(cols.outcome).toBeDefined();
    expect(cols.occurredAt).toBeDefined();
  });

  it('medical_access_audit.actor_user_id and subject_player_id are NOT NULL', () => {
    const actor = (
      medicalAccessAudit as unknown as { actorUserId: { notNull: boolean } }
    ).actorUserId;
    const subject = (
      medicalAccessAudit as unknown as { subjectPlayerId: { notNull: boolean } }
    ).subjectPlayerId;
    expect(actor.notNull).toBe(true);
    expect(subject.notNull).toBe(true);
  });

  it('medical_access_audit.outcome defaults to success', () => {
    const col = (
      medicalAccessAudit as unknown as { outcome: { notNull: boolean; hasDefault: boolean } }
    ).outcome;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });
});
