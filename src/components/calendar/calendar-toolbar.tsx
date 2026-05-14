/**
 * CalendarToolbar — view switcher + date navigator + filter trigger + create CTA.
 *
 * Replaces FullCalendar's built-in `headerToolbar` (CalendarView config sets
 * `headerToolbar={false}`). All navigation runs through URL state so the
 * back/forward buttons and full-page refreshes return the same view (UI3-D8).
 *
 * The "Nieuwe afspraak" button and the mobile filter button dispatch custom
 * DOM events (`calendar:open-create`, `calendar:open-filters`) — Plan 07 wires
 * the actual create sheet and filter bar to listen for those. Until Plan 07
 * lands the clicks are inert.
 *
 * URL-state Client Component pattern — same shape as
 * src/components/i18n/locale-switcher.tsx.
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Page Surfaces (URL state)
 *            .planning/phases/03-kalender/03-UI-SPEC.md §Mobile Strategy
 *            .planning/phases/03-kalender/03-UI-SPEC.md §Copywriting Contract
 */
'use client';

import {
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  Plus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
} from 'date-fns';

import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Locale } from '@/i18n/routing';

type CalendarUrlView = 'week' | 'day' | 'month' | 'year';

interface Props {
  locale: Locale;
  currentView: CalendarUrlView;
  currentDate: Date;
  canCreate: boolean;
}

// `locale` is reserved for future locale-aware date formatting in the toolbar
// (Phase 4: "Week 19 — 12-18 mei 2026" header label). Keeping it on the prop
// surface now avoids a breaking change later.
export function CalendarToolbar({
  locale: _locale,
  currentView,
  currentDate,
  canCreate,
}: Props) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const navigate = useCallback(
    (newView: CalendarUrlView, newDate: Date) => {
      const params = new URLSearchParams(search?.toString() ?? '');
      params.set('view', newView);
      params.set('date', format(newDate, 'yyyy-MM-dd'));
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, search],
  );

  const shiftBy = (direction: 1 | -1) => {
    let next: Date;
    switch (currentView) {
      case 'day':
        next = addDays(currentDate, direction);
        break;
      case 'month':
        next = addMonths(currentDate, direction);
        break;
      case 'year':
        next = addYears(currentDate, direction);
        break;
      case 'week':
      default:
        next = addWeeks(currentDate, direction);
        break;
    }
    navigate(currentView, next);
  };

  const goToday = () => navigate(currentView, new Date());

  const setView = (newView: string) => {
    // Radix ToggleGroup emits '' when the user clicks the currently selected
    // value; ignore that — selection is non-deselectable.
    if (!newView) return;
    navigate(newView as CalendarUrlView, currentDate);
  };

  const openCreate = () => {
    // Plan 07 wires <EventCreateSheet> as the listener; until then this is a
    // no-op (which is the correct Wave 4 behaviour — read-side ships first).
    document.dispatchEvent(new CustomEvent('calendar:open-create'));
  };

  const openFilters = () => {
    // Plan 07 wires <FilterBar> as the listener.
    document.dispatchEvent(new CustomEvent('calendar:open-filters'));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={goToday}>
        {t('actions.today')}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => shiftBy(-1)}
        aria-label={t('actions.prev')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => shiftBy(1)}
        aria-label={t('actions.next')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {/* Desktop view switcher (>= 640px) */}
      <div className="hidden sm:block">
        <ToggleGroup
          type="single"
          variant="outline"
          value={currentView}
          onValueChange={setView}
          aria-label={t('views.week')}
        >
          <ToggleGroupItem value="week">{t('views.week')}</ToggleGroupItem>
          <ToggleGroupItem value="day">{t('views.day')}</ToggleGroupItem>
          <ToggleGroupItem value="month">{t('views.month')}</ToggleGroupItem>
          <ToggleGroupItem value="year">{t('views.year')}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Mobile view switcher = native select (saves chrome real estate). */}
      <select
        className="sm:hidden rounded-md border border-input bg-background px-2 py-1 text-sm"
        value={currentView}
        onChange={(e) => setView(e.target.value)}
        aria-label={t('views.week')}
      >
        <option value="week">{t('views.week')}</option>
        <option value="day">{t('views.day')}</option>
        <option value="month">{t('views.month')}</option>
        <option value="year">{t('views.year')}</option>
      </select>

      {/* Mobile filter trigger — UI-SPEC §Mobile Strategy keeps the bar
          collapsed into this button under 768px. */}
      <Button
        variant="outline"
        size="sm"
        onClick={openFilters}
        className="md:hidden"
      >
        <FilterIcon className="h-4 w-4 mr-1" />
        {t('actions.filters')}
      </Button>

      <div className="grow" />

      {canCreate && (
        <>
          {/* Desktop: inline "Nieuwe afspraak" CTA. */}
          <Button onClick={openCreate} className="hidden md:inline-flex">
            <Plus className="h-4 w-4 mr-1" />
            {t('actions.create')}
          </Button>
          {/* Mobile: floating bottom-right FAB per UI-SPEC §Mobile Strategy. */}
          <Button
            onClick={openCreate}
            className="md:hidden fixed bottom-4 right-4 z-50 rounded-full shadow-lg"
            size="icon"
            aria-label={t('actions.create')}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </>
      )}
    </div>
  );
}
