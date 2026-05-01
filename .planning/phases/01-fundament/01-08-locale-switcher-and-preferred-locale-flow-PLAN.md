---phase: 01-fundament
plan: 08
type: execute
wave: 4
depends_on: [05, 07]
files_modified:
  - src/components/i18n/locale-switcher.tsx
  - src/components/ui/select.tsx
  - src/server/actions/locale.ts
  - src/app/[locale]/layout.tsx
  - src/app/[locale]/page.tsx
  - tests/e2e/locale-switcher.spec.ts
autonomous: false
requirements:
  - I18N-01
requirements_supports:  # informational — primary owners listed below
  - I18N-02
threat_refs:
  - T-01-LOCALE-TAMPER
tags:
  - phase-1
  - i18n
  - ui
  - locale-switcher

must_haves:
  truths:
    - "<LocaleSwitcher> renders with lucide Globe icon + 2-letter locale code (NL/EN/FR) per D-01"
    - "ONE <LocaleSwitcher> rendered in the header at every viewport — Globe icon ALWAYS visible per D-01 (no hidden md:flex; no nesting inside the mobile menu)"
    - "Anonymous switch updates `locale` cookie + soft-routes via next-intl router (no full page reload — D-03)"
    - "After login, server action `setUserLocale(locale)` UPDATEs users.preferred_locale and ALSO writes the cookie so subsequent requests resolve via DB pref"
    - "tests/e2e/locale-switcher.spec.ts (Plan 17) GREEN: anonymous switch updates URL; logged-in switch persists pref"
  artifacts:
    - path: "src/components/i18n/locale-switcher.tsx"
      provides: "Client Component using next-intl router; calls setUserLocale server action when session active"
      exports: ["LocaleSwitcher"]
    - path: "src/server/actions/locale.ts"
      provides: "setUserLocale Server Action — UPDATE users.preferred_locale + Set-Cookie"
      exports: ["setUserLocale"]
    - path: "src/components/ui/select.tsx"
      provides: "shadcn/ui Select primitive (generated via shadcn CLI)"
      contains: "SelectTrigger"
  key_links:
    - from: "src/components/i18n/locale-switcher.tsx"
      to: "src/server/actions/locale.ts"
      via: "useTransition + setUserLocale call when session present"
      pattern: "setUserLocale"
    - from: "src/server/actions/locale.ts"
      to: "src/server/db/client.ts"
      via: "UPDATE users SET preferred_locale = $1 WHERE id = $session.user.id"
      pattern: "preferredLocale"
---

<objective>
Build the locale switcher (D-01) and wire the post-login persistence flow (D-02). Anonymous users get a session-cookie-only switch (D-02 step 1); logged-in users have their choice persisted to `users.preferred_locale` so subsequent requests + emails (Plan 06) honor it.

