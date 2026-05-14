/**
 * Calendar grid skeleton — Suspense fallback while server pre-fetches events.
 *
 * Dimensions match FullCalendar's final grid (toolbar row + filter row + 7 day
 * columns × 14 hour rows for an 08:00–22:00 window) to keep CLS at near-zero
 * on first paint. Server Component — no client JS, no hooks.
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Loading & Error States
 */
import { Skeleton } from '@/components/ui/skeleton';

export function CalendarSkeleton() {
  return (
    <div className="space-y-4" data-testid="calendar-skeleton">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <div className="grow" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="flex items-center gap-2 overflow-hidden">
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px rounded-md border border-border bg-border">
        <div className="bg-card p-2">
          <Skeleton className="h-4 w-8" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={`h-${i}`} className="bg-card p-2">
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
        {Array.from({ length: 14 }).map((_, row) => (
          <div key={`row-${row}`} className="contents">
            <div className="bg-card p-2">
              <Skeleton className="h-3 w-8" />
            </div>
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={`cell-${row}-${col}`} className="bg-card p-2 h-12">
                {(row + col) % 5 === 0 && <Skeleton className="h-10 w-full" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
