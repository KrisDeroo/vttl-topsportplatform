---
phase: 01-fundament
plan: 07
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/i18n/routing.ts
  - src/i18n/request.ts
  - src/i18n/navigation.ts
  - src/i18n/resolve.ts
  - src/middleware.ts
  - src/lib/i18n-format.ts
  - messages/nl.json
  - messages/en.json
  - messages/fr.json
  - public/locales/consent-operational-1.0.0.nl.html
  - public/locales/consent-operational-1.0.0.en.html
  - public/locales/consent-operational-1.0.0.fr.html
  - public/locales/consent-medical_processing-1.0.0.nl.html
  - public/locales/consent-medical_processing-1.0.0.en.html
  - public/locales/consent-medical_processing-1.0.0.fr.html
  - public/locales/consent-photo_video-1.0.0.nl.html
  - public/locales/consent-photo_video-1.0.0.en.html
  - public/locales/consent-photo_video-1.0.0.fr.html
  - tests/unit/intl-format.test.ts
autonomous: true
requirements:
  - I18N-03
  - I18N-07
requirements_supports:  # informational — primary owners listed below
  - I18N-01
  - I18N-02
  - I18N-05
  - I18N-09
threat_refs:
  - T-01-08
tags:
  - phase-1
  - i18n
  - next-intl
  - locale

must_haves:
  truths:
    - "next-intl routing defines locales=['nl','en','fr'], defaultLocale='nl', localePrefix='as-needed'"
    - "locale resolution chain: explicit user preference (DB) → session cookie → Accept-Language → 'nl' (I18N-03)"
    - "messages/nl.json, en.json, fr.json exist with auth/registration/consent/error keys (Phase 1 surface)"
    - "Dev fallback fails LOUD (renders MISSING_KEY:nl.foo.bar); prod fallback graceful (locale → nl → key) — D-20"
    - "Intl/date-fns config: nl-BE, en-GB, fr-BE; weekStartsOn=1 (Monday) — I18N-07"
    - "9 consent HTML files committed to public/locales/ (3 categories × 3 locales) — D-04..06"
    - "Consent texts (9 HTML files: operational/medical_processing/photo_video × nl/en/fr) ship as team-drafted v1.0.0 — legal review tracked at Phase 8 release-gate (RISK-I18N-LEGAL); not blocking for Phase 1"
  artifacts:
    - path: "src/i18n/routing.ts"
      provides: "defineRouting({ locales, defaultLocale: 'nl', localePrefix: 'as-needed', localeDetection: true })"
      contains: "defineRouting"
    - path: "src/i18n/request.ts"
      provides: "getRequestConfig with full resolution chain + dev/prod onError split + getMessageFallback"
      contains: "getMessageFallback"
    - path: "src/i18n/resolve.ts"
      provides: "resolveLocale({ acceptLanguage, cookie, userPref }) — testable pure function (consumed by tests/integration/locale-resolve.test.ts)"
      exports: ["resolveLocale"]
    - path: "src/middleware.ts"
      provides: "next-intl middleware mounted at all non-api paths"
      contains: "createMiddleware"
    - path: "messages/nl.json"
      provides: "Dutch source-of-truth catalog for Phase 1 surface"
      contains: "auth"
    - path: "src/lib/i18n-format.ts"
      provides: "formatDate(date, locale) using nl-BE/en-GB/fr-BE with weekStartsOn=1"
      exports: ["formatDate", "formatNumber"]
  key_links:
    - from: "src/i18n/request.ts"
      to: "src/server/db/client.ts (Plan 02)"
      via: "user-pref lookup uses session cookie → Better Auth → users.preferred_locale"
      pattern: "preferredLocale"
    - from: "src/middleware.ts"
      to: "src/i18n/routing.ts"
      via: "createMiddleware(routing)"
      pattern: "createMiddleware"
---

<objective>
Stand up next-intl App Router infrastructure: routing config, server-side message loader with the 4-step resolution chain (I18N-03), middleware, locale-specific date/number formatting (I18N-07), and the three message catalogs (`messages/nl.json` / `en.json` / `fr.json`) covering Phase 1's auth/registration/consent/error chrome surface (D-18).

