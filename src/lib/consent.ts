/**
 * Consent ledger — GDPR-01, I18N-09, D-04..07 (Plan 12).
 *
 * Three responsibilities, one module:
 *
 *   1. `CURRENT_POLICY` — the single source of truth for the active
 *      policy version per consent category. Imported by:
 *        - `requireCurrentConsent` middleware (Plan 11) → checks if a
 *          user has an active row at this version; if not, throws
 *          `re_consent_required` (D-07).
 *        - `consent.give` tRPC router (this plan) → stamps the row.
 *        - `<ReConsentBanner>` (this plan) → submits the new version.
 *      A version bump is the trigger for forcing re-consent — see D-07.
 *
 *   2. `getConsentText(category, version, locale)` — reads the EXACT
 *      bytes shown to the user from `public/locales/consent-{category}-
 *      {version}.{locale}.html`. Deterministic: same args → same string,
 *      always. The file is committed to git so re-running the consent
 *      flow at version 1.0.0 in the future shows the SAME text the user
 *      agreed to back in May 2026.
 *
 *   3. `recordConsent({...})` — INSERTs a `consent_records` row with the
 *      snapshot + sha256 of the snapshot. The sha256 is the tamper-evidence
 *      gate (T-01-08): rehashing the snapshot at audit time and comparing
 *      against the stored hash detects post-hoc edits to the row.
 *
 * `consentingPartyUserId` defaults to the user themselves (adult flow).
 * For Belgian minors (< 16, see GDPR-02), the parent supplies consent on
 * behalf of the minor — the parent's user id goes into
 * `consentingPartyUserId`, the minor's into `userId`. The
 * `parent_child_links` UNIQUE constraint (Plan 02 memberships.ts) enforces
 * the "one consenting parent per minor" rule (HIGH-5, Belgian Art. 8).
 *
 * `db?: DbClient` accepts a tRPC `ctx.db` (RLS-bound transaction handle)
 * so a `consent.give` mutation honours `consent_records.read_own` /
 * `insert_own_or_minor` policies. Falls back to `rawDb` when called
 * outside a tRPC context (e.g. seed scripts, BullMQ worker handlers).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Consent Schema
 *            + Flow (lines 1727-1748);
 *            .planning/phases/01-fundament/01-CONTEXT.md §B (D-04..07);
 *            src/server/db/schema/consent.ts (table shape + rationale).
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { db as rawDb, type DbClient } from '@/server/db/client';
import { consentRecords } from '@/server/db/schema/consent';
import type { Locale } from '@/i18n/routing';

/**
 * Per-category active policy version + release date.
 *
 * Phase 1 ships at 1.0.0 (team-drafted per D-04; legal review is the
 * Phase 8 release-gate). The release date is the canonical "version
 * activated on" timestamp used by the re-consent UX: any user whose
 * latest active consent row at this category is older than `released_at`
 * is shown the re-consent banner (D-07).
 *
 * `as const` widening preservation matters — `CURRENT_POLICY.operational
 * .version` must keep its literal type ('1.0.0') so callers can pass it
 * to `recordConsent`'s `version: string` field without a `string`-narrowing
 * cast. The literal also lets the `requireCurrentConsent` middleware
 * embed the value as a SQL parameter without runtime validation.
 */
export const CURRENT_POLICY = {
  operational: { version: '1.0.0', released_at: '2026-05-01' },
  medical_processing: { version: '1.0.0', released_at: '2026-05-01' },
  photo_video: { version: '1.0.0', released_at: '2026-05-01' },
} as const;

export type ConsentCategory = keyof typeof CURRENT_POLICY;

/**
 * Categories the platform requires for activation. Today only
 * `operational` is required — medical_processing and photo_video are
 * optional opt-ins. The `canActivate` guard checks for an active row at
 * `operational` (and parent consent on the same category, if minor); the
 * other categories gate role-specific features (medical UI, photo
 * uploads) when the user reaches them later.
 */
const REQUIRED_CATEGORIES: readonly ConsentCategory[] = ['operational'] as const;

/**
 * Reads the consent text exactly as the user will see it.
 *
 * The path layout is committed in git as
 * `public/locales/consent-{category}-{version}.{locale}.html` — Plan 07
 * Task 4 generated the 9 files (3 categories × 3 locales). A 4th locale
 * or a new category is a planning concern, not a code concern: drop the
 * file in place and bump `CURRENT_POLICY` if its content changes.
 *
 * Returns the raw HTML — the caller is responsible for safe rendering
 * (the `<ConsentStep>` component uses `dangerouslySetInnerHTML` inside a
 * scrollable `<article>` because the consent text IS HTML, intentionally
 * served as-authored). The hash captured by `recordConsent` is over the
 * raw bytes, so this function is the canonical input to the SHA-256.
 */
