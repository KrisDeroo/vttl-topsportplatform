/**
 * setUserLocale Server Action — D-02 persistence flow.
 *
 * Locale resolution chain (src/i18n/resolve.ts) consults, in order:
 *   1. users.preferred_locale (logged-in user)
 *   2. cookie 'locale' (anonymous switcher)
 *   3. Accept-Language header
 *   4. defaultLocale ('nl')
 *
 * This action is the single write-side that feeds steps 1 + 2:
 *   - ALWAYS writes the 'locale' cookie so subsequent requests resolve quickly
 *     and the client UI reflects the choice without a roundtrip
 *   - When a Better Auth session is present, ALSO updates users.preferred_locale
 *     so transactional emails (Plan 06 sendEmailLocalized) and the next login
 *     from another device land in the user's chosen language
 *
 * Trust boundary (T-01-LOCALE-TAMPER):
 *   The locale parameter is validated against SUPPORTED_LOCALES from
 *   '@/i18n/routing' BEFORE any cookie is written or DB row mutated. Any
 *   value outside 'nl' | 'en' | 'fr' raises 'locale_unsupported'. The cookie
 *   is unsigned but only drives UI rendering — no privilege depends on its
 *   value, so signing is unnecessary (validation is sufficient).
 *
 * Cookie attributes (per Plan 08 plan + SEC-01 alignment):
 *   - path '/'           — applies to all routes
 *   - sameSite 'lax'     — allowed on top-level navigation, blocks CSRF
 *   - secure (in prod)   — HTTPS-only off staging/prod boxes
 *   - maxAge 1 year      — D-02: persist across sessions
 *   - NOT httpOnly       — the LocaleSwitcher reads it client-side for
 *                          immediate UI feedback (and resolveLocale on the
 *                          server reads it via cookies() either way)
 *
 * Reference:
 *   - .planning/phases/01-fundament/01-CONTEXT.md §A (D-01, D-02, D-03)
 *   - .planning/phases/01-fundament/01-08-PLAN.md must_haves
 */
'use server';

import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';

import type { Locale } from '@/i18n/routing';
import { SUPPORTED_LOCALES } from '@/i18n/routing';
import { auth } from '@/server/auth/auth';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema/auth';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface SetUserLocaleResult {
  ok: true;
  /** True if the user is logged in and the DB column was updated. */
  persistedToDb: boolean;
}

/**
 * Persist the user's locale choice. See file header for the full contract.
 *
 * @throws Error('locale_unsupported') for any value outside SUPPORTED_LOCALES.
 */
export async function setUserLocale(locale: Locale): Promise<SetUserLocaleResult> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    throw new Error('locale_unsupported');
  }

  // Step 1: anonymous fast path — write the cookie so immediate page loads
  // and unauthenticated visitors keep their pick across requests.
  const cookieStore = await cookies();
  cookieStore.set('locale', locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ONE_YEAR_SECONDS,
  });

  // Step 2: logged-in path — persist to users.preferred_locale so emails
  // (Plan 06) and other-device logins honor the choice.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) {
    await db
      .update(users)
      .set({ preferredLocale: locale })
      .where(eq(users.id, session.user.id));
    return { ok: true, persistedToDb: true };
  }

  return { ok: true, persistedToDb: false };
}
