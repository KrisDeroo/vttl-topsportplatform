/**
 * EmptyHintStrip — below-grid informational strip when the visible range
 * contains no events.
 *
 * Two variants per UI-SPEC §Page Surfaces:
 *   - filtersActive=false → 'calendar.emptyHint'
 *   - filtersActive=true  → 'calendar.emptyFiltered' + 'Filters wissen' button
 *
 * Subtle informational strip, NOT a Card, NOT centered, NOT blocking — the
 * calendar grid itself IS the primary empty state. This strip just hints at
 * the why and offers a remedy when filters are involved.
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Page Surfaces
 */
'use client';

import { CalendarOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';

export function EmptyHintStrip({ filtersActive }: { filtersActive: boolean }) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function clearFilters() {
    const newParams = new URLSearchParams(search?.toString() ?? '');
    newParams.delete('filter');
    const qs = newParams.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <CalendarOff className="h-4 w-4" aria-hidden />
      <span>{filtersActive ? t('emptyFiltered') : t('emptyHint')}</span>
      {filtersActive && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          {t('filters.clear')}
        </Button>
      )}
    </div>
  );
}