export async function getConsentText(
  category: ConsentCategory,
  version: string,
  locale: Locale,
): Promise<string> {
  const file = path.resolve(
    process.cwd(),
    'public',
    'locales',
    `consent-${category}-${version}.${locale}.html`,
  );
  return fs.readFile(file, 'utf-8');
}

/**
 * SHA-256 hex digest of the input string (UTF-8 encoded).
 *
 * The output is always 64 lowercase hex characters; callers may match
 * against `/^[a-f0-9]{64}$/` to validate the contract. Uses Node's built-in
 * `crypto.createHash` (no external dependency) — the algorithm is
 * deliberate: SHA-256 is the GDPR-pragmatic choice (FIPS 140-3, widely
 * supported, fast on x86-64 + ARM, no known practical collisions). MD5
 * and SHA-1 are unsuitable; SHA-512 is overkill for a textual snapshot.
 */
function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

/**
 * Arguments to `recordConsent`. Surfaces every field that lands on the
 * `consent_records` row so callers cannot forget one (TypeScript will
 * raise on missing keys).
 *
 * `consentingPartyUserId` defaults to `userId` (adult self-consent). For
 * a minor, the parent's user id MUST be passed explicitly; the parent
 * row + parent_child_links presence is enforced by Plan 04 RLS policy
 * `consent.insert_own_or_minor`.
 *
 * `ipAddress` + `userAgent` are auditable provenance; tRPC populates them
 * from request headers via `server-context.ts` and surfaces them on
 * `ctx.ipAddress` / `ctx.userAgent`.
 *
 * `db` is the RLS-bound transaction handle from `withRlsContext` (Plan
 * 11). When omitted, the raw connection pool is used — appropriate for
 * scripts and worker jobs but NEVER for tRPC handlers (which must honour
 * RLS).
 */
export interface RecordConsentArgs {
  userId: string;
  category: ConsentCategory;
  version: string;
  locale: Locale;
  textShown: string;
  consentingPartyUserId?: string;
  ipAddress: string;
  userAgent: string;
  db?: DbClient;
}

/**
 * Inserts a `consent_records` row capturing the snapshot + hash + version
 * + locale.
 *
 * Returns the inserted row (Drizzle `.returning()`) so callers can:
 *   - audit-log the resulting `id` (consent.give writes
 *     `audit_log.resource_id = row.id`),
 *   - assert in tests that the snapshot matches the input bytes,
 *   - compare `consentTextSha256` against `sha256(consentTextSnapshot)`
 *     after a roundtrip (tamper-evidence drill).
 */
export async function recordConsent(
  args: RecordConsentArgs,
): Promise<typeof consentRecords.$inferSelect> {
  const dbHandle = args.db ?? rawDb;
  const consentingPartyUserId = args.consentingPartyUserId ?? args.userId;
  const sha = sha256(args.textShown);
  // `givenAt` is omitted intentionally — the schema's `tstz('given_at',
  // { defaultNow: true })` fills it server-side. Drizzle's strict TS
  // inference does not pick up the default through the helper's
  // conditional return shape (same issue documented in
  // `src/server/trpc/middleware/audit.ts`), so we cast through `unknown`
  // to suppress the mistaken "givenAt is required" inference. The DB
  // default (`DEFAULT NOW()`) is canonical: a client-side `new Date()`
  // here would drift from the surrounding transaction's snapshot
  // timestamp by milliseconds depending on connection-pool latency.
  const values = {
    userId: args.userId,
    consentCategory: args.category,
    policyVersion: args.version,
    locale: args.locale,
    consentTextSnapshot: args.textShown,
    consentTextSha256: sha,
    consentingPartyUserId,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
  };
  const [row] = await dbHandle
    .insert(consentRecords)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(values as any)
    .returning();
  if (!row) {
    // Defensive: Drizzle returns `[row]` on a single-row insert, but
    // typing it as `RowType | undefined` mirrors the runtime shape so an
    // unexpected empty result fails loudly rather than masquerading as a
    // successful no-op.
    throw new Error('recordConsent: insert returned no row');
  }
  return row;
}

/**
 * Predicate — returns true iff the category is on the platform's
 * required-for-activation list. `<ConsentStep required={...}>` reads
 * this to disable the "skip" affordance.
 */
export function isCategoryRequired(category: ConsentCategory): boolean {
  return REQUIRED_CATEGORIES.includes(category);
}
