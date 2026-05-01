/**
 * next-intl navigation primitives — locale-aware <Link>, redirect, usePathname, useRouter.
 *
 * Consumers (locale switcher in Plan 08, page links in Phase 2+) import from
 * '@/i18n/navigation' rather than 'next/link' / 'next/navigation' so the
 * locale prefix is preserved automatically per routing.localePrefix='as-needed'.
 *
 * Reference: https://next-intl-docs.vercel.app/docs/routing/navigation
 */
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
