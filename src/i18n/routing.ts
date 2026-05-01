/**
 * next-intl routing config — D-18 (i18n-fundament).
 *
 * Locales: nl (default), en, fr.
 * localePrefix='as-needed': default-locale URLs do NOT carry the /nl prefix
 * (clean URLs for the largest user group); en/fr require explicit /en, /fr.
 * localeDetection=true: middleware honors Accept-Language for anonymous visitors (D-02).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §next-intl App Router Setup.
 */
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['nl', 'en', 'fr'],
  defaultLocale: 'nl',
  localePrefix: { mode: 'as-needed' },
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
export const SUPPORTED_LOCALES = routing.locales;
