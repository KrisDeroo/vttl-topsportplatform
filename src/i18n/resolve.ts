/**
 * Locale resolution chain — I18N-03.
 *
 * Pure function (no I/O, no Next.js runtime imports) so it is unit-testable
 * and reusable from middleware, getRequestConfig, server actions, and tests.
 *
 * Resolution order (highest priority first):
 *   1. explicit user preference (DB users.preferred_locale, looked up via session — Plan 11/08)
 *   2. session cookie 'locale' (anonymous switcher — D-02)
 *   3. Accept-Language header (highest q-weight whose primary tag is supported)
 *   4. default 'nl' (D-02 fallback)
 *
 * Unsupported codes (e.g. 'de') fall through to the next signal.
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §G (D-18, D-19, D-20).
 */
import { routing, type Locale, SUPPORTED_LOCALES } from './routing';

function isLocale(s: unknown): s is Locale {
  return typeof s === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(s);
}

/**
 * Parse RFC 7231 Accept-Language header. Sorts by q-weight (default 1.0),
 * then returns the first supported primary tag. Returns null if no tag matches.
 *
 * Examples:
 *   'fr-BE,fr;q=0.9,en;q=0.8' → 'fr'  (fr wins on q=1.0)
 *   'en;q=0.5,fr;q=0.9'       → 'fr'  (fr wins on q=0.9)
 *   'de-DE,de;q=0.9'          → null  (no supported locale)
 */
function parseAcceptLanguage(header: string | undefined | null): Locale | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((s) => {
      const [tag, q] = s.trim().split(';q=');
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q) : 1.0 };
    })
    .filter((p) => p.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const p of parts) {
    const primary = p.tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

export interface ResolveLocaleArgs {
  acceptLanguage?: string | null | undefined;
  cookie?: string | null | undefined;
  userPref?: string | null | undefined;
}

/**
 * Resolve the effective locale for a request following the I18N-03 chain.
 *
 * Async signature so future implementations can lazy-load user preference from
 * DB (Plan 08 wires this once Better Auth is live). Today the function is sync
 * in spirit; callers `await` it to avoid breaking changes when DB lookup lands.
 */
export async function resolveLocale(args: ResolveLocaleArgs): Promise<Locale> {
  if (isLocale(args.userPref)) return args.userPref;
  if (isLocale(args.cookie)) return args.cookie;
  const fromHeader = parseAcceptLanguage(args.acceptLanguage);
  if (fromHeader) return fromHeader;
  return routing.defaultLocale;
}
