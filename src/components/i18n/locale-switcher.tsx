/**
 * LocaleSwitcher — D-01 / D-02 / D-03.
 *
 * Single Globe-icon dropdown rendered in the chrome of every page (incl.
 * login, password reset). Visible at every viewport per D-01 — the mobile
 * hamburger lives next to it and toggles the rest of the nav, never
 * replaces or hides the switcher.
 *
 * Behaviour on change:
 *   1. Calls the setUserLocale Server Action, which:
 *      - validates the locale against SUPPORTED_LOCALES (T-01-LOCALE-TAMPER)
 *      - writes the 'locale' cookie (anonymous + logged-in path)
 *      - UPDATEs users.preferred_locale when a session exists
 *   2. router.replace() (next-intl, not next/navigation) swaps the URL
 *      segment and re-renders client-side without a full page reload (D-03).
 *
 * Implementation notes:
 *   - useTransition() so the trigger disables while the action is in flight,
 *     avoiding a double-submit storm if the user spams options.
 *   - The trigger gets aria-label="Language switcher" / aria-label="Language"
 *     so the e2e spec (tests/e2e/locale-switcher.spec.ts) and the i18n CSS
 *     selectors can find it without depending on visible text (the visible
 *     label rotates per locale).
 *
 * Reference:
 *   - .planning/phases/01-fundament/01-RESEARCH.md §Locale switcher (lines 1453-1488)
 *   - .planning/phases/01-fundament/01-CONTEXT.md §A
 */
'use client';

import { Globe } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { SUPPORTED_LOCALES } from '@/i18n/routing';
import { setUserLocale } from '@/server/actions/locale';

interface Props {
  className?: string;
}

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function LocaleSwitcher({ className }: Props) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    if (!isLocale(next) || next === locale) return;
    startTransition(async () => {
      // 1. Persist server-side (cookie + optional DB write).
      await setUserLocale(next);
      // 2. Soft-route to the same path under the new locale segment (D-03).
      router.replace(pathname, { locale: next });
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
