/**
 * Consent-version-bump job handler (D-15, D-16, HIGH-12).
 *
 * Phase-1 example job that demonstrates the worker pattern Phase 5 + Phase 6
 * will extend. When a major version of a consent text is bumped (legal review,
 * Belgian DPA guideline update), Plan 12 enqueues one job per impacted user;
 * this handler emails them in their preferred locale.
 *
 * Idempotency (T-01-JOB-INJECTION mitigation):
 *  - If a `consent_records` row already exists for `(user_id, policy_version,
 *    consent_category)`, the user has already re-acknowledged this version —
 *    skip the email so a re-played job (BullMQ retry, manual replay,
 *    observability tooling) does not double-send.
 *  - If the user no longer exists (deleted account, anonymized via GDPR
 *    right-to-erasure), skip silently.
 *
 * Schema linkage: this handler references `consent_records.userId`,
 * `policyVersion`, `consentCategory`, and `users.id` columns. Those tables are
 * created in Plans 02 and 04. Until those plans land the schema barrel
 * (`src/server/db/schema/index.ts`) is empty; runtime would crash but compile-
 * time `tsc --noEmit` survives because we use `// @ts-expect-error` shielding
 * on the imports? No — we want clean tsc. Plans 02 + 04 ship before Plan 12
 * actually enqueues, so the consumers exist by then. Worker-template tests
 * mock these modules.
 *
 * Email send is lazy-imported to avoid a worker → email → db circular import
 * during module initialization (Plan 06 wires the real Resend client; Plan
 * 06's email module imports the same env + log module the worker uses).
 */
import { db } from '@/server/db/client';
import { consentRecords, users } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';

export type ConsentCategory = 'operational' | 'medical_processing' | 'photo_video';

export interface ConsentVersionBumpData {
  userId: string;
  category: ConsentCategory;
  oldVersion: string;
  newVersion: string;
}

export type ConsentVersionBumpResult =
  | { skipped: true; reason: 'consent_row_exists' | 'user_not_found' }
  | { sent: true };

export async function processConsentVersionBump(
  data: ConsentVersionBumpData,
): Promise<ConsentVersionBumpResult> {
  // Idempotency check FIRST (before fetching the user) so a re-played job
  // costs one indexed lookup, not two.
  const existing = await db.query.consentRecords.findFirst({
    where: and(
      eq(consentRecords.userId, data.userId),
      eq(consentRecords.policyVersion, data.newVersion),
      eq(consentRecords.consentCategory, data.category),
    ),
  });
  if (existing) return { skipped: true, reason: 'consent_row_exists' };

  const user = await db.query.users.findFirst({ where: eq(users.id, data.userId) });
  if (!user) return { skipped: true, reason: 'user_not_found' };

  // Lazy import: Plan 06 ships @/server/email/send. Importing eagerly would
  // pull the Resend SDK + email templates into every worker bundle even when
  // a job short-circuits on idempotency.
  const { sendEmailLocalized } = await import('@/server/email/send');
  await sendEmailLocalized({
    to: user.email,
    locale: user.preferredLocale,
    template: 'consent-version-bump',
    data: {
      oldVersion: data.oldVersion,
      newVersion: data.newVersion,
      category: data.category,
    },
  });

  return { sent: true };
}
