/**
 * Locale-aware date and number formatting — I18N-07.
 *
 * date-fns 4.x ships nl-BE and en-GB but not a Belgian-French variant —
 * `fr` (metropolitan French) is used for the French UI and is fine for date
 * formatting because the Belgian/Metropolitan French differences are nominal
 * (week start, month names, weekday names are identical). The Belgian
 * thousands/decimal convention is still enforced via Intl.NumberFormat below
 * with the BCP 47 tag fr-BE.
 *
 * weekStartsOn=1 (Monday) is enforced for all three locales because Belgium
 * uses ISO-8601 week numbering universally — the nl-BE default already does
 * this; we set it explicitly so calendar code (Phase 2+) cannot accidentally
 * render Sunday-first weeks for the en/fr surfaces.
 */
import { format } from 'date-fns';
import { nlBE, enGB, fr } from 'date-fns/locale';
import type { Locale } from '@/i18n/routing';

const dateLocales = { nl: nlBE, en: enGB, fr } as const;

/**
 * Format a Date with the locale-appropriate date-fns locale.
 *
 * @param d - the Date to format
 * @param locale - one of the supported app locales (nl/en/fr)
 * @param fmt - date-fns format string; defaults to 'dd/MM/yyyy' (Belgian short date)
 */
export const formatDate = (d: Date, locale: Locale, fmt = 'dd/MM/yyyy'): string =>
  format(d, fmt, { locale: dateLocales[locale], weekStartsOn: 1 });

/**
 * Format a number with the locale-appropriate Intl region.
 * - nl → nl-BE (1.234,5)
 * - en → en-GB (1,234.5)
 * - fr → fr-BE (1 234,5 — NBSP thousands)
 */
export const formatNumber = (
  n: number,
  locale: Locale,
  opts: Intl.NumberFormatOptions = {},
): string => {
  const region = { nl: 'nl-BE', en: 'en-GB', fr: 'fr-BE' } as const;
  return new Intl.NumberFormat(region[locale], opts).format(n);
};

/** Constant for date-fns weekStartsOn — Monday per ISO-8601 / Belgian convention. */
export const WEEK_STARTS_ON_MONDAY = 1 as const;