Per the updated D-04 (no hard legal-signoff gate before migration 001), this plan ships **team-drafted consent HTML files** versioned as `1.0.0`. If legal review at Phase 8 requires wording changes, bump to `1.0.1` (patch) or `1.1.0` (substantive). RISK-I18N-LEGAL is documented but no longer blocking for Phase 1.

Scope: `auth`, `register`, `consent`, `errors`, `lookups`, `common` keys. Domain strings (player, training, tournament) come per-phase as features land (I18N-05/06/08 in Phase 2+).

Output: complete next-intl wiring + 9 consent HTML files (3 categories × 3 locales) + 3 message catalogs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: routing.ts + navigation.ts + resolve.ts (locale resolution chain)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §next-intl App Router Setup → Routing config (lines 1346–1359)
    - .planning/phases/01-fundament/01-RESEARCH.md §Server-side message loader (lines 1361–1423)
    - .planning/phases/01-fundament/01-CONTEXT.md §G (D-18, D-19, D-20)
    - tests/integration/locale-resolve.test.ts (Plan 17 — RED until this plan)
  </read_first>
  <files>
    src/i18n/routing.ts
    src/i18n/navigation.ts
    src/i18n/resolve.ts
    tests/integration/locale-resolve.test.ts
  </files>
  <behavior>
    - resolveLocale({ acceptLanguage: undefined, cookie: undefined, userPref: undefined }) → 'nl'
    - resolveLocale({ acceptLanguage: 'fr-BE,fr;q=0.9' }) → 'fr'
    - resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en' }) → 'en'
    - resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en', userPref: 'nl' }) → 'nl'
    - Unsupported codes (e.g. 'de') → fallback to 'nl'
  </behavior>
  <action>
    Create `src/i18n/routing.ts`:
    ```ts
    import { defineRouting } from 'next-intl/routing';

    export const routing = defineRouting({
      locales: ['nl', 'en', 'fr'],
      defaultLocale: 'nl',
      localePrefix: { mode: 'as-needed' },
      localeDetection: true,
    });

    export type Locale = (typeof routing.locales)[number];
    export const SUPPORTED_LOCALES = routing.locales;
    ```

    Create `src/i18n/navigation.ts`:
    ```ts
    import { createNavigation } from 'next-intl/navigation';
    import { routing } from './routing';

    export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
    ```

    Create `src/i18n/resolve.ts` (pure function, fully unit-testable):
    ```ts
    import { routing, type Locale, SUPPORTED_LOCALES } from './routing';

    function isLocale(s: unknown): s is Locale {
      return typeof s === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(s);
    }

    function parseAcceptLanguage(header: string | undefined | null): Locale | null {
      if (!header) return null;
      // Parse "fr-BE,fr;q=0.9,en;q=0.8" — pick highest q-weight whose primary tag is supported.
      const parts = header.split(',').map((s) => {
        const [tag, q] = s.trim().split(';q=');
        return { tag: tag!.toLowerCase(), q: q ? Number(q) : 1.0 };
      }).sort((a, b) => b.q - a.q);
      for (const p of parts) {
        const primary = p.tag.split('-')[0];
        if (isLocale(primary)) return primary as Locale;
      }
      return null;
    }

    export interface ResolveLocaleArgs {
      acceptLanguage?: string | null;
      cookie?: string | null;
      userPref?: string | null;
    }

    /** Locale resolution chain (I18N-03):
     *  1. explicit user preference (DB users.preferred_locale)
     *  2. session cookie (anonymous switcher)
     *  3. Accept-Language header
     *  4. default 'nl'
     */
    export function resolveLocale(args: ResolveLocaleArgs): Locale {
      if (isLocale(args.userPref)) return args.userPref as Locale;
      if (isLocale(args.cookie)) return args.cookie as Locale;
      const al = parseAcceptLanguage(args.acceptLanguage);
      if (al) return al;
      return routing.defaultLocale as Locale;
    }
    ```

    Update `tests/integration/locale-resolve.test.ts` (originally written RED in Plan 17 — now should pass):
    ```ts
    import { describe, it, expect } from 'vitest';
    import { resolveLocale } from '@/i18n/resolve';

    describe('I18N-03 locale resolution chain', () => {
      it('falls back to nl when no signal', () => {
        expect(resolveLocale({})).toBe('nl');
      });
      it('parses fr-BE,fr;q=0.9 → fr', () => {
        expect(resolveLocale({ acceptLanguage: 'fr-BE,fr;q=0.9' })).toBe('fr');
      });
      it('cookie overrides Accept-Language', () => {
        expect(resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en' })).toBe('en');
      });
      it('user pref overrides cookie', () => {
        expect(resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en', userPref: 'nl' })).toBe('nl');
      });
      it('unsupported locale (de) falls through to next signal', () => {
        expect(resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9' })).toBe('nl');
      });
      it('q-weight selection (en;q=0.5,fr;q=0.9 → fr)', () => {
        expect(resolveLocale({ acceptLanguage: 'en;q=0.5,fr;q=0.9' })).toBe('fr');
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/i18n/routing.ts && test -f src/i18n/navigation.ts && test -f src/i18n/resolve.ts && grep -q "locales: \['nl', 'en', 'fr'\]" src/i18n/routing.ts && grep -q "defaultLocale: 'nl'" src/i18n/routing.ts && grep -q "as-needed" src/i18n/routing.ts && grep -q "createNavigation" src/i18n/navigation.ts && grep -q "resolveLocale" src/i18n/resolve.ts && grep -q "userPref" src/i18n/resolve.ts && grep -q "parseAcceptLanguage" src/i18n/resolve.ts && npx vitest run tests/integration/locale-resolve.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/i18n/routing.ts` declares all 3 locales, defaultLocale='nl', localePrefix='as-needed', localeDetection=true
    - `src/i18n/resolve.ts` exports pure `resolveLocale` function honoring the 4-step chain
    - All 6 tests in `tests/integration/locale-resolve.test.ts` pass GREEN
  </acceptance_criteria>
  <done>Locale resolution chain implemented as pure function; routing config matches D-18.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: getRequestConfig + middleware + i18n-format helpers (date/number per locale)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Server-side message loader (lines 1361–1423)
    - .planning/phases/01-fundament/01-RESEARCH.md §Locale-specific date formats (lines 1425–1437)
    - .planning/phases/01-fundament/01-RESEARCH.md §Middleware (lines 1439–1450)
    - src/i18n/routing.ts (just-created)
  </read_first>
  <files>
    src/i18n/request.ts
    src/middleware.ts
    src/lib/i18n-format.ts
    tests/unit/intl-format.test.ts
  </files>
  <behavior>
    - Test 1 (unit): formatDate(date, 'nl', 'dd/MM/yyyy') uses nl-BE locale and weekStartsOn=1
    - Test 2 (unit): formatDate(date, 'fr', 'dd/MM/yyyy') uses fr-BE locale
    - Test 3 (unit): formatDate(date, 'en', 'dd/MM/yyyy') uses en-GB locale
    - Test 4 (unit): formatNumber(1234.5, 'nl') returns '1.234,5' (Belgian/Dutch comma)
    - Test 5 (unit): formatNumber(1234.5, 'en') returns '1,234.5' (UK)
  </behavior>
  <action>
    Create `src/i18n/request.ts`:
    ```ts
    import { getRequestConfig } from 'next-intl/server';
    import { hasLocale } from 'next-intl';
    import { cookies, headers } from 'next/headers';
    import { routing, type Locale } from './routing';
    import { resolveLocale } from './resolve';

    export default getRequestConfig(async ({ requestLocale }) => {
      let locale = await requestLocale;
      if (!hasLocale(routing.locales, locale)) locale = routing.defaultLocale;

      const hdrs = await headers();
      const cookieStore = await cookies();
      const acceptLanguage = hdrs.get('accept-language');
      const cookieLocale = cookieStore.get('locale')?.value ?? null;

      // User preference: read from Better Auth session (lazy import — avoid circular dep)
      let userPref: string | null = null;
      try {
        const sessionToken = cookieStore.get('better-auth.session_token')?.value;
        if (sessionToken) {
          // Plan 11 (CallerContext) provides a helper; for now we leave userPref null and rely on cookie+header.
          // Plan 08 wires the post-login persistence — at that point users.preferred_locale becomes
          // the session-cookie value via a server action, so cookieLocale already reflects it.
        }
      } catch {}

      const resolved = resolveLocale({ acceptLanguage, cookie: cookieLocale, userPref }) as Locale;

      const messages = (await import(`../../messages/${resolved}.json`)).default;

      return {
        locale: resolved,
        messages,
        onError(err: unknown) {
          if (process.env.NODE_ENV !== 'production') throw err;  // D-20: dev fail-loud
        },
        getMessageFallback({ namespace, key }: { namespace?: string; key: string }) {
          const path = namespace ? `${namespace}.${key}` : key;
          if (process.env.NODE_ENV !== 'production') return `MISSING_KEY:${resolved}.${path}`;
          return path;
        },
        formats: {
          dateTime: {
            short: { day: 'numeric', month: 'short', year: 'numeric' },
            long:  { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
          },
        },
        timeZone: 'Europe/Brussels',
      };
    });
    ```

    Update `src/middleware.ts` (Plan 01 placeholder):
    ```ts
    import createMiddleware from 'next-intl/middleware';
    import { routing } from '@/i18n/routing';

    export default createMiddleware(routing);

    export const config = {
      matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
    };
    ```

    Create `src/lib/i18n-format.ts`:
    ```ts
    import { format } from 'date-fns';
    import { nlBE, enGB, frBE } from 'date-fns/locale';
    import type { Locale } from '@/i18n/routing';

    const dateLocales = { nl: nlBE, en: enGB, fr: frBE } as const;

    export const formatDate = (d: Date, locale: Locale, fmt = 'dd/MM/yyyy') =>
      format(d, fmt, { locale: dateLocales[locale], weekStartsOn: 1 });

    /** Locale-aware number formatting. Uses Intl with BE/GB region to honor decimal separator conventions. */
    export const formatNumber = (n: number, locale: Locale, opts: Intl.NumberFormatOptions = {}) => {
      const region = { nl: 'nl-BE', en: 'en-GB', fr: 'fr-BE' } as const;
      return new Intl.NumberFormat(region[locale], opts).format(n);
    };

    export const WEEK_STARTS_ON_MONDAY = 1 as const;
    ```

    Write `tests/unit/intl-format.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { formatDate, formatNumber } from '@/lib/i18n-format';

    describe('I18N-07 — Intl/date-fns format', () => {
      const ref = new Date('2026-05-01T10:00:00Z');

      it('formatDate uses nl-BE for nl locale', () => {
        expect(formatDate(ref, 'nl', 'dd/MM/yyyy')).toBe('01/05/2026');
      });
      it('formatDate uses en-GB for en locale', () => {
        expect(formatDate(ref, 'en', 'dd/MM/yyyy')).toBe('01/05/2026');
      });
      it('formatDate uses fr-BE for fr locale', () => {
        expect(formatDate(ref, 'fr', 'dd/MM/yyyy')).toBe('01/05/2026');
      });
      it('formatNumber nl returns 1.234,5', () => {
        // Belgian/Dutch decimal: thousands separator '.' and decimal ','
        expect(formatNumber(1234.5, 'nl')).toMatch(/1\.234,5|1 234,5/);
      });
      it('formatNumber en returns 1,234.5', () => {
        expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
      });
      it('formatNumber fr returns 1 234,5 (NBSP) or 1 234,5', () => {
        expect(formatNumber(1234.5, 'fr')).toMatch(/1[\s  ]234,5/);
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/i18n/request.ts && test -f src/middleware.ts && test -f src/lib/i18n-format.ts && grep -q "getRequestConfig" src/i18n/request.ts && grep -q "MISSING_KEY:" src/i18n/request.ts && grep -q "createMiddleware" src/middleware.ts && grep -q "weekStartsOn: 1" src/lib/i18n-format.ts && grep -q "nlBE" src/lib/i18n-format.ts && grep -q "frBE" src/lib/i18n-format.ts && grep -q "enGB" src/lib/i18n-format.ts && npx vitest run tests/unit/intl-format.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/i18n/request.ts` returns config with `onError` that throws in dev (D-20 fail-loud)
    - `getMessageFallback` returns `MISSING_KEY:${locale}.${path}` in dev
    - `src/middleware.ts` uses `createMiddleware(routing)` with the matcher excluding api/_next
    - `src/lib/i18n-format.ts` exports `formatDate` and `formatNumber` keyed by locale
    - `tests/unit/intl-format.test.ts` passes (6 tests GREEN)
  </acceptance_criteria>
  <done>next-intl wired; dev fallback fails loud; date/number formatters per locale GREEN.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Message catalogs nl.json + en.json + fr.json (Phase 1 surface)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §messages/nl.json minimum surface (lines 1491–1528)
    - .planning/phases/01-fundament/01-CONTEXT.md §G (D-18 — Phase 1 surface scope: auth/registratie/consent/error chrome)
  </read_first>
  <files>
    messages/nl.json
    messages/en.json
    messages/fr.json
  </files>
  <action>
    Create `messages/nl.json` exactly per RESEARCH:
    ```json
    {
      "auth": {
        "login": { "title": "Inloggen", "email": "E-mailadres", "password": "Wachtwoord", "submit": "Aanmelden", "forgot": "Wachtwoord vergeten?" },
        "register": { "title": "Account aanmaken", "name": "Naam", "dateOfBirth": "Geboortedatum", "submit": "Registreren", "minorWarning": "Voor spelers jonger dan 16 jaar moet een ouder/voogd toestemming geven." },
        "resetPassword": { "title": "Wachtwoord opnieuw instellen", "submit": "Verzend e-mail", "newPassword": "Nieuw wachtwoord", "confirmPassword": "Bevestig wachtwoord" },
        "verifyEmail": { "title": "Bevestig je e-mailadres", "instructions": "We hebben een bevestigingsmail gestuurd naar {email}.", "resend": "Stuur opnieuw" },
        "errors": {
          "invalidCredentials": "Onjuiste e-mail of wachtwoord",
          "lockoutTriggered": "Te veel mislukte pogingen. Probeer over 15 minuten opnieuw.",
          "sessionExpired": "Je sessie is verlopen. Log opnieuw in.",
          "rateLimited": "Te veel verzoeken. Wacht een minuut.",
          "emailNotVerified": "Bevestig eerst je e-mailadres.",
          "accountInactive": "Je account is nog niet geactiveerd. Neem contact op met de Technisch Directeur.",
          "minorPendingParent": "Account wacht op toestemming van ouder/voogd."
        }
      },
      "consent": {
        "title": "Toestemmingen",
        "operational": { "label": "Operationele gegevens (verplicht)", "version": "1.0.0" },
        "medicalProcessing": { "label": "Medische gegevensverwerking (optioneel)", "version": "1.0.0" },
        "photoVideo": { "label": "Foto- en videogebruik (optioneel)", "version": "1.0.0" },
        "submit": "Akkoord en doorgaan",
        "withdraw": "Toestemming intrekken",
        "reConsentRequired": "De voorwaarden zijn bijgewerkt. Bevestig opnieuw om door te gaan.",
        "showFullText": "Volledige tekst tonen"
      },
      "lookups": {
        "status": { "status_a": "A-status", "status_b": "B-status", "status_c": "C-status" },
        "academy": { "topsportschool": "Topsportschool", "academy_antwerpen": "Academy Antwerpen" },
        "trainingType": { "training_type_group": "Groep", "training_type_individual": "Individueel", "training_type_physical": "Fysiek", "training_type_mental": "Mentaal" },
        "tournamentType": { "tournament_wtt": "WTT", "tournament_wtt_star": "WTT Star", "tournament_ettu": "ETTU", "tournament_ejk": "EJK", "tournament_wk": "WK", "tournament_internationaal": "Internationaal", "tournament_belgium": "België" },
        "rankingType": { "ranking_senior_world": "Wereldranking Senior", "ranking_youth_world": "Wereldranking Jeugd", "ranking_senior_european": "Europees Senior", "ranking_youth_european": "Europees Jeugd", "ranking_belgium": "België" },
        "organisation": { "org_private": "Privé", "org_kbttb": "KBTTB", "org_topsportschool": "Topsportschool", "org_academy": "Academie", "org_provincial": "Provinciaal", "org_club": "Club" },
        "outcomeLevel": { "outcome_winner": "Winnaar", "outcome_finalist": "Finalist", "outcome_last_4": "Laatste 4", "outcome_last_8": "Laatste 8", "outcome_last_16": "Laatste 16", "outcome_last_32": "Laatste 32", "outcome_last_64": "Laatste 64", "outcome_last_128": "Laatste 128", "outcome_group_phase": "Groepsfase" }
      },
      "common": {
        "save": "Opslaan", "cancel": "Annuleren", "delete": "Verwijderen", "edit": "Bewerken",
        "loading": "Bezig met laden...", "submit": "Verzenden",
        "yes": "Ja", "no": "Nee", "confirm": "Bevestigen", "back": "Terug"
      },
      "nav": {
        "dashboard": "Dashboard", "calendar": "Kalender", "players": "Spelers", "trainers": "Trainers",
        "settings": "Instellingen", "logout": "Uitloggen", "language": "Taal"
      },
      "errors": {
        "generic": "Er ging iets mis. Probeer het opnieuw.",
        "forbidden": "Je hebt geen toegang tot deze pagina.",
        "notFound": "Pagina niet gevonden.",
        "validationFailed": "De gegevens zijn niet correct ingevuld.",
        "csrfRejected": "Verzoek geweigerd om veiligheidsredenen."
      },
      "admin": {
        "users": {
          "title": "Gebruikersbeheer",
          "create": "Nieuwe gebruiker", "activate": "Activeren", "deactivate": "Deactiveren",
          "assignRole": "Rol toewijzen", "linkParent": "Ouder koppelen", "linkAcademy": "Academie koppelen",
          "fields": { "email": "E-mail", "name": "Naam", "role": "Rol", "status": "Status", "locale": "Taal" }
        }
      }
    }
    ```

    Create `messages/en.json` mirroring the structure with English translations of every key. Do NOT translate proper nouns (`Topsportschool`, `Academy Antwerpen` keep their Dutch names per I18N-06).

    Create `messages/fr.json` mirroring the structure with French translations. Same proper-noun rule.

    Validate: every key path in `nl.json` exists in both `en.json` and `fr.json` with a non-empty string. Run a quick check via:
    ```bash
    node -e "
      const nl = require('./messages/nl.json');
      const en = require('./messages/en.json');
      const fr = require('./messages/fr.json');
      function flatten(o, p='') { return Object.entries(o).flatMap(([k,v]) => typeof v === 'object' ? flatten(v, p+k+'.') : [p+k]); }
      const nlKeys = flatten(nl);
      const enKeys = flatten(en);
      const frKeys = flatten(fr);
      const missingEn = nlKeys.filter(k => !enKeys.includes(k));
      const missingFr = nlKeys.filter(k => !frKeys.includes(k));
      if (missingEn.length || missingFr.length) {
        console.error('MISSING:', { missingEn, missingFr });
        process.exit(1);
      }
      console.log('OK — all', nlKeys.length, 'keys present in nl, en, fr');
    "
    ```
  </action>
  <verify>
    <automated>test -f messages/nl.json && test -f messages/en.json && test -f messages/fr.json && python3 -c "import json; nl=json.load(open('messages/nl.json')); en=json.load(open('messages/en.json')); fr=json.load(open('messages/fr.json')); flatten=lambda o,p='': [p+k if not isinstance(v,dict) else None for k,v in o.items() for _ in [0]] if False else __import__('itertools').chain.from_iterable([[p+k] if not isinstance(v,dict) else flatten(v, p+k+'.') for k,v in o.items()]); nlk=set(flatten(nl)); enk=set(flatten(en)); frk=set(flatten(fr)); assert nlk == enk and nlk == frk, f'mismatch: en-missing={nlk-enk}, fr-missing={nlk-frk}'; print('OK', len(nlk), 'keys')" && grep -q "Inloggen" messages/nl.json && grep -q "Bevestig je e-mailadres" messages/nl.json && grep -q "Verify your email" messages/en.json && grep -q "Confirmez votre adresse" messages/fr.json && grep -q "Topsportschool" messages/en.json && grep -q "Topsportschool" messages/fr.json</automated>
  </verify>
  <acceptance_criteria>
    - All 3 message files exist with the same key set (no missing keys)
    - `nl.json` contains "Inloggen" (login title), "Bevestig je e-mailadres" (verify-email title)
    - `en.json` contains "Verify your email"
    - `fr.json` contains "Confirmez votre adresse"
    - `Topsportschool` (proper noun) appears identically in all 3 files (I18N-06)
    - Total key count >= 60 (Phase 1 surface)
  </acceptance_criteria>
  <done>3 message catalogs in lockstep; proper-noun rule honored.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Consent HTML files (3 categories × 3 locales = 9 files) — gated on Task 0 sign-off</name>
  <read_first>
    - Task 0 outcome (signal "approved — proceed", "approved with placeholders", or "blocked — postpone")
    - .planning/phases/01-fundament/01-CONTEXT.md §B (D-04 NL hard gate; D-05 EN/FR by Phase 8; D-06 snapshot)
    - .planning/phases/01-fundament/01-RESEARCH.md File-tree (lines 261–264 — public/locales/ paths)
  </read_first>
  <files>
    public/locales/consent-operational-1.0.0.nl.html
    public/locales/consent-operational-1.0.0.en.html
    public/locales/consent-operational-1.0.0.fr.html
    public/locales/consent-medical_processing-1.0.0.nl.html
    public/locales/consent-medical_processing-1.0.0.en.html
    public/locales/consent-medical_processing-1.0.0.fr.html
    public/locales/consent-photo_video-1.0.0.nl.html
    public/locales/consent-photo_video-1.0.0.en.html
    public/locales/consent-photo_video-1.0.0.fr.html
  </files>
  <action>
    Skip ENTIRELY if Task 0 returned "blocked — postpone".

    For "approved — proceed" or "approved with placeholders":
    Create the 9 HTML files. Each is a self-contained `<article>` element (no `<html>` or `<body>`) — they are loaded by `getConsentText()` (Plan 12) and rendered inside the consent step UI.

    Naming convention (file path):
    `public/locales/consent-{category}-{semver}.{locale}.html`

    - `category ∈ { operational, medical_processing, photo_video }`
    - `semver = 1.0.0` (initial version per D-06; D-07 governs bumps)
    - `locale ∈ { nl, en, fr }`

    Template structure (each file):
    ```html
    <article data-policy-version="1.0.0" data-locale="nl" data-category="operational" data-legal-status="team-drafted">
      <h2>Toestemming voor verwerking van operationele gegevens — versie 1.0.0</h2>
      <p>VTTL Topsport verwerkt persoonsgegevens van spelers, trainers, ouders, sparringpartners en academiebeheerders met het oog op de operationele werking van het topsportplatform.</p>
      <ul>
        <li><strong>Welke gegevens?</strong> Naam, voornaam, geboortedatum, e-mailadres, telefoonnummer, adres, club, academie, statuut (A/B/C), leeftijdscategorie.</li>
        <li><strong>Doel:</strong> beheer van de spelerslijst, trainingsregistratie, kalendercoördinatie, communicatie, evaluaties en rangschikking-opvolging.</li>
        <li><strong>Bewaartermijn:</strong> zo lang het account actief is, plus 5 jaar na deactivering voor administratieve/juridische verplichtingen.</li>
        <li><strong>Rechtsgrondslag:</strong> GDPR Art. 6(1)(b) — uitvoering overeenkomst voor topsportbegeleiding.</li>
        <li><strong>Rechten:</strong> inzage, rectificatie, wissing, beperking, bezwaar — via /mijn-gegevens of dpo@vttl.be.</li>
      </ul>
      <p><strong>Versie:</strong> 1.0.0 · <strong>Datum:</strong> 2026-05-01 · <strong>Beheerder:</strong> VTTL — Vlaamse Tafeltennis Liga</p>
    </article>
    ```

    All three categories (operational, medical_processing, photo_video) follow the same structural template per locale. Per category the body content differs:
    - **operational** — basis-platform verwerking (Art. 6(1)(b))
    - **medical_processing** — Art. 9(2)(h) verwerking gezondheidsgegevens voor sportgeneeskundige opvolging; expliciete consent vereist; isolatie via medical_events / medical_documents tabellen
    - **photo_video** — beeldmateriaal van trainingen/wedstrijden voor analyse en communicatie; Art. 6(1)(a) consent; intrekbaar zonder consequenties voor sportieve deelname

    EN and FR mirror the NL master file structurally. Translations follow per D-05 — team-drafted in Phase 1; Phase 8 release-gate verifies legal sign-off per locale before that locale goes productie-live.

    All files carry `data-legal-status="team-drafted"` until Phase 8 release-gate replaces it with `data-legal-status="signed"` after legal review (and bumps `policy_version` to `1.0.1` if wording changes).

    Verify file count == 9 and every file has the `data-policy-version`, `data-locale`, `data-category`, `data-legal-status` attributes.
  </action>
  <verify>
    <automated>test -f public/locales/consent-operational-1.0.0.nl.html && test -f public/locales/consent-operational-1.0.0.en.html && test -f public/locales/consent-operational-1.0.0.fr.html && test -f public/locales/consent-medical_processing-1.0.0.nl.html && test -f public/locales/consent-medical_processing-1.0.0.en.html && test -f public/locales/consent-medical_processing-1.0.0.fr.html && test -f public/locales/consent-photo_video-1.0.0.nl.html && test -f public/locales/consent-photo_video-1.0.0.en.html && test -f public/locales/consent-photo_video-1.0.0.fr.html && [ $(ls public/locales/consent-*.html 2>/dev/null | wc -l) -eq 9 ] && [ $(grep -l 'data-policy-version="1.0.0"' public/locales/consent-*.html | wc -l) -eq 9 ] && [ $(grep -l 'data-legal-status="team-drafted"' public/locales/consent-*.html | wc -l) -eq 9 ]</automated>
  </verify>
  <acceptance_criteria>
    - 9 files exist matching pattern `consent-{category}-1.0.0.{locale}.html`
    - Every file declares `data-policy-version="1.0.0"`, `data-locale="…"`, `data-category="…"`, `data-legal-status="team-drafted"`
    - Files contain real GDPR-compliant draft text per category (welke gegevens / doel / bewaartermijn / rechtsgrondslag / rechten) — not Lorem Ipsum
    - EN and FR mirror the NL structure with translated body content
  </acceptance_criteria>
  <done>9 team-drafted consent HTML files committed; legal review tracked in Phase 8 release-gate per RISK-I18N-LEGAL.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Anonymous browser ↔ next-intl middleware | Locale derived from cookie/header; switcher writes a SameSite=Lax cookie |
