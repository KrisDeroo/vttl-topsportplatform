/**
 * next-intl server-side message loader — wired by next.config.ts via
 * createNextIntlPlugin('./src/i18n/request.ts').
 *
 * Implements the I18N-03 resolution chain:
 *   1. requestLocale (URL segment, set by middleware on /en, /fr; absent on /nl)
 *   2. session cookie 'locale' (anonymous switcher — D-02)
 *   3. Accept-Language header (already factored by next-intl's localeDetection)
 *   4. user.preferred_locale via Better Auth session — wired in Plan 11
 *      (CallerContext) once the session adapter exists. Until then `userPref`
 *      stays null and we rely on cookie + header. After Plan 08 the locale
 *      switcher writes the cookie AND persists to users.preferred_locale, so
 *      the cookie value already reflects DB state for logged-in users.
 *
 * Dev/prod fallback split (D-20):
 *   - dev: throw on missing translation; getMessageFallback returns
 *     'MISSING_KEY:nl.auth.foo' so the broken key is visible in the UI
 *   - prod: silent locale → nl → key fallback (graceful degradation)
 *
 * timeZone='Europe/Brussels' for all locales — single tenancy, single timezone.
 */
import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { cookies, headers } from 'next/headers';
import { routing, type Locale } from './routing';
import { resolveLocale } from './resolve';

export default getRequestConfig(async ({ requestLocale }) => {
  // Step 0: middleware-detected locale (URL segment). Note that
  // `next-intl` middleware reports the URL-segment locale ONLY when a
  // locale-prefix is explicitly present in the path (e.g. `/en/x`,
  // `/fr/x`); for default-locale URLs without a prefix (e.g. `/x` →
  // implicit `nl`) `requestLocale` is `undefined`. Plan 07 routing
  // pattern is `as-needed`, so this distinction is load-bearing for
  // the WR-08 fix below.
  const requestedRaw = await requestLocale;
  const urlHasExplicitLocale = hasLocale(routing.locales, requestedRaw);
  const urlLocale: Locale | null = urlHasExplicitLocale
    ? (requestedRaw as Locale)
    : null;

  const hdrs = await headers();
  const cookieStore = await cookies();
  const acceptLanguage = hdrs.get('accept-language');
  const cookieLocale = cookieStore.get('locale')?.value ?? null;

  // User preference: Better Auth session adapter is wired in Plan 11 (CallerContext).
  // Today the cookie value already reflects users.preferred_locale once Plan 08's
  // server action persists the switcher selection, so cookie acts as the cached pref.
  let userPref: string | null = null;
  try {
    const sessionToken = cookieStore.get('better-auth.session_token')?.value;
    if (sessionToken) {
      // Placeholder — Plan 11 replaces this with: getUserPreferredLocale(sessionToken)
      userPref = null;
    }
  } catch {
    // Defensive: cookie store unavailable on some edge-runtime paths
  }

  const resolved = (await resolveLocale({
    acceptLanguage,
    cookie: cookieLocale,
    userPref,
  })) as Locale;

  // WR-08 fix (2026-05-01): URL-priority is honoured for ANY explicit
  // locale segment in the path, including the default locale. The
  // previous predicate (`locale !== routing.defaultLocale`) excluded
  // explicit `/nl/...` URLs from URL-priority, so a user clicking a
  // `/foo` link with `cookie=en` saw English on what was actually a
  // Dutch URL — the docstring claimed "URL is explicit user intent"
  // but the implementation contradicted it. We now distinguish:
  //   * URL has an explicit locale segment → URL wins (urlLocale)
  //   * URL is locale-less (the as-needed default) → defer to the
  //     resolution chain (cookie / Accept-Language / userPref)
  const final: Locale = urlLocale ?? resolved;

  const messages = (await import(`../../messages/${final}.json`)).default;

  return {
    locale: final,
    messages,
    onError(err: unknown) {
      // D-20: dev fail-loud; prod swallows so a single missing key never 500s.
      if (process.env.NODE_ENV !== 'production') throw err;
    },
    getMessageFallback({ namespace, key }: { namespace?: string; key: string }) {
      const path = namespace ? `${namespace}.${key}` : key;
      if (process.env.NODE_ENV !== 'production') return `MISSING_KEY:${final}.${path}`;
      return path;
    },
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
        long: {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
      number: {
        precise: { maximumFractionDigits: 5 },
      },
    },
    timeZone: 'Europe/Brussels',
  };
});
