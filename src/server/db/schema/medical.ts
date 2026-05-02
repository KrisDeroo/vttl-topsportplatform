/**
 * Medical schema — GDPR Article-9 special-category data, CRIT-2, CRIT-7,
 * T-01-03/04/10.
 *
 * Tables in this file are blast-radius-isolated from the general schema:
 * a bug in `users` (Plan 02) corrupts the auth layer; a bug in
 * `medical_events` is a healthcare-data breach under the Belgian Patient
 * Rights Act (1973/2002, with 30-year retention obligation, OPS-10).
 *
 * Three tables:
 *   - `medical_events` — diagnosis / injury rows. Free-text fields stored
 *     as pgcrypto-encrypted bytea (text-cast on the wire). Soft-delete
 *     via `deleted_at`; hard-delete only on GDPR-07 erasure (see
 *     docs/erasure-strategy.md, Plan 18). FK to `users.id` is
 *     `ON DELETE RESTRICT` on purpose — a player whose user record is
 *     erased without first running the medical-erasure procedure must
 *     fail loudly, not silently cascade-drop their medical history.
 *   - `medical_documents` — bucket-key references for files in the
 *     Cloudflare R2 `medical/` bucket. `medical_event_id` is
 *     `ON DELETE CASCADE` (the document's parent event going away takes
 *     the document with it); `player_user_id` is `ON DELETE RESTRICT`
 *     (same erasure-discipline reasoning as `medical_events`).
 *   - `medical_access_audit` — dedicated audit table for medical reads
 *     and writes (CRIT-7). Separate from `audit_log` so retention (6
 *     years per OPS-02) and read access (TD-only via SECURITY DEFINER
 *     function in Plan 04) can differ. `app_user` has INSERT-only
 *     privileges enforced at the Postgres role layer in the migration.
 *
 * Cipher columns:
 *   - `event_description_cipher` (NOT NULL — every medical event has a
 *     description; an empty event row is never valid)
 *   - `doctor_cipher` (nullable — not every event has an attending doctor
 *     recorded)
 *   - `original_filename_cipher` (NOT NULL — filenames may contain
 *     identifying info: "Knee-MRI-PlayerName.pdf"; encrypted at column
 *     level, opaque storage_key in the bucket)
 *
 * Audit-trigger contract (implemented in
 * `drizzle/0001_medical_isolated.sql`):
 *   AFTER INSERT/UPDATE/DELETE on medical_events / medical_documents
 *   inserts a row into medical_access_audit with action='write' or
 *   'delete'. Read-time audit is intentionally deferred to Phase 5
 *   (app-layer async via BullMQ — CRIT-7) because Postgres has no SELECT
 *   trigger and inline read auditing would block every medical query.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md
 *   §Medical isolation (lines 759-803),
 *   §Audit log + medical access audit (lines 723-740);
 *   .planning/PITFALLS-ADDITIONS.md §CRIT-7 (medical access audit pattern),
 *   §CRIT-8 (audit log scoping).
 */
import { pgTable, uuid, text, date, boolean, bigserial, inet } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';

/**
 * Medical events — Article-9 special-category data.
 *
 * Free-text fields (`event_description_cipher`, `doctor_cipher`) are
 * pgcrypto-encrypted; the cipher is stored as text (base64-encoded bytea
 * via the binary protocol). NEVER read these columns without going through
 * `decrypt()` from `helpers/encryption.ts` — a bare SELECT returns
 * unreadable cipher.
 *
 * `is_injury` distinguishes injury events (which feed Phase 5 training
 * absence calculations) from other medical events (illness, prescribed
 * rest). Both are subject to the same access controls.
 *
 * `start_date` / `end_date` are dates (not tstz) — medical events are
 * recorded at day granularity by the team doctor, not minute precision.
 * `end_date` nullable while the event is open (e.g. ongoing injury).
 *
 * `deleted_at` enables soft-delete for normal corrections; GDPR-07 erasure
 * uses hard-delete via the dedicated procedure (Plan 04 RLS lets the
 * SECURITY DEFINER erasure function bypass row-level filtering).
 */
export const medicalEvents = pgTable('medical_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ON DELETE RESTRICT — never cascade-drop medical history when a user is
  // deleted. GDPR-07 erasure runs the medical-erasure procedure first; a
  // raw DELETE on users for a player with medical events fails with
  // foreign-key violation (correct fail-loud behaviour).
  playerUserId: uuid('player_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  // pgcrypto cipher (text-cast bytea). Use `encrypt()` helper on write,
  // `decrypt()` on read.
  eventDescriptionCipher: text('event_description_cipher').notNull(),
  // Optional attending doctor — encrypted because it's a personal name,
  // potentially identifying when combined with the event date.
  doctorCipher: text('doctor_cipher'),
  isInjury: boolean('is_injury').notNull().default(false),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  // `created_by` is NOT a player_user_id reference — it's whoever entered
  // the event (TD, medical_staff, or a trainer with the right scope per
  // Plan 04 RLS). Audit attribution comes from the trigger, not this
  // column, but we keep `created_by` for human-readable provenance.
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  // Soft-delete; hard-delete on GDPR-07 erasure (Plan 18 erasure-strategy).
  deletedAt: tstz('deleted_at'),
});

