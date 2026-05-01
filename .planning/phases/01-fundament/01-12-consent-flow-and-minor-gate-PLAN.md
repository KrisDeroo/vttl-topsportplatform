---
phase: 01-fundament
plan: 12
type: execute
wave: 6
depends_on: [05, 07, 11]
files_modified:
  - src/lib/consent.ts
  - src/server/auth/activate.ts
  - src/server/trpc/routers/consent.ts
  - src/server/trpc/routers/_app.ts
  - src/components/consent/consent-step.tsx
  - src/components/consent/re-consent-banner.tsx
  - src/app/[locale]/(auth)/register/page.tsx
  - src/app/[locale]/(auth)/consent/page.tsx
  - tests/integration/consent.test.ts
  - tests/integration/minor-flow.test.ts
  - tests/integration/medical-audit.test.ts
  - tests/integration/medical-delete.test.ts
  - tests/integration/parent-child.test.ts
  - tests/integration/trainer-academy.test.ts
  - tests/integration/auth-reset.test.ts
autonomous: false
requirements:
  - GDPR-01
  - GDPR-02
  - I18N-09
threat_refs:
  - T-01-08
  - T-01-09

must_haves:
  truths:
    - "lib/consent.ts exports CURRENT_POLICY = { operational: { version: '1.0.0' }, medical_processing: ..., photo_video: ... } and getConsentText(category, version, locale) reading from public/locales/"
    - "recordConsent({ userId, category, version, locale, textShown, ipAddress, userAgent }) computes sha256(textShown) and INSERTs consent_records row with text_snapshot + sha256 — D-06"
    - "Multi-step register flow: email+password → DOB → 3 consents (operational required, medical_processing optional, photo_video optional) → email verification — GDPR-01"
    - "canActivate(userId) blocks until: (a) own operational consent recorded AND (b) if isMinor=true, parent link exists AND parent has consent — GDPR-02"
    - "Consent withdrawal endpoint UPDATEs withdrawn_at on own row only (RLS-policy-enforced)"
    - "<ReConsentBanner> blocks UI when requireCurrentConsent middleware throws re_consent_required — D-07"
    - "Major version bump enqueues consentNotifyQueue job (Plan 10) per affected user"
    - "tests/integration/consent.test.ts and minor-flow.test.ts (Plan 17) GREEN"
threat_refs_extra:
  - "consent text_sha256 = SHA-256 of consentTextSnapshot — tamper-evident"
tags:
  - phase-1
  - gdpr
  - consent
  - registration
  - minor

must_haves_artifacts:
  artifacts:
    - path: "src/lib/consent.ts"
      provides: "CURRENT_POLICY registry + getConsentText + recordConsent + sha256 helper"
      exports: ["CURRENT_POLICY", "getConsentText", "recordConsent"]
    - path: "src/server/auth/activate.ts"
      provides: "canActivate(userId) — minor gate (GDPR-02)"
      exports: ["canActivate"]
    - path: "src/server/trpc/routers/consent.ts"
      provides: "consent.give, consent.withdraw, consent.status, consent.listForUser endpoints"
      contains: "consent.give"
    - path: "src/components/consent/consent-step.tsx"
      provides: "Multi-step consent UI rendering full text from getConsentText() in current locale"
      exports: ["ConsentStep"]
    - path: "src/components/consent/re-consent-banner.tsx"
      provides: "Full-screen blocking banner shown when re_consent_required (D-07)"
      exports: ["ReConsentBanner"]
  key_links:
    - from: "src/lib/consent.ts"
      to: "public/locales/consent-*.html (Plan 07)"
      via: "fs.readFile of consent-{category}-{version}.{locale}.html"
      pattern: "public/locales/consent-"
    - from: "src/server/auth/activate.ts"
      to: "src/server/db/schema/consent.ts (Plan 02) + memberships.ts"
      via: "consent_records lookup + parent_child_links lookup"
      pattern: "parentChildLinks"
---

<objective>
Implement the GDPR consent flow + Belgian minor-consent gate. This is the plan that makes Phase 1 succescriteria #5 ("under-16 cannot activate without parental consent") and #6 ("consent records contain exact text of locale + version") technically true.

Three pieces:
1. **`lib/consent.ts`** — CURRENT_POLICY registry + getConsentText + recordConsent (computes SHA-256 of the exact text shown — D-06).
2. **`canActivate(userId)`** — minor-gate guard. Blocks if user is < 16 and parent consent missing (GDPR-02).
3. **Consent UI flow** — multi-step register page; ReConsentBanner for D-07.

