/**
 * CalendarView — the single 'use client' boundary wrapping FullCalendar 6.x.
 *
 * FullCalendar requires browser APIs (window, document, ResizeObserver) so
 * it must run in the client; we contain it here so Server Components keep
 * the rest of the page on the server. The Server Component (page.tsx)
 * pre-fetches the visible range via `calendar.list` and hands the result
 * down as `initialEvents`. Plan 07 will add a `useTrpc` subscription so
 * navigation beyond the pre-fetched window re-fetches the range.
 *
 * Design notes:
 *   - `headerToolbar={false}` — the app's <CalendarToolbar> is the source of
 *     truth for navigation, view switching, and the create CTA.
 *   - Locale file is loaded dynamically per active next-intl locale and the
 *     render is gated on it (Pitfall 2 — no English-month-name flash).
 *   - Mobile (< 640px): force `timeGridDay`, attach a vanilla pointer-event
 *     swipe handler on the CONTAINER (not the FC root) so FullCalendar's
 *     internal scroll keeps working (Pitfall 7). Threshold 60px horizontal,
 *     30px vertical tolerance, 400ms max duration; touch-only.
 *   - `eventContent` renders renderEventChip — Preact-rendered JSX, no hooks.
 *   - eventClick / select / eventDrop / eventResize dispatch custom DOM
 *     events that Plan 07's sheets (detail / create / move-confirm) listen
 *     for. Until Plan 07 lands the dispatches are silent no-ops.
 *
 * Reference: .planning/phases/03-kalender/03-RESEARCH.md §Pattern 1
 *            .planning/phases/03-kalender/03-UI-SPEC.md §Mobile Strategy
 */
'use client';

import FullCalendar from '@fullcalendar/react';
import type {
  EventInput,
  LocaleInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import multiMonthPlugin from '@fullcalendar/multimonth';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useEffect, useMemo, useRef, useState } from 'react';

import { renderEventChip } from '@/components/calendar/event-chip';
import type { Locale } from '@/i18n/routing';

/**
 * Mirror of Plan 05's EventInstance — re-declared here (not imported) so the
 * client bundle doesn't pull the server router type chain into the browser.
 * Dates can arrive as ISO strings (serialised over the wire) or Date objects
 * (when the Server Component hands the same `caller.calendar.list(...)`
 * result down without serialisation).
 */