/**
 * Medical documents — file metadata referencing Cloudflare R2 `medical/`
 * bucket objects. Phase 5 wires upload + signed-URL flow; Phase 1 only
 * lays the schema.
 *
 * `storage_key` is the opaque UUID-prefixed path in the bucket (NOT the
 * original filename). The original filename is stored cipher-encrypted in
 * `original_filename_cipher` because filenames frequently contain PII
 * ("Knee-MRI-Smith2010.pdf").
 *
 * `medical_event_id` is nullable — a document can be uploaded as
 * "general medical record" without being attached to a specific event.
 * When set, `ON DELETE CASCADE` removes the document row when the parent
 * event is hard-deleted (the bucket object cleanup is a Phase-5 background
 * job, not a Postgres trigger).
 *
 * `scan_status` tracks malware-scan state (HIGH-14): `pending` on upload,
 * `clean` after scan passes, `quarantined` if scan flags it. Phase 5's
 * upload pipeline writes this column; Phase 1 only sets the default.
 *
 * `size_bytes` is text (not bigint) — defensive choice for v1; we accept
 * a string from the client and store it; later phases may convert to
 * bigint via expand-contract if size-based queries become hot.
 */
export const medicalDocuments = pgTable('medical_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Optional FK to parent event; CASCADE is correct here — orphaned
  // document rows after event deletion would point at a bucket object
  // that the Phase-5 cleanup job is about to remove.
  medicalEventId: uuid('medical_event_id').references(() => medicalEvents.id, {
    onDelete: 'cascade',
  }),
  // Same RESTRICT discipline as medical_events.playerUserId.
  playerUserId: uuid('player_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  // UUID-prefixed path in R2 `medical/` bucket — globally unique.
  storageKey: text('storage_key').notNull().unique(),
  originalFilenameCipher: text('original_filename_cipher').notNull(),
  mimeType: text('mime_type').notNull(),
  // Stored as text for v1 (HIGH-14 magic-byte check sets this on upload).
  sizeBytes: text('size_bytes').notNull(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  uploadedAt: tstz('uploaded_at', { defaultNow: true }).notNull(),
  // 'pending' | 'clean' | 'quarantined' (HIGH-14, Phase 5).
  scanStatus: text('scan_status').notNull().default('pending'),
  deletedAt: tstz('deleted_at'),
});

/**
 * Medical access audit — INSERT-only for `app_user`, reads via Plan 04
 * SECURITY DEFINER function (`query_medical_access_audit`). RLS policy
 * `USING (false)` on this table ensures even a SELECT bypassing the
 * function returns zero rows for the application role.
 *
 * Retention: 6 years (OPS-02 + GDPR Art. 32(b) + Belgian medical-data
 * law). Partitioning is deferred — at v1 scale (200 players × ~10 medical
 * events/year × 5 audit rows/event = ~10k rows/year) sequential scans
 * with the (subject_player_id, occurred_at DESC) index are fast enough.
 *
 * Trigger writes (CRIT-7, T-01-04): the audit-trigger functions
 * `medical_event_audit()` and `medical_document_audit()` are
 * SECURITY DEFINER — they run as the migration owner, not as `app_user`,
 * so the INSERT bypasses any future RLS policy on this table. This is
 * the only reason the trigger writes succeed despite the
 * `USING (false)` reads-policy from Plan 04.
 *
 * `actor_user_id` and `subject_player_id` are NOT NULL: every audit row
 * MUST identify both who acted and whose data was touched. The trigger
 * defaults `actor_user_id` to the all-zeros UUID
 * (`00000000-0000-0000-0000-000000000000`) when `app.user_id` is unset
 * — that's the "system action" sentinel; Plan 11 ensures the GUC is set
 * before any medical query, so the all-zeros value should only appear
 * for migrations or internal cron jobs.
 *
 * `record_type` discriminator: 'medical_event' | 'medical_document'.
 * `action`: 'write' (INSERT/UPDATE) | 'delete' (UPDATE setting
 * deleted_at | hard DELETE) | 'read' (Phase 5 app-layer; never written
 * by triggers in Phase 1) | 'export' (GDPR-04, Phase 7 export).
 */
export const medicalAccessAudit = pgTable('medical_access_audit', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  actorUserId: uuid('actor_user_id').notNull(),
  subjectPlayerId: uuid('subject_player_id').notNull(),
  recordType: text('record_type').notNull(),
  recordId: uuid('record_id'),
  action: text('action').notNull(),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  outcome: text('outcome').notNull().default('success'),
  occurredAt: tstz('occurred_at', { defaultNow: true }).notNull(),
});
