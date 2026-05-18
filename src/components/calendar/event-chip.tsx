/**
 * EventChip — FullCalendar `eventContent` callback returning JSX.
 *
 * CRITICAL: this is NOT a React component. The JSX returned here is consumed
 * by FullCalendar's internal Preact tree — NO React hooks, NO useTranslations,
 * NO context consumption. All data must arrive via `arg.event.extendedProps`
 * (populated by CalendarView.fcEvents). Adding `useState`, `useEffect`, or
 * `useTranslations` here will crash the chip at runtime when Preact tries to
 * walk the React hook dispatcher.
 *
 * Visual contract per UI-SPEC §Event Chip Contract:
 *   - Left border 2px solid in --cal-event-{type}-border
 *   - Background tinted in --cal-event-{type}-bg
 *   - Foreground (text + icon) in --cal-event-{type}-fg
 *   - lucide icon per type (Dumbbell / Trophy / Users / MapPin /
 *     MessagesSquare / Stethoscope)
 *   - Title text 14px / 500, truncated; optional 2nd line at 12px / 400 for
 *     location
 *   - Overlays: past → opacity-60; currently-happening → inset primary ring;
 *     recurring → small Repeat icon in the time row; conflicting →
 *     AlertTriangle icon; cancelled → strikethrough + 50% opacity
 *
 * Note: the lookup code is `event_type_eval_conversation` but the colour-token
 * slug is `evalconv` (per Plan 04 globals.css).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Event Chip Contract
 *            .planning/phases/03-kalender/03-RESEARCH.md §Anti-Patterns (Preact constraint)
 */
import type { EventContentArg } from '@fullcalendar/core';
import {
  AlertTriangle,
  Dumbbell,
  MapPin,
  MessagesSquare,
  Repeat,
  Stethoscope,
  Trophy,
  Users,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

/** Token slug per event type — note `event_type_eval_conversation` → `evalconv`. */
const TYPE_TOKEN_SLUG: Record<string, string> = {
  event_type_training: 'training',
  event_type_tournament: 'tournament',
  event_type_meeting: 'meeting',
  event_type_stage: 'stage',
  event_type_eval_conversation: 'evalconv',
  event_type_medical: 'medical',
};

const TYPE_ICON: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  event_type_training: Dumbbell,
  event_type_tournament: Trophy,
  event_type_meeting: Users,
  event_type_stage: MapPin,
  event_type_eval_conversation: MessagesSquare,
  event_type_medical: Stethoscope,
};

/** ExtendedProps that CalendarView packs onto FullCalendar events. */
export interface ChipExtendedProps {
  typeCode: string;
  hasRrule: boolean;
  conflicting: boolean;
  cancelled: boolean;
  locationLine?: string | null;
  /** Phase 4 — UI4-D07 needs-action overlay flags.
   *
   * Set server-side by `calendar.list` (Plan 04-08 extension):
   *   - `needsScoring`: training event, ended in last 14d, trainer/TD
   *     scope, at least one session_participants row has NULL quality_score.
   *   - `needsResult`: tournament event, ended in last 14d, caller is a
   *     calendar_event_participants row, no tournament_results row exists.
   *
   * Both default false; the chip renders the yellow ⚠ corner overlay
   * when either is true. Tooltip key disambiguates which.
   */
  needsScoring?: boolean;
  needsResult?: boolean;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * The eventContent callback. Returns JSX rendered by FullCalendar's Preact
 * tree. Keep this a pure function — no hooks, no context, no async work.
 */
export function renderEventChip(arg: EventContentArg) {
  const props = arg.event.extendedProps as ChipExtendedProps;
  const typeCode = props.typeCode;
  const slug = TYPE_TOKEN_SLUG[typeCode] ?? 'meeting';
  const Icon = TYPE_ICON[typeCode] ?? Users;

  const start = arg.event.start;
  const end = arg.event.end;
  const now = new Date();
  const isPast = end ? end < now : false;
  const isHappening = start && end ? start <= now && now <= end : false;

  // Inline style so token resolution happens at paint time against the
  // active light/dark theme — globals.css ships both ramps.
  const chipStyle = {
    backgroundColor: `var(--cal-event-${slug}-bg)`,
    color: `var(--cal-event-${slug}-fg)`,
    borderLeft: `2px solid var(--cal-event-${slug}-border)`,
  };
  const containerClasses = [
    'flex flex-col gap-0.5 rounded px-2 py-1 text-sm h-full overflow-hidden',
    isPast ? 'opacity-60' : '',
    isHappening ? 'ring-2 ring-primary/40 ring-inset' : '',
    props.cancelled ? 'line-through opacity-50' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const timeLabel =
    start && end
      ? `${pad2(start.getHours())}:${pad2(start.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`
      : '';

  // Phase 4 UI4-D07: needs-action corner overlay (yellow ⚠ badge).
  // The badge sits absolute top-right; pulses on critical priority but
  // motion-safe so reduced-motion disables. Color is paired with the
  // AlertTriangle icon so deuteranopia-safe (T-04-52 / T-04-53 a11y).
  const showActionBadge = Boolean(props.needsScoring || props.needsResult);

  return (
    <div className={`${containerClasses} relative`} style={chipStyle}>
      {showActionBadge && (
        <span
          className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border bg-state-needs-action-bg text-state-needs-action-fg border-state-needs-action-border motion-safe:animate-pulse"
          aria-label="actie vereist"
          data-testid="event-chip-needs-action-overlay"
        >
          <AlertTriangle className="h-3 w-3" aria-hidden />
        </span>
      )}
      <div className="flex items-center gap-1 text-xs leading-tight">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium tabular-nums">{timeLabel}</span>
        {props.hasRrule && <Repeat className="h-2.5 w-2.5" aria-hidden />}
        {props.conflicting && (
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
        )}
      </div>
      <div className="text-sm font-medium leading-tight truncate">
        {arg.event.title}
      </div>
      {props.locationLine && (
        <div className="text-xs leading-tight truncate opacity-90">
          {props.locationLine}
        </div>
      )}
    </div>
  );
}