interface EventInstance {
  id: string;
  typeCode:
    | 'event_type_training'
    | 'event_type_tournament'
    | 'event_type_meeting'
    | 'event_type_stage'
    | 'event_type_eval_conversation'
    | 'event_type_medical';
  title: string;
  startsAt: string | Date;
  endsAt: string | Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  createdBy: string;
  hasRrule: boolean;
  occurrenceDate: string | Date | null;
  isException: boolean;
  cancelled: boolean;
  participantUserIds: string[];
  conflicting: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface Props {
  locale: Locale;
  initialEvents: EventInstance[];
  initialView: 'week' | 'day' | 'month' | 'year';
  initialDate: Date | string;
  canCreate: boolean;
  canEdit: boolean;
}

/** next-intl locale → FullCalendar locale module. en-gb keeps Monday first. */
const FC_LOCALE_LOADERS: Record<Locale, () => Promise<LocaleInput>> = {
  nl: () => import('@fullcalendar/core/locales/nl').then((m) => m.default),
  en: () => import('@fullcalendar/core/locales/en-gb').then((m) => m.default),
  fr: () => import('@fullcalendar/core/locales/fr').then((m) => m.default),
};

/** URL `view` value → FullCalendar internal view code. */
function viewName(view: Props['initialView'], isMobile: boolean): string {
  // CAL-08: on mobile any non-mobile view collapses to single-day. The week
  // view doesn't fit a 360px viewport with 7 columns + readable chips.
  if (isMobile) return 'timeGridDay';
  switch (view) {
    case 'day':
      return 'timeGridDay';
    case 'month':
      return 'dayGridMonth';
    case 'year':
      return 'multiMonthYear';
    case 'week':
    default:
      return 'timeGridWeek';
  }
}

function toIso(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString();
}

// `FullCalendar` is a default export class component — its instance methods
// (getApi) are what we need. React's typed ref helper requires a constructor
// signature, so we use `InstanceType` loosely via `typeof` instead of a
// `RefObject<FullCalendar>` annotation that would re-derive the class type.
type FullCalendarRef = InstanceType<typeof FullCalendar>;

export function CalendarView({
  locale,
  initialEvents,
  initialView,
  initialDate,
  canCreate,
  canEdit,
}: Props) {
  const calendarRef = useRef<FullCalendarRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fcLocale, setFcLocale] = useState<LocaleInput | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Pitfall 2: load the locale file before mount; block render until it
  // resolves. The outer <Suspense fallback> handles the initial paint.
  useEffect(() => {
    let cancelled = false;
    FC_LOCALE_LOADERS[locale]().then((l) => {
      if (!cancelled) setFcLocale(l);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // Mobile breakpoint observer (UI3-D7). Re-evaluates on viewport changes so
  // a rotated tablet flips between timeGridDay and timeGridWeek correctly.
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // CAL-08 swipe handler — vanilla pointerevents on the container, not the
  // FC root. Attaching to FC's root would steal its internal scroll on
  // tall day grids (Pitfall 7).
  useEffect(() => {
    if (!isMobile) return;
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    const THRESHOLD_X = 60;
    const VERTICAL_TOLERANCE = 30;
    const MAX_DURATION_MS = 400;

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
    }
    function onPointerUp(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      const dx = e.clientX - startX;
      const dy = Math.abs(e.clientY - startY);
      const dt = Date.now() - startTime;
      if (dt > MAX_DURATION_MS) return;
      if (dy > VERTICAL_TOLERANCE) return;
      if (Math.abs(dx) < THRESHOLD_X) return;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      // Left swipe → next day; right swipe → previous day.
      if (dx < 0) api.next();
      else api.prev();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isMobile]);

  const fcEvents = useMemo<EventInput[]>(
    () =>
      initialEvents.map((e) => ({
        // Recurring events surface multiple occurrences with the same base id;
        // FullCalendar requires a unique id per rendered event, so we suffix
        // with the occurrenceDate (or 'single' for non-recurring rows).
        id: `${e.id}-${
          e.occurrenceDate
            ? typeof e.occurrenceDate === 'string'
              ? e.occurrenceDate
              : e.occurrenceDate.toISOString()
            : 'single'
        }`,
        title: e.title,
        start: toIso(e.startsAt),
        end: toIso(e.endsAt),
        allDay: e.allDay,
        extendedProps: {
          // The real event id (without occurrence suffix) — Plan 07 sheets
          // use this to call calendar.event.get / update / delete.
          eventId: e.id,
          typeCode: e.typeCode,
          hasRrule: e.hasRrule,
          conflicting: e.conflicting,
          cancelled: e.cancelled,
          locationLine: e.location,
          occurrenceDate: e.occurrenceDate,
          canEdit: e.canEdit,
          canDelete: e.canDelete,
        },
      })),
    [initialEvents],
  );

  if (!fcLocale) {
    // Wait for the locale; the outer <Suspense fallback> on page.tsx
    // paints the skeleton until we resolve.
    return null;
  }

  return (
    <div ref={containerRef} data-testid="calendar-view">
      <FullCalendar
        ref={calendarRef}
        plugins={[
          timeGridPlugin,
          dayGridPlugin,
          interactionPlugin,
          multiMonthPlugin,
        ]}
        initialView={viewName(initialView, isMobile)}
        initialDate={initialDate}
        locale={fcLocale}
        firstDay={1} // Monday — I18N-07
        headerToolbar={false} // app owns the toolbar via <CalendarToolbar>
        events={fcEvents}
        // Mobile drag-to-edit is intentionally off (UI-SPEC §Mobile Strategy)
        // — long-press-to-create lands in v2.
        editable={canEdit && !isMobile}
        selectable={canCreate && !isMobile}
        eventContent={renderEventChip}
        dayMaxEvents={4} // month-view truncation (UI-SPEC §Event Chip month view)
        slotMinTime="07:00:00"
        slotMaxTime="23:00:00"
        allDaySlot
        nowIndicator
        eventClick={(arg) => {
          document.dispatchEvent(
            new CustomEvent('calendar:open-detail', {
              detail: {
                eventId: arg.event.extendedProps.eventId as string,
                occurrenceDate: arg.event.extendedProps.occurrenceDate as
                  | string
                  | null,
              },
            }),
          );
        }}
        select={(arg) => {
          if (!canCreate) return;
          document.dispatchEvent(
            new CustomEvent('calendar:open-create', {
              detail: {
                start: arg.start.toISOString(),
                end: arg.end.toISOString(),
              },
            }),
          );
        }}
        eventDrop={(arg) => {
          document.dispatchEvent(
            new CustomEvent('calendar:event-drop', {
              detail: {
                eventId: arg.event.extendedProps.eventId as string,
                newStart: arg.event.start?.toISOString(),
                newEnd: arg.event.end?.toISOString(),
                // Plan 07's listener calls revert() when the user clicks the
                // conflict warning's "Ongedaan maken" or when the server
                // rejects the move.
                revert: () => arg.revert(),
              },
            }),
          );
        }}
        eventResize={(arg) => {
          document.dispatchEvent(
            new CustomEvent('calendar:event-resize', {
              detail: {
                eventId: arg.event.extendedProps.eventId as string,
                newStart: arg.event.start?.toISOString(),
                newEnd: arg.event.end?.toISOString(),
                revert: () => arg.revert(),
              },
            }),
          );
        }}
        datesSet={(arg) => {
          // Plan 07 listens here to trigger a range re-fetch when the user
          // navigates beyond the pre-fetched window. Wave 4 only emits the
          // event — no listener is wired yet.
          document.dispatchEvent(
            new CustomEvent('calendar:dates-set', {
              detail: {
                start: arg.start.toISOString(),
                end: arg.end.toISOString(),
              },
            }),
          );
        }}
      />
    </div>
  );
}
