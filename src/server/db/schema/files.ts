/**
 * uploaded_files — single source of truth for every file managed by the
 * platform (D-30). Phase 2 uses the `profiles` bucket; Phase 4 will add
 * evaluation attachments under the same table with a different `bucket`
 * value; Phase 5 will add medical document rows.
 *
 * Lifecycle columns:
 *  - `scan_status`: 'pending' on INSERT; BullMQ MALWARE_SCAN job (Plan 02-06)
 *    flips it to 'clean' or 'infected'. CHECK constraint enforces the enum
 *    at DB level (Postgres has no native CHECK-on-text-enum without it).
 *  - `superseded_at`: soft-delete marker (D-29) for replaced photos. NULL =
 *    current. We never hard-delete uploaded_files rows; replacement writes
 *    `superseded_at = now()` on the old row and inserts a new one.
 *  - `sha256`: hex digest set by the malware-scan worker via
 *    `mark_scan_result()` (Plan 02-05). NULL while scan_status='pending'.
 *    Used for tamper detection + future dedup. 64 hex chars; no UNIQUE
 *    (different uploads may legitimately share content).
 *  - `updated_at`: TIMESTAMPTZ touched by `mark_scan_result()` and tRPC
 *    mutations so downstream consumers can invalidate caches deterministically.
 *
 * No FK to players/trainers — uploaded_files is bucket-agnostic; binding
 * back to an owning entity is done via the *_file_id column on that entity
 * (e.g., `players.profile_photo_file_id`). Multiple entities can reference
 * the same file id (e.g., a player profile photo also used as evaluation
 * attachment — out-of-scope edge case, but the schema does not block it).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-30
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §file.upload tRPC mutation skeleton
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';

export const uploadedFiles = pgTable(
  'uploaded_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(), // 'profiles' (Phase 2); 'evaluations'/'medical' later
    storageKey: text('storage_key').notNull(), // full bucket-path: 'profiles/{user_id}/{uuid}.{ext}'
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    scanStatus: text('scan_status').notNull().default('pending'),
    scanCompletedAt: tstz('scan_completed_at'),
    // sha256 hex digest — set by the malware-scan worker via
    // mark_scan_result(). NULL while scan_status='pending'. Used for
    // tamper detection + future dedup. 64 hex chars, no UNIQUE
    // (different uploads may legitimately share content).
    sha256: text('sha256'),
    supersededAt: tstz('superseded_at'),
    uploadedAt: tstz('uploaded_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    unique('uniq_uploaded_files_storage_key').on(t.storageKey),
    check(
      'uploaded_files_scan_status_enum',
      sql`${t.scanStatus} IN ('pending', 'clean', 'infected')`,
    ),
    check(
      'uploaded_files_sha256_format',
      sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[a-f0-9]{64}$'`,
    ),
    index('idx_uploaded_files_owner_scan').on(t.ownerUserId, t.scanStatus),
  ],
);

export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type NewUploadedFile = typeof uploadedFiles.$inferInsert;
