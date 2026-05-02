/**
 * /api/consent-text — anonymous-readable consent HTML (Plan 12).
 *
 * The consent text IS the consent contract; it has no PII and is the
 * exact bytes Plan 11's `consent_records.consent_text_snapshot`
 * captures. Serving it from a public endpoint:
 *
 *   - Lets `<ConsentStep>` (client component) fetch the text without a
 *     server-component round-trip per click.
 *   - Lets a user re-read the text they consented to from a deep link
 *     (`/api/consent-text?category=operational&version=1.0.0&locale=nl`)
 *     without authenticating — the text itself is non-sensitive.
 *   - Avoids embedding the HTML in `messages/*.json` (D-04: keep email
 *     bodies and consent texts out of the i18n catalog so non-engineers
 *     can edit them per locale without touching translation files).
 *
 * Whitelist on inputs: only the three known categories, the literal
 * `1.0.0` version (Phase 1 ships nothing else; later versions add
 * file-system entries which `getConsentText` resolves), and the three
 * supported locales. Unknown values return 400 (bad request) so a
 * fuzzer cannot probe the filesystem with `category=../../etc/passwd`.
 *
 * `runtime = 'nodejs'` — `getConsentText` reads from the filesystem via
 * `fs/promises`, which the Edge runtime does not support. Next 15
 * defaults to `nodejs` for app-router route handlers but pinning it here
 * makes the constraint visible (and survives a future global default
 * change).
 *
 * Reference: .planning/phases/01-fundament/01-12-PLAN.md Task 2;
 *            src/lib/consent.ts (getConsentText).
 */
import { NextResponse } from 'next/server';

import { getConsentText, type ConsentCategory } from '@/lib/consent';
import type { Locale } from '@/i18n/routing';

export const runtime = 'nodejs';

const KNOWN_CATEGORIES = new Set<ConsentCategory>([
  'operational',
  'medical_processing',
  'photo_video',
]);
const KNOWN_LOCALES = new Set<Locale>(['nl', 'en', 'fr']);

function isCategory(value: string | null): value is ConsentCategory {
  return value !== null && KNOWN_CATEGORIES.has(value as ConsentCategory);
}

function isLocale(value: string | null): value is Locale {
  return value !== null && KNOWN_LOCALES.has(value as Locale);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category');
  const version = url.searchParams.get('version');
  const locale = url.searchParams.get('locale');

  if (!isCategory(category) || !isLocale(locale)) {
    return new NextResponse('bad_request', { status: 400 });
  }
  // Version is the only free-form parameter (Phase 1 ships 1.0.0; later
  // versions add new on-disk files). `getConsentText` will reject any
  // version that does not have a file on disk by throwing — we collapse
  // that to 404 so the client UI can surface a "consent text unavailable
  // in your locale" state rather than a generic error.
  if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+)?$/.test(version)) {
    return new NextResponse('bad_request', { status: 400 });
  }

  try {
    const text = await getConsentText(category, version, locale);
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    return new NextResponse('not_found', { status: 404 });
  }
}