Plus: fill in the Wave-0 RED test stubs that depended on these primitives (consent.test, minor-flow.test, medical-audit, medical-delete, parent-child, trainer-academy, admin-user, auth-reset).

Output: end-to-end consent capture working; Wave-0 GDPR tests GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@docs/erasure-strategy.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: lib/consent.ts (CURRENT_POLICY + getConsentText + recordConsent + sha256) + activate.ts (minor gate)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Policy version registry (lines 1732–1753)
    - .planning/phases/01-fundament/01-RESEARCH.md §Registration flow (lines 1755–1764)
    - .planning/phases/01-fundament/01-RESEARCH.md §Belgian minor-consent enforcement (lines 1766–1810)
    - .planning/phases/01-fundament/01-CONTEXT.md §B (D-04..07)
    - public/locales/consent-*.html (Plan 07 Task 4 outputs — 9 files)
    - src/server/db/schema/auth.ts + consent.ts + memberships.ts (Plan 02)
  </read_first>
  <files>
    src/lib/consent.ts
    src/server/auth/activate.ts
    src/server/db/schema/auth.ts
    drizzle/0003_users_is_minor.sql
    drizzle/0003_users_is_minor.rollback.md
    tests/integration/consent.test.ts
    tests/integration/minor-flow.test.ts
  </files>
  <behavior>
    - Test 1 (integration): recordConsent stores consent_text_snapshot + consent_text_sha256 (sha256 hex 64 chars)
    - Test 2 (integration): recordConsent for locale='fr' reads consent-operational-1.0.0.fr.html and stores its content
    - Test 3 (integration): canActivate returns { ok: false, reason: 'parent_consent_missing' } for under-16 with no parent link
    - Test 4 (integration): canActivate returns { ok: true } for adult with operational consent
    - Test 5 (integration): canActivate returns { ok: false, reason: 'consent_missing' } for adult with no consent row
  </behavior>
  <action>
    Add `is_minor` generated column to users via Migration 003. First update `src/server/db/schema/auth.ts` to add the column (drizzle generated columns):
    ```ts
    import { sql } from 'drizzle-orm';
    // ... inside users pgTable definition, add:
        isMinor: boolean('is_minor').generatedAlwaysAs(
          sql`CASE WHEN date_of_birth IS NULL THEN NULL
                   WHEN (CURRENT_DATE - date_of_birth) < INTERVAL '16 years' THEN TRUE
                   ELSE FALSE END`,
          { mode: 'stored' },
        ),
    ```

    Generate migration: `npx drizzle-kit generate --name=users_is_minor`. Verify the migration is `drizzle/0003_users_is_minor.sql` with `ALTER TABLE users ADD COLUMN is_minor boolean GENERATED ALWAYS AS (...)`. Add rollback `0003_users_is_minor.rollback.md` with `ALTER TABLE users DROP COLUMN is_minor`.

    Create `src/lib/consent.ts`:
    ```ts
    import { createHash } from 'crypto';
    import fs from 'fs/promises';
    import path from 'path';
    import { db as rawDb } from '@/server/db/client';
    import { consentRecords } from '@/server/db/schema/consent';
    import type { Locale } from '@/i18n/routing';

    /** Single source of truth for the current policy version per category.
     *  Bump on majeure tekst-wijziging (D-07) → triggers re-consent banner. */
    export const CURRENT_POLICY = {
      operational:        { version: '1.0.0', released_at: '2026-05-01' },
      medical_processing: { version: '1.0.0', released_at: '2026-05-01' },
      photo_video:        { version: '1.0.0', released_at: '2026-05-01' },
    } as const;

    export type ConsentCategory = keyof typeof CURRENT_POLICY;

    const REQUIRED_CATEGORIES: readonly ConsentCategory[] = ['operational'] as const;

    /** Loads the EXACT text shown to the user. Deterministic: same (category, version, locale) → same string. */
    export async function getConsentText(category: ConsentCategory, version: string, locale: Locale): Promise<string> {
      const file = path.resolve(process.cwd(), 'public', 'locales', `consent-${category}-${version}.${locale}.html`);
      return fs.readFile(file, 'utf-8');
    }

    function sha256(s: string): string {
      return createHash('sha256').update(s, 'utf-8').digest('hex');
    }

    export interface RecordConsentArgs {
      userId: string;
      category: ConsentCategory;
      version: string;
      locale: Locale;
      textShown: string;
      consentingPartyUserId?: string;  // self by default; parent for under-16
      ipAddress: string;
      userAgent: string;
      db?: any;  // pass ctx.db to honor RLS in protected procedures
    }

    export async function recordConsent(args: RecordConsentArgs) {
      const db = args.db ?? rawDb;
      const [row] = await db.insert(consentRecords).values({
        userId: args.userId,
        consentCategory: args.category,
        policyVersion: args.version,
        locale: args.locale,
        consentTextSnapshot: args.textShown,
        consentTextSha256: sha256(args.textShown),
        consentingPartyUserId: args.consentingPartyUserId ?? args.userId,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      }).returning();
      return row;
    }

    export function isCategoryRequired(category: ConsentCategory): boolean {
      return REQUIRED_CATEGORIES.includes(category);
    }
    ```

    Create `src/server/auth/activate.ts` per RESEARCH lines 1786–1810:
    ```ts
    import { db } from '@/server/db/client';
    import { users } from '@/server/db/schema/auth';
    import { parentChildLinks } from '@/server/db/schema/memberships';
    import { consentRecords } from '@/server/db/schema/consent';
    import { eq, and, isNull } from 'drizzle-orm';
    import { CURRENT_POLICY } from '@/lib/consent';

    export interface ActivationResult {
      ok: boolean;
      reason?: 'not_found' | 'parent_link_missing' | 'parent_consent_missing' | 'consent_missing';
    }

    export async function canActivate(userId: string): Promise<ActivationResult> {
      const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!u) return { ok: false, reason: 'not_found' };

      if ((u as any).isMinor === true) {
        const link = await db.query.parentChildLinks.findFirst({
          where: eq(parentChildLinks.childUserId, userId),
        });
        if (!link) return { ok: false, reason: 'parent_link_missing' };

        const parentConsent = await db.query.consentRecords.findFirst({
          where: and(
            eq(consentRecords.userId, userId),
            eq(consentRecords.consentingPartyUserId, link.parentUserId),
            eq(consentRecords.consentCategory, 'operational'),
            eq(consentRecords.policyVersion, CURRENT_POLICY.operational.version),
            isNull(consentRecords.withdrawnAt),
          ),
        });
        if (!parentConsent) return { ok: false, reason: 'parent_consent_missing' };
      }

      // Self-consent must always exist (adult or minor)
      const ownConsent = await db.query.consentRecords.findFirst({
        where: and(
          eq(consentRecords.userId, userId),
          eq(consentRecords.consentCategory, 'operational'),
          eq(consentRecords.policyVersion, CURRENT_POLICY.operational.version),
          isNull(consentRecords.withdrawnAt),
        ),
      });
      if (!ownConsent) return { ok: false, reason: 'consent_missing' };

      return { ok: true };
    }
    ```

    Update `tests/integration/consent.test.ts` (Plan 17 RED stub) — full implementation:
    ```ts
    import { describe, it, expect, beforeEach } from 'vitest';
    import { freshDb } from '../helpers/db';
    import { recordConsent, getConsentText, CURRENT_POLICY } from '@/lib/consent';
    import { users } from '@/server/db/schema/auth';
    import { sql } from 'drizzle-orm';

    describe('GDPR-01 + I18N-09 + D-04..07', () => {
      it.each(['nl','en','fr'] as const)('snapshot per locale: %s', async (locale) => {
        await using h = await freshDb();
        const [u] = await h.db.insert(users).values({
          email: `c-${locale}@vttl.test`, name: 'C', preferredLocale: locale,
        }).returning();
        const text = await getConsentText('operational', CURRENT_POLICY.operational.version, locale);
        const row = await recordConsent({
          userId: u!.id,
          category: 'operational',
          version: CURRENT_POLICY.operational.version,
          locale,
          textShown: text,
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
          db: h.db,
        });
        expect(row.consentTextSnapshot).toBe(text);
        expect(row.consentTextSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(row.policyVersion).toBe('1.0.0');
        expect(row.locale).toBe(locale);
      });
    });
    ```

    Update `tests/integration/minor-flow.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { freshDb } from '../helpers/db';
    import { canActivate } from '@/server/auth/activate';
    import { users } from '@/server/db/schema/auth';
    import { parentChildLinks } from '@/server/db/schema/memberships';
    import { recordConsent, CURRENT_POLICY, getConsentText } from '@/lib/consent';

    describe('GDPR-02 minor gate', () => {
      it('under-16 without parent link → parent_link_missing', async () => {
        await using h = await freshDb();
        const dob = new Date(Date.now() - 14 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // ~14 years
        const [u] = await h.db.insert(users).values({ email: 'minor@vttl.test', name: 'M', dateOfBirth: dob }).returning();
        const r = await canActivate(u!.id);
        expect(r).toEqual({ ok: false, reason: 'parent_link_missing' });
      });

      it('adult without consent → consent_missing', async () => {
        await using h = await freshDb();
        const dob = new Date(Date.now() - 30 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [u] = await h.db.insert(users).values({ email: 'adult@vttl.test', name: 'A', dateOfBirth: dob }).returning();
        const r = await canActivate(u!.id);
        expect(r).toEqual({ ok: false, reason: 'consent_missing' });
      });

      it('adult with operational consent → ok', async () => {
        await using h = await freshDb();
        const dob = new Date(Date.now() - 30 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [u] = await h.db.insert(users).values({ email: 'ok@vttl.test', name: 'A', dateOfBirth: dob }).returning();
        const text = await getConsentText('operational', CURRENT_POLICY.operational.version, 'nl');
        await recordConsent({
          userId: u!.id, category: 'operational', version: CURRENT_POLICY.operational.version,
          locale: 'nl', textShown: text, ipAddress: '127.0.0.1', userAgent: 'vitest', db: h.db,
        });
        const r = await canActivate(u!.id);
        expect(r).toEqual({ ok: true });
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/lib/consent.ts && test -f src/server/auth/activate.ts && test -f drizzle/0003_users_is_minor.sql && grep -q "CURRENT_POLICY" src/lib/consent.ts && grep -q "getConsentText" src/lib/consent.ts && grep -q "recordConsent" src/lib/consent.ts && grep -q "createHash('sha256')" src/lib/consent.ts && grep -q "consentTextSha256" src/lib/consent.ts && grep -q "canActivate" src/server/auth/activate.ts && grep -q "parent_link_missing" src/server/auth/activate.ts && grep -q "parent_consent_missing" src/server/auth/activate.ts && grep -q "consent_missing" src/server/auth/activate.ts && grep -q "is_minor" drizzle/0003_users_is_minor.sql && grep -q "INTERVAL '16 years'" drizzle/0003_users_is_minor.sql && grep -q "DROP COLUMN is_minor" drizzle/0003_users_is_minor.rollback.md && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `CURRENT_POLICY` exported with 3 categories, each version='1.0.0'
    - `recordConsent` computes SHA-256 hex (64 chars) and INSERTs the row with snapshot
    - `canActivate` returns one of 4 deterministic outcomes
    - Migration 003 generated `is_minor` boolean GENERATED ALWAYS AS column with INTERVAL '16 years' check
    - Rollback file present
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Consent + minor-gate primitives implemented and tested.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: consent tRPC router + UI components (ConsentStep, ReConsentBanner) + register/consent pages</name>
  <read_first>
    - src/server/trpc/middleware/freshSession.ts (Plan 11 — protectedProcedure preset)
    - src/components/i18n/locale-switcher.tsx (Plan 08 — pattern for client components)
    - src/lib/consent.ts (just-created)
    - .planning/phases/01-fundament/01-RESEARCH.md §Registration flow (lines 1755–1764)
  </read_first>
  <files>
    src/server/trpc/routers/consent.ts
    src/server/trpc/routers/_app.ts
    src/components/consent/consent-step.tsx
    src/components/consent/re-consent-banner.tsx
    src/app/[locale]/(auth)/register/page.tsx
    src/app/[locale]/(auth)/consent/page.tsx
  </files>
  <action>
    Create `src/server/trpc/routers/consent.ts`:
    ```ts
    import { z } from 'zod';
    import { router, publicProcedure } from '../trpc';
    import { protectedProcedure } from '../middleware/freshSession';
    import { writeAudit } from '../middleware/audit';
    import { recordConsent, getConsentText, CURRENT_POLICY, type ConsentCategory } from '@/lib/consent';
    import { db as rawDb } from '@/server/db/client';
    import { consentRecords } from '@/server/db/schema/consent';
    import { parentChildLinks } from '@/server/db/schema/memberships';
    import { TRPCError } from '@trpc/server';
    import { and, eq, isNull, or } from 'drizzle-orm';
    import { consentNotifyQueue } from '@/server/workers/queues';

    const CategorySchema = z.enum(['operational', 'medical_processing', 'photo_video']);
    const LocaleSchema = z.enum(['nl', 'en', 'fr']);

    export const consentRouter = router({
      // Anonymous (during registration) — uses ctx.session OR a registration-token approach
      give: protectedProcedure
        .input(z.object({
          category: CategorySchema,
          version: z.string(),
          locale: LocaleSchema,
          textShown: z.string().min(50),  // Sanity floor — consent texts are non-trivial
          forUserId: z.string().uuid().optional(), // for parent giving on behalf of minor
        }))
        .mutation(async ({ ctx, input }) => {
          const targetUserId = input.forUserId ?? ctx.scope!.userId;
          const consentingPartyUserId = ctx.scope!.userId;
          const row = await recordConsent({
            userId: targetUserId,
            category: input.category as ConsentCategory,
            version: input.version,
            locale: input.locale,
            textShown: input.textShown,
            consentingPartyUserId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            db: ctx.db,
          });
          await writeAudit(ctx, { action: 'consent.give', resourceType: 'consent_record', resourceId: row!.id, newValues: { category: input.category, version: input.version, locale: input.locale } });
          return row;
        }),

      withdraw: protectedProcedure
        .input(z.object({ consentRecordId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
          const db = ctx.db ?? rawDb;
          const [row] = await db.update(consentRecords)
            .set({ withdrawnAt: new Date(Date.now()) })
            .where(and(eq(consentRecords.id, input.consentRecordId), isNull(consentRecords.withdrawnAt)))
            .returning();
          if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
          await writeAudit(ctx, { action: 'consent.withdraw', resourceType: 'consent_record', resourceId: row.id });
          return row;
        }),

      status: protectedProcedure
        .input(z.object({ category: CategorySchema }))
        .query(async ({ ctx, input }) => {
          const db = ctx.db ?? rawDb;
          const row = await db.query.consentRecords.findFirst({
            where: and(
              eq(consentRecords.userId, ctx.scope!.userId),
              eq(consentRecords.consentCategory, input.category),
              eq(consentRecords.policyVersion, CURRENT_POLICY[input.category as ConsentCategory].version),
              isNull(consentRecords.withdrawnAt),
            ),
          });
          return { hasConsent: !!row, row };
        }),

      listForUser: protectedProcedure
        .input(z.object({ userId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
          const db = ctx.db ?? rawDb;
          // RLS enforces: only the user themselves OR consenting party OR TD can read.
          return db.query.consentRecords.findMany({
            where: eq(consentRecords.userId, input.userId),
            orderBy: (cr, { desc }) => desc(cr.givenAt),
          });
        }),

      /** CRIT-3 (Plan 17 RBAC matrix): parent/player visibility into their own parent_child_links.
       *
       *  RLS policy `pcl_visible` (Plan 04) already permits this — a row is visible when the caller is
       *  either the parent or the child. We expose a tRPC endpoint on protectedProcedure (NOT
       *  tdProcedure) so parent and player roles can list THEIR OWN links without going through
       *  the TD-only admin path. Returns rows where parent_user_id = ctx.scope.userId OR
       *  child_user_id = ctx.scope.userId.
       *
       *  Plan 17 RBAC_EXPECTATIONS for parent_child_links: parent / player → 'allowed' (own links via this endpoint),
       *  trainer / academy_manager / sparring_partner → 'denied' (no endpoint they can call), TD → 'allowed' via
       *  admin.user.listParentLinks (Plan 15).
       */
      listMyParentLinks: protectedProcedure
        .query(async ({ ctx }) => {
          const db = ctx.db ?? rawDb;
          // RLS enforces: returns rows where caller is parent OR child.
          // We query without an explicit WHERE — RLS hides everything else. We add an explicit
          // OR clause as belt-and-braces so a misconfiguration surfaces as no-rows rather than all-rows.
          return db.query.parentChildLinks.findMany({
            where: or(
              eq(parentChildLinks.parentUserId, ctx.scope!.userId),
              eq(parentChildLinks.childUserId, ctx.scope!.userId),
            ),
          });
        }),

      /** Internal: enqueue a notify-job after a major version bump.
       *  Called by a TD-only mutation (Plan 15 admin UI exposes "bump consent version" — out of Phase 1 scope; stub here). */
      _enqueueVersionBump: protectedProcedure
        .input(z.object({ userId: z.string().uuid(), category: CategorySchema, oldVersion: z.string(), newVersion: z.string() }))
        .mutation(async ({ input }) => {
          await consentNotifyQueue.add('consent-version-bump', input);
          return { queued: true };
        }),
    });
    ```

    Update `src/server/trpc/routers/_app.ts`:
    ```ts
    import { router, publicProcedure } from '../trpc';
    import { consentRouter } from './consent';

    export const appRouter = router({
      ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
      consent: consentRouter,
      // admin: adminRouter — Plan 15 attaches
    });

    export type AppRouter = typeof appRouter;
    ```

    Create `src/components/consent/consent-step.tsx`:
    ```tsx
    'use client';
    import { useEffect, useState } from 'react';
    import { useTranslations, useLocale } from 'next-intl';
    import { Button } from '@/components/ui/button';

    interface Props {
      category: 'operational' | 'medical_processing' | 'photo_video';
      version: string;
      required?: boolean;
      onAccept: (textShown: string) => Promise<void>;
      onSkip?: () => void;
    }

    export function ConsentStep({ category, version, required, onAccept, onSkip }: Props) {
      const t = useTranslations('consent');
      const locale = useLocale();
      const [text, setText] = useState<string>('');
      const [showFull, setShowFull] = useState(false);
      const [loading, setLoading] = useState(false);

      useEffect(() => {
        fetch(`/api/consent-text?category=${category}&version=${version}&locale=${locale}`)
          .then((r) => r.text())
          .then(setText);
      }, [category, version, locale]);

      const labelKey = category === 'operational' ? 'operational' : category === 'medical_processing' ? 'medicalProcessing' : 'photoVideo';

      return (
        <section className="border rounded-md p-4 my-3">
          <h3 className="font-medium">{t(`${labelKey}.label`)}</h3>
          <button type="button" onClick={() => setShowFull((v) => !v)} className="text-sm text-blue-600 mt-2">
            {t('showFullText')}
          </button>
          {showFull && (
            <article className="mt-3 max-h-64 overflow-auto text-sm" dangerouslySetInnerHTML={{ __html: text }} />
          )}
          <div className="flex gap-2 mt-3">
            <Button
              type="button"
              disabled={loading || !text}
              onClick={async () => { setLoading(true); try { await onAccept(text); } finally { setLoading(false); } }}
            >
              {t('submit')}
            </Button>
            {!required && onSkip && (
              <Button type="button" variant="outline" onClick={onSkip}>{t('withdraw')}</Button>
            )}
          </div>
        </section>
      );
    }
    ```

    Add an API route to serve consent text (anonymous-readable since the text itself is the consent contract — no PII):
    ```ts
    // src/app/api/consent-text/route.ts
    import { NextResponse } from 'next/server';
    import { getConsentText, type ConsentCategory } from '@/lib/consent';

    export const runtime = 'nodejs';

    export async function GET(req: Request) {
      const url = new URL(req.url);
      const category = url.searchParams.get('category') as ConsentCategory | null;
      const version = url.searchParams.get('version');
      const locale = url.searchParams.get('locale') as 'nl' | 'en' | 'fr' | null;
      if (!category || !version || !locale) return new NextResponse('bad_request', { status: 400 });
      try {
        const text = await getConsentText(category, version, locale);
        return new NextResponse(text, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch {
        return new NextResponse('not_found', { status: 404 });
      }
    }
    ```

    Add this route to the file list (modify the frontmatter `files_modified`).

    Create `src/components/consent/re-consent-banner.tsx`:
    ```tsx
    'use client';
    import { useTranslations } from 'next-intl';
    import { ConsentStep } from './consent-step';
    import { CURRENT_POLICY } from '@/lib/consent';
    import { trpc } from '@/lib/trpc-client';  // Plan 15 ships this; Plan 12 documents the dependency.

    interface Props { onComplete: () => void; }

    export function ReConsentBanner({ onComplete }: Props) {
      const t = useTranslations('consent');
      const give = trpc.consent.give.useMutation();

      return (
        <div className="fixed inset-0 z-50 bg-white p-6 overflow-auto">
          <h2 className="text-xl font-semibold">{t('reConsentRequired')}</h2>
          <ConsentStep
            category="operational"
            version={CURRENT_POLICY.operational.version}
            required
            onAccept={async (text) => {
              await give.mutateAsync({
                category: 'operational',
                version: CURRENT_POLICY.operational.version,
                locale: 'nl', // current locale via useLocale() — wired in real impl
                textShown: text,
              });
              onComplete();
            }}
          />
        </div>
      );
    }
    ```

    Note: `@/lib/trpc-client` is created by Plan 15 (TD admin UI consumer). Plan 12 documents the dependency; if Plan 15 has not landed yet, the ReConsentBanner is unreachable — tolerable since requireCurrentConsent middleware (Plan 11) is the actual gate.

    Create `src/app/[locale]/(auth)/register/page.tsx` — multi-step shell:
    ```tsx
    import { getTranslations } from 'next-intl/server';
    import { RegisterForm } from '@/components/auth/register-form';

    export default async function RegisterPage() {
      const t = await getTranslations('auth.register');
      return (
        <main className="max-w-md mx-auto p-6">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('minorWarning')}</p>
          <RegisterForm />
        </main>
      );
    }
    ```

    Create `src/components/auth/register-form.tsx` (skeleton — full UI in Plan 15 expansion):
    ```tsx
    'use client';
    import { useState } from 'react';
    import { useTranslations, useLocale } from 'next-intl';
    import { signUp } from '@/server/auth/client';
    import { ConsentStep } from '@/components/consent/consent-step';
    import { CURRENT_POLICY } from '@/lib/consent';

    type Step = 'credentials' | 'consents' | 'pending';

    export function RegisterForm() {
      const t = useTranslations('auth.register');
      const locale = useLocale() as 'nl' | 'en' | 'fr';
      const [step, setStep] = useState<Step>('credentials');
      const [form, setForm] = useState({ email: '', password: '', name: '', dateOfBirth: '' });

      // Step 1: credentials → call signUp → email verification sent → user record created with active=false
      // Step 2: consents (3 categories — operational required)
      // Step 3: pending — show "check your email" or "parent must approve" depending on isMinor

      return <div>{/* full impl out of Phase-1 scope; minimum viable: route to /verify-email */}</div>;
    }
    ```

    Create `src/app/[locale]/(auth)/consent/page.tsx`:
    ```tsx
    import { ConsentStep } from '@/components/consent/consent-step';
    import { CURRENT_POLICY } from '@/lib/consent';
    import { getTranslations } from 'next-intl/server';

    export default async function ConsentPage() {
      const t = await getTranslations('consent');
      return (
        <main className="max-w-md mx-auto p-6">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          {/* Client component reads /api/consent-text for the active locale; submits via tRPC consent.give */}
        </main>
      );
    }
    ```
  </action>
  <verify>
    <automated>test -f src/server/trpc/routers/consent.ts && test -f src/components/consent/consent-step.tsx && test -f src/components/consent/re-consent-banner.tsx && test -f src/app/api/consent-text/route.ts && grep -q "consentRouter" src/server/trpc/routers/consent.ts && grep -q "consent.give\|give: protectedProcedure" src/server/trpc/routers/consent.ts && grep -q "consent.withdraw\|withdraw: protectedProcedure" src/server/trpc/routers/consent.ts && grep -q "listMyParentLinks" src/server/trpc/routers/consent.ts && grep -q "consentRouter" src/server/trpc/routers/_app.ts && grep -q "ConsentStep" src/components/consent/consent-step.tsx && grep -q "dangerouslySetInnerHTML" src/components/consent/consent-step.tsx && grep -q "ReConsentBanner" src/components/consent/re-consent-banner.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `consentRouter` defines give, withdraw, status, listForUser, listMyParentLinks (CRIT-3), _enqueueVersionBump
    - `ConsentStep` fetches text via `/api/consent-text`, renders with `dangerouslySetInnerHTML` in a contained section
    - `ReConsentBanner` is a fixed-position overlay
    - `/api/consent-text` GET returns the HTML file content
    - All Phase-1 register-flow scaffolding compiles
  </acceptance_criteria>
  <done>Consent flow + UI primitives + tRPC router complete.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Wire remaining Wave-0 RED tests (medical-audit, medical-delete, parent-child, trainer-academy, auth-reset) — admin-user.test.ts owned by Plan 15</name>
  <read_first>
    - tests/integration/*.test.ts files created in Plan 17 (RED stubs)
    - This plan's primitives (canActivate, recordConsent), Plan 11 (appCaller), Plan 03 (medical schema), Plan 04 (RLS)
  </read_first>
  <files>
    tests/integration/medical-audit.test.ts
    tests/integration/medical-delete.test.ts
    tests/integration/parent-child.test.ts
    tests/integration/trainer-academy.test.ts
    tests/integration/auth-reset.test.ts
  </files>
  <action>
    Plan 17 created RED test stubs for all of these. This task fills them in with real test bodies that exercise:

    - `medical-audit.test.ts`: insert a medical_event → assert one row appears in `medical_access_audit` with action='write' and the trigger-set actor (CRIT-7 write-time audit verification, GDPR-04 schema check; full read-time audit is Phase 5).
    - `medical-delete.test.ts`: GDPR-07 — delete medical_events for a user; assert other tables untouched (cascade rules from Plan 03).
    - `parent-child.test.ts`: USER-01 + GDPR-02 — link a parent, give parent consent for minor, then call canActivate → ok.
    - `trainer-academy.test.ts`: USER-02 — link a trainer to academies; assert academy_memberships row.
    - `auth-reset.test.ts`: AUTH-02 — invoke Better Auth password reset; assert sendEmailLocalized was called with the right template + locale (mock the Resend SDK via `vi.mock('resend')`).

    Each test follows the pattern of `tests/integration/consent.test.ts` (Task 1): use `freshDb()`, insert fixtures with `h.db.insert(...)`, exercise the unit under test, assert.

  </action>
  <verify>
    <automated>test -f tests/integration/medical-audit.test.ts && test -f tests/integration/medical-delete.test.ts && test -f tests/integration/parent-child.test.ts && test -f tests/integration/trainer-academy.test.ts && test -f tests/integration/auth-reset.test.ts && grep -q "medical_access_audit\|medicalAccessAudit" tests/integration/medical-audit.test.ts && grep -q "canActivate" tests/integration/parent-child.test.ts && grep -q "academyMemberships" tests/integration/trainer-academy.test.ts && grep -qE "sendEmailLocalized|vi\\.mock\\(['\"]resend['\"]\\)" tests/integration/auth-reset.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - All 5 test files have real test bodies (not placeholders) — admin-user.test.ts is OWNED BY PLAN 15 (MAJOR-12: no overlap)
    - medical-audit.test.ts asserts trigger-written row appears
    - parent-child.test.ts asserts canActivate flow
  </acceptance_criteria>
  <done>Wave-0 stubs filled in for everything Plan 12's primitives can verify.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: e2e walkthrough — register-with-consent (Phase 1 succescriterium #5 + #6)</name>
  <what-built>
    - Multi-step register flow with 3 consents (operational required, medical_processing optional, photo_video optional)
    - Minor gate: under-16 cannot complete activation without parent link + parent consent
    - consent-version-bump notification job (BullMQ — Plan 10)
    - tests/e2e/register-with-consent.spec.ts (Plan 17) GREEN
  </what-built>
  <how-to-verify>
    1. Run `npm run dev`. Visit `/nl/register`.
    2. Register a NEW user with DOB 1990-01-01 (adult). Submit credentials.
    3. Receive a verification email in Dutch (check Resend dashboard "Logs" tab in dev mode, or use Resend's `delivered@resend.dev` test address; in CI use the mocked SDK). Click verify link.
    4. Land on `/nl/consent`. See 3 consent boxes; expand each — full Dutch text from `consent-*-1.0.0.nl.html` rendered.
    5. Accept all 3 → land on a "Account pending TD activation" page. Verify in DB:
       - `users.email_verified = true`, `users.active = false`
       - 3 rows in `consent_records` with policy_version='1.0.0', locale='nl', non-null consent_text_snapshot, 64-char consent_text_sha256
    6. **Minor flow:** Register again with DOB = 14 years ago (e.g., 2012-05-01). After credentials step, see "Voor spelers jonger dan 16 jaar moet een ouder/voogd toestemming geven."
    7. Verify in DB: `users.is_minor = true`. Cannot activate without parent link.
    8. **Locale change:** Go through (1)–(5) in fr-BE locale; verify consent_records.locale='fr' and the snapshot contains French text.
  </how-to-verify>
  <resume-signal>Type "approved — succescriteria 5+6 met" if all 8 steps succeed; otherwise list which step failed and why.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User browser ↔ /api/consent-text | Public endpoint serves consent HTML; no PII; query params restricted to (category, version, locale) whitelist |
| Multi-step register ↔ DB | INSERTs into users + consent_records inside same transaction (Better Auth handles users; consent.give RPC handles consent_records) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-08 | Tampering | Consent record forgery / unsigned text | mitigate | sha256 of consent_text_snapshot stored at INSERT time; HTML files committed to git with version + locale in filename; mismatched sha256 → audit & reject |
| T-01-09 | Elevation of Privilege | Minor account activated without parental consent | mitigate | canActivate() checks isMinor + parent_link + parent consent row; called by Plan 15 admin.user.activate before flipping active=true |
</threat_model>

<verification>
- `npx vitest run tests/integration/consent.test.ts tests/integration/minor-flow.test.ts` GREEN
- All 6 Wave-0 stubs filled with real tests (admin-user has it.todo for Plan 15)
- Task 4 visual checkpoint approved
</verification>

<success_criteria>
- 3 consent categories × 3 locales × snapshot+sha256 covered
- Minor gate enforced
- Re-consent banner ready for D-07
- BullMQ version-bump notify job wired (uses Plan 10 queue)
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-12-SUMMARY.md` documenting:
- Migration 0003 generated and committed
- Confirmation Phase 1 succescriteria #5 + #6 verifiable end-to-end
- Note: Plan 15 attaches admin.user.* router; admin-user.test.ts todos turn into real tests there

**scope-large:** 16 files in `files_modified`. 7 of those are Wave-0 test stubs being filled in for the FIRST time (Plan 17 created them as RED skeletons; this plan supplies the real bodies). Engineering scope is ~9 files (lib/consent + activate + consent router + UI components + minor-gate migration). Acceptable; flagged here for traceability.
</output>
