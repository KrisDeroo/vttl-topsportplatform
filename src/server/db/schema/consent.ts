/**
 * Consent records — GDPR proof of lawful processing (D-04..07, GDPR-01, I18N-09).
 *
 * Three columns make this row a self-contained legal record:
 *
 *  - `policy_version` (varchar 32, semver) — the version of the consent
 *    text shown at the time. Every text edit bumps this.
 *  - `locale` (text, nl|en|fr) — which language was shown. Different
 *    languages may carry slightly different legal nuance.
 *  - `consent_text_snapshot` (text) — the FULL text the user saw, copied
 *    in. We deliberately do NOT FK to a policies table; if the policies
 *    table is later edited or migrated, the consent record must remain
 *    a faithful reproduction of what the user agreed to.
 *  - `consent_text_sha256` (varchar 64) — SHA-256 of the snapshot,
 *    computed at consent time. Tamper-evidence: a row whose snapshot
 *    has been tweaked but whose hash still matches an earlier text
 *    can be detected by re-hashing on read.
 *
 * `consenting_party_user_id`: who actually clicked 'I agree'. For a
 * Belgian minor (< 16), this is the parent (parent_user_id from
 * parent_child_links); for an adult, this equals user_id. RLS policy
 * (Plan 04) requires INSERT only when `consenting_party_user_id`
 * matches caller or matches a parent of the user_id.
 *
 * `withdrawn_at` is the only column an UPDATE may touch; Plan 04 RLS
 * forbids any other column change. DELETE is forbidden at the role
 * layer (`REVOKE DELETE ON consent_records FROM app_user`) — see
 * Plan 02 migration block B.
 *
 * `ipAddress` is `inet` (Postgres native IP type, IPv4 + IPv6) —
 * preferred over text for query indexability and SaaS-vendor neutrality.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Consent records (lines 677-701)
 */
import { pgTable, uuid, text, varchar, inet } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';

export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  consentCategory: text('consent_category').notNull(), // 'operational' | 'medical_processing' | 'photo_video'
  policyVersion: varchar('policy_version', { length: 32 }).notNull(), // semver, e.g. '1.0.0'
  locale: text('locale').notNull(), // 'nl' | 'en' | 'fr'
  consentTextSnapshot: text('consent_text_snapshot').notNull(),
  consentTextSha256: varchar('consent_text_sha256', { length: 64 }).notNull(),
  givenAt: tstz('given_at', { defaultNow: true }).notNull(),
  withdrawnAt: tstz('withdrawn_at'), // null = active consent
  consentingPartyUserId: uuid('consenting_party_user_id').references(() => users.id),
  ipAddress: inet('ip_address').notNull(),
  userAgent: text('user_agent').notNull(),
});