Output: shadcn-styled switcher in the chrome; server action persists pref; e2e test green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Install shadcn/ui select primitive + Tailwind tokens</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md File-tree (line 350) — components/ui directory
    - CLAUDE.md (Frontend section — shadcn/ui via CLI)
  </read_first>
  <files>
    src/components/ui/select.tsx
    src/components/ui/button.tsx
    components.json
  </files>
  <action>
    Initialise shadcn/ui (per RESEARCH note at line 350 — components live in repo, not as npm package):
    ```bash
    npx shadcn@latest init -d   # accept defaults; src/ alias = @/*
    npx shadcn@latest add select button dropdown-menu
    ```

    This creates `components.json`, `src/components/ui/select.tsx`, `src/components/ui/button.tsx`, `src/components/ui/dropdown-menu.tsx` and possibly a `lib/utils.ts` (cn helper).

    Verify file: `src/components/ui/select.tsx` exports `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`.
  </action>
  <verify>
    <automated>test -f components.json && test -f src/components/ui/select.tsx && test -f src/components/ui/button.tsx && grep -q "SelectTrigger\|SelectPrimitive" src/components/ui/select.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `components.json` exists (shadcn/ui config)
    - `src/components/ui/select.tsx` and `src/components/ui/button.tsx` exist
    - shadcn/ui Select primitive available for the switcher
  </acceptance_criteria>
  <done>shadcn/ui primitives ready.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: <LocaleSwitcher> component + setUserLocale server action + layout integration</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Locale switcher component (lines 1453–1488)
    - .planning/phases/01-fundament/01-CONTEXT.md §A (D-01, D-02, D-03)
    - src/i18n/navigation.ts (Plan 07 — Link/router/usePathname wrappers)
    - src/server/auth/auth.ts (Plan 05 — auth.api.getSession)
  </read_first>
  <files>
    src/components/i18n/locale-switcher.tsx
    src/server/actions/locale.ts
    src/app/[locale]/layout.tsx
    src/app/[locale]/page.tsx
  </files>
  <action>
    Create `src/server/actions/locale.ts`:
    ```ts
    'use server';
    import { auth } from '@/server/auth/auth';
    import { db } from '@/server/db/client';
    import { users } from '@/server/db/schema/auth';
    import { eq } from 'drizzle-orm';
    import { cookies, headers } from 'next/headers';
    import type { Locale } from '@/i18n/routing';
    import { SUPPORTED_LOCALES } from '@/i18n/routing';

    /** Persist locale preference. Anonymous → cookie only. Logged-in → users.preferred_locale + cookie. */
    export async function setUserLocale(locale: Locale) {
      if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
        throw new Error('locale_unsupported');
      }
      const cookieStore = await cookies();
      cookieStore.set('locale', locale, {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 365,
      });

      const session = await auth.api.getSession({ headers: await headers() });
      if (session?.user) {
        await db.update(users).set({ preferredLocale: locale }).where(eq(users.id, session.user.id));
      }
      return { ok: true, persistedToDb: !!session };
    }
    ```

    Create `src/components/i18n/locale-switcher.tsx` (per RESEARCH §Locale switcher lines 1455–1488):
    ```tsx
    'use client';
    import { Globe } from 'lucide-react';
    import { useLocale } from 'next-intl';
    import { useTransition } from 'react';
    import { usePathname, useRouter } from '@/i18n/navigation';
    import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
    import { setUserLocale } from '@/server/actions/locale';
    import type { Locale } from '@/i18n/routing';

    interface Props { className?: string; }

    export function LocaleSwitcher({ className }: Props) {
      const locale = useLocale() as Locale;
      const router = useRouter();
      const pathname = usePathname();
      const [isPending, startTransition] = useTransition();

      function onChange(next: string) {
        if (!['nl','en','fr'].includes(next)) return;
        startTransition(async () => {
          // Always set cookie + soft-route (D-03 — no page refresh)
          await setUserLocale(next as Locale);
          router.replace(pathname, { locale: next as Locale });
        });
      }

      return (
        <Select value={locale} onValueChange={onChange} disabled={isPending}>
          <SelectTrigger
            className={`w-[88px] ${className ?? ''}`}
            aria-label="Language switcher"
          >
            <Globe className="h-4 w-4 mr-1" aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nl">NL</SelectItem>
            <SelectItem value="en">EN</SelectItem>
            <SelectItem value="fr">FR</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    ```

    Create `src/app/[locale]/layout.tsx`:
    ```tsx
    import { NextIntlClientProvider } from 'next-intl';
    import { getMessages } from 'next-intl/server';
    import { notFound } from 'next/navigation';
    import { hasLocale } from 'next-intl';
    import { routing } from '@/i18n/routing';
    import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
    import './globals.css';

    export default async function LocaleLayout({
      children,
      params,
    }: {
      children: React.ReactNode;
      params: Promise<{ locale: string }>;
    }) {
      const { locale } = await params;
      if (!hasLocale(routing.locales, locale)) notFound();

      const messages = await getMessages();

      return (
        <html lang={locale}>
          <body>
            <NextIntlClientProvider messages={messages} locale={locale}>
              <header className="flex items-center justify-between border-b px-4 py-3">
                <a href={`/${locale}`} className="font-semibold">VTTL Topsport</a>
                <div className="flex items-center gap-2">
                  {/* D-01: Globe (LocaleSwitcher) ALWAYS visible in header on every viewport. */}
                  <LocaleSwitcher />
                  {/* Mobile-only hamburger toggles the rest of the nav (Plan 15 fills the menu items). */}
                  <button
                    type="button"
                    aria-label="Menu"
                    aria-expanded="false"
                    className="md:hidden p-2"
                    onClick={(e) => {
                      const btn = e.currentTarget;
                      const expanded = btn.getAttribute('aria-expanded') === 'true';
                      btn.setAttribute('aria-expanded', String(!expanded));
                      const sheet = document.getElementById('mobile-nav-sheet');
                      if (sheet) sheet.toggleAttribute('hidden');
                    }}
                  >
                    <svg width="24" height="24" aria-hidden="true">
                      <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </button>
                  <div
                    id="mobile-nav-sheet"
                    hidden
                    className="md:hidden absolute right-0 top-12 mt-2 bg-background border rounded p-2 z-40"
                  >
                    {/* Plan 15: nav links + secondary actions render here. */}
                    {/* The locale dropdown stays in the header — NOT duplicated inside the sheet. */}
                  </div>
                </div>
              </header>
              <main>{children}</main>
            </NextIntlClientProvider>
          </body>
        </html>
      );
    }
    ```

    Create `src/app/[locale]/page.tsx` (minimal landing — Plan 15 expands):
    ```tsx
    import { getTranslations } from 'next-intl/server';

    export default async function Landing() {
      const t = await getTranslations('common');
      return (
        <div className="p-6">
          <h1 className="text-2xl font-semibold">VTTL Topsport</h1>
          <p>{t('loading')}</p>
        </div>
      );
    }
    ```

    Update `tests/e2e/locale-switcher.spec.ts` (Plan 17 RED stub) to assert:
    - Visiting `/nl` → Globe icon visible + "NL" in trigger
    - Click switcher → select "EN" → URL changes to `/en` without full page reload
    - Inspect server response: `Set-Cookie: locale=en` present
  </action>
  <verify>
    <automated>test -f src/components/i18n/locale-switcher.tsx && test -f src/server/actions/locale.ts && test -f src/app/\[locale\]/layout.tsx && grep -q "Globe" src/components/i18n/locale-switcher.tsx && grep -q "useTransition" src/components/i18n/locale-switcher.tsx && grep -q "aria-label=\"Language" src/components/i18n/locale-switcher.tsx && grep -q "'use server'" src/server/actions/locale.ts && grep -q "preferredLocale" src/server/actions/locale.ts && grep -q "cookies().*set('locale'\|cookieStore.set('locale'" src/server/actions/locale.ts && grep -q "NextIntlClientProvider" src/app/\[locale\]/layout.tsx && grep -q "LocaleSwitcher" src/app/\[locale\]/layout.tsx && ! grep -q "hidden md:flex" src/app/\[locale\]/layout.tsx && grep -q "mobile-nav-sheet" src/app/\[locale\]/layout.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `<LocaleSwitcher>` uses lucide `Globe` icon + 2-letter locale code (NL/EN/FR) per D-01
    - Triggers `setUserLocale` server action AND `router.replace` for soft-route (D-03)
    - Layout renders ONE shared <LocaleSwitcher> in the header at every viewport (D-01: Globe never disappears)
    - Mobile hamburger button is a SEPARATE element next to (not replacing) the LocaleSwitcher; toggles the rest of the nav only
    - `setUserLocale` validates locale against SUPPORTED_LOCALES
    - When session present, persists to users.preferred_locale; always writes cookie
  </acceptance_criteria>
  <done>Locale switcher functional; D-01/02/03 honored.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Visual verification of locale switcher across breakpoints</name>
  <what-built>
    - LocaleSwitcher component with Globe icon
    - Header layout: switcher visible on md+, hidden on mobile (inside hamburger details)
    - Server action persists to users.preferred_locale after login
  </what-built>
  <how-to-verify>
    1. Run `npm run dev` and visit `http://localhost:3000/nl`.
    2. **Desktop (>= 768px):** Verify Globe icon + "NL" code visible in top-right header.
    3. Click the switcher; select "EN". URL should become `/en` WITHOUT a full page reload (Network tab shows no document request).
    4. Inspect cookies — `locale=en` must be present.
    5. **Mobile (resize to < 768px):** Per D-01, the Globe icon must REMAIN VISIBLE in the header — the LocaleSwitcher dropdown stays in the header at every breakpoint. A separate hamburger button appears next to it for the rest of the nav (Plan 15 fills).
    6. Tap the Globe on mobile — the locale options must open as a dropdown / sheet (shadcn Select handles touch). Tap the hamburger separately — the mobile nav sheet must open WITHOUT re-rendering or duplicating the LocaleSwitcher.
    7. **Logged-in flow** (after Plan 15 admin UI exists): log in, change locale, log out, log back in — locale should persist via users.preferred_locale.
    8. Confirm received emails (verify-email + password-reset) arrive in the chosen language.
  </how-to-verify>
  <resume-signal>Type "approved" if visuals match D-01 / D-02 / D-03 requirements; otherwise describe what is wrong.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser ↔ locale cookie | SameSite=Lax + Secure (in prod); 1-year max-age; not httpOnly (client-readable for instant UI feedback) |
| Server action ↔ DB | Authenticated mutation only updates own users.preferred_locale; no scope escalation possible |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-LOCALE-TAMPER | Tampering | locale cookie / setUserLocale input | mitigate | `setUserLocale` validates the input against the `SUPPORTED_LOCALES` allowlist and throws `locale_unsupported` for any value outside `nl/en/fr`. Cookie is unsigned but only drives UI rendering; no privilege depends on its value. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- Switcher renders without console errors
- e2e test in Plan 17 passes
- Logged-in user's email locale matches preferred_locale on next email
</verification>

<success_criteria>
- D-01 visual: Globe + 2-letter code, header on desktop, hamburger on mobile
- D-02 persistence: cookie + DB pref after login
- D-03 soft-route: no page reload on switch
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-08-SUMMARY.md` documenting:
- shadcn/ui components installed
- Confirmation that Task 3 visual checkpoint approved
</output>