| Locale-resolution chain ↔ DB user.preferred_locale | After login, server action persists the cookie → users.preferred_locale (Plan 08) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-08 | Tampering | Consent text snapshot integrity | mitigate | Versioned HTML files committed to git; `policy_version` + sha256 stored on every consent_records row (Plan 12); `data-policy-version` attribute on each file enables build-time consistency check |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/integration/locale-resolve.test.ts tests/unit/intl-format.test.ts` GREEN
- Message catalogs key sets equal across nl/en/fr
- All 9 consent HTML files committed (or 0 if Task 0 returned "blocked")
- Plan 08 (locale switcher) and Plan 12 (consent flow) can resolve their imports against this plan's outputs
</verification>

<success_criteria>
- next-intl routing + middleware wired
- 4-step locale resolution chain implemented as pure function
- 3 message catalogs in lockstep
- 9 consent HTML files (or documented "blocked" state)
- date-fns + Intl per-locale formatters with weekStartsOn=1
- Dev fallback fails LOUD per D-20
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-07-SUMMARY.md` documenting:
- Task 0 outcome ("approved — proceed" / "approved with placeholders" / "blocked — postpone")
- If "approved with placeholders": list which files carry `data-draft="true"` and the deadline for final-signed text (typically before Plan 16 push)
- Total message catalog key count
- Confirmation that locale-resolve tests are GREEN

**scope-large:** 19 files in `files_modified`, but 9 of those are content-only consent HTML (`public/locales/consent-*.{nl,en,fr}.html` — text written by counsel, no engineering complexity). Engineering scope is ~10 files (3 i18n files + middleware + format helper + 3 message catalogs + e2e test = ~24-30% context). Acceptable; flagged here for traceability.
</output>
