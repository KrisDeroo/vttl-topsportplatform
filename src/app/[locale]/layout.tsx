/**
 * App Router locale-segment layout (D-01 / D-18).
 *
 * Mounted at /[locale]/* — middleware (next-intl) guarantees `locale` is
 * one of routing.locales before this layout renders, but we re-validate
 * with hasLocale() to catch direct fetches that bypass the matcher.
 *
 * Renders the global header chrome:
 *   - product wordmark (links to the locale-prefixed root)
 *   - LocaleSwitcher (D-01: ALWAYS visible at every viewport — never
 *     wrapped in a desktop-only utility class and never nested inside
 *     the mobile sheet)
 *   - MobileNavToggle (md:hidden) — owns the hamburger and toggles the
 *     #mobile-nav-sheet element. Plan 15 fills the sheet contents.
 *
 * NextIntlClientProvider wraps children so client components (forms,
 * the LocaleSwitcher) can read `useLocale()` / `useTranslations()`.
 *
 * Reference:
 *   - .planning/phases/01-fundament/01-08-PLAN.md Task 2
 *   - https://next-intl-docs.vercel.app/docs/getting-started/app-router
 */
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { MobileNavToggle } from '@/components/chrome/mobile-nav-toggle';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

import './globals.css';

interface LayoutParams {
  locale: string;
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<LayoutParams>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <header className="flex items-center justify-between border-b px-4 py-3">
            <Link href="/" className="font-semibold">
              VTTL Topsport
            </Link>
            {/*
              D-01: <LocaleSwitcher> is the FIRST chrome control on every viewport.
              The hamburger sits next to it (mobile-only). NEVER duplicate or
              nest the switcher inside the mobile sheet — Globe must stay visible.
            */}
            <div className="flex items-center gap-2">
              <LocaleSwitcher />
              <MobileNavToggle />
              <div
                id="mobile-nav-sheet"
                hidden
                className="md:hidden absolute right-0 top-12 mt-2 bg-background border rounded p-2 z-40"
              >
                {/*
                  Plan 15 fills this with the rest of the navigation links and
                  any secondary actions. The locale dropdown stays in the header.
                */}
              </div>
            </div>
          </header>
          <main>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
