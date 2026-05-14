/**
 * /[locale]/(app)/calendar — calendar page (Plan 03-06 Task 1).
 *
 * Server Component. Mirrors Phase 2's players page:
 *   1. Build per-request CallerContext via createContext() — populates
 *      session, scope (RLS GUCs are applied by the procedure middleware).
 *   2. tRPC server caller invokes `calendar.list` through the same middleware
 *      chain the HTTP adapter uses — RLS scopes the row set server-side; the
 *      client only ever receives rows it may see.
 *   3. URL state parsed from searchParams (view, date) — the filter URL
 *      parameter ships in Plan 07 (FilterBar); for now we only check
 *      `?filter=…` as a boolean for the empty-state copy variant.
 *   4. Initial events passed as prop to the Client <CalendarView>.
 *
 * BLOCKER-03 canonical pattern: createContext() + appRouter.createCaller(ctx).
 * Does NOT import from any '@/lib/trpc-server' helper (that path does not exist).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Page Surfaces
 *            .planning/phases/03-kalender/03-PATTERNS.md §calendar/page.tsx
 *            src/app/[locale]/(app)/players/page.tsx (Phase 2 analog)
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';

import { CalendarSkeleton } from '@/components/calendar/calendar-skeleton';
import { CalendarToolbar } from '@/components/calendar/calendar-toolbar';
import { CalendarView } from '@/components/calendar/calendar-view';
import { EmptyHintStrip } from '@/components/calendar/empty-hint-strip';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';
import type { Locale } from '@/i18n/routing';

type CalendarUrlView = 'week' | 'day' | 'month' | 'year';
const VIEW_VALUES = ['week', 'day', 'month', 'year'] as const;

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; date?: string; filter?: string }>;
}

function computeRange(view: CalendarUrlView, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case 'day':
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    case 'month':
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case 'year':
      return { from: startOfYear(anchor), to: endOfYear(anchor) };
    case 'week':
    default:
      return {
        // weekStartsOn: 1 = Monday — matches I18N-07 (Monday week start across
        // all three locales — VTTL is a Flemish/Belgian platform, ISO week).
        from: startOfWeek(anchor, { weekStartsOn: 1 }),
        to: endOfWeek(anchor, { weekStartsOn: 1 }),
      };
  }
}

export default async function CalendarPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations('calendar');

  const ctx = await createContext();
  if (!ctx.scope) {
    // Defensive — the (app) layout already redirects anonymous users; we
    // re-check so the createCaller path never runs without a scope.
    redirect(`/${locale}/login`);
  }

  // Validate `view` against the closed enum; fall back to 'week' on anything else.
  const view: CalendarUrlView = (VIEW_VALUES as readonly string[]).includes(sp.view ?? '')
    ? (sp.view as CalendarUrlView)
    : 'week';
  // parseISO returns Invalid Date on bogus input; isValid lets us fall back
  // to "today" without throwing in the Server Component.
  const parsed = sp.date ? parseISO(sp.date) : new Date();
  const anchor = isValid(parsed) ? parsed : new Date();
  const { from, to } = computeRange(view, anchor);

  const caller = appRouter.createCaller(ctx);
  // The server router types `typeCode` as `string` (loose) but the DB layer
  // only ever stores the 6 canonical D-47 codes. The client <CalendarView>
  // mirrors the narrow union (so its event-chip renderer can map codes to
  // colour-token slugs at the type level). Cast at this trust boundary —
  // the values themselves are already constrained by the calendar_events
  // type_code FK + the discriminated-union Zod schema on create/update.
  const initialEvents = (await caller.calendar.list({ from, to })) as Array<
    Omit<
      Awaited<ReturnType<typeof caller.calendar.list>>[number],
      'typeCode'
    > & {
      typeCode:
        | 'event_type_training'
        | 'event_type_tournament'
        | 'event_type_meeting'
        | 'event_type_stage'
        | 'event_type_eval_conversation'
        | 'event_type_medical';
    }
  >;

  // Cosmetic CTA gate — the real RBAC for `calendar.event.create` lives in
  // canCreateEventType (D-48). Showing/hiding the button is UI sugar, not
  // security. The five roles below are the union of any-event-type creators.
  const canCreate = (
    [
      'technical_director',
      'academy_manager',
      'trainer',
      'player',
      'medical_staff',
    ] as const
  ).includes(
    ctx.scope.role as
      | 'technical_director'
      | 'academy_manager'
      | 'trainer'
      | 'player'
      | 'medical_staff',
  );
  // Per-row `canEdit` is already on each EventInstance — this is the page-level
  // hint passed to CalendarView so it can decide whether to enable drag/resize.
  const canEdit = canCreate;

  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6">
      <h1 className="sr-only">{t('title')}</h1>
      <CalendarToolbar
        locale={locale as Locale}
        currentView={view}
        currentDate={anchor}
        canCreate={canCreate}
      />
      <div className="mt-4">
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarView
            locale={locale as Locale}
            initialEvents={initialEvents}
            initialView={view}
            initialDate={anchor}
            canCreate={canCreate}
            canEdit={canEdit}
          />
        </Suspense>
      </div>
      {initialEvents.length === 0 && (
        <EmptyHintStrip filtersActive={Boolean(sp.filter)} />
      )}
    </main>
  );
}
