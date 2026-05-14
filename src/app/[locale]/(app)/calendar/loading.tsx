/**
 * Suspense fallback for /[locale]/(app)/calendar.
 *
 * Renders <CalendarSkeleton> while page.tsx pre-fetches the visible-range
 * events via the tRPC server caller (calendar.list).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Loading & Error States
 */
import { CalendarSkeleton } from '@/components/calendar/calendar-skeleton';

export default function CalendarLoading() {
  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">
      <CalendarSkeleton />
    </main>
  );
}
