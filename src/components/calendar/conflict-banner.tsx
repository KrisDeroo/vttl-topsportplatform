/**
 * <ConflictBanner> — top-page Alert surfaced when a drag-drop event move
 * conflicts with another booking (CAL-07 Surface 2).
 *
 * Lifecycle:
 *   1. <CalendarView> (Plan 06) optimistically moves the FullCalendar event
 *      and dispatches `calendar:event-drop` or `calendar:event-resize` with
 *      `{ eventId, newStart, newEnd, revert() }`.
 *   2. The banner listens, fetches the full event via `calendar.event.get`,
 *      composes an `eventUpdateInput` payload (preserving type-specific
 *      extension fields), and calls `calendar.event.update`.
 *   3a. Success → toast.success("Afspraak verplaatst") + clear.
 *   3b. CONFLICT (server returns redacted conflicts via TRPCError.cause) →
 *       show the banner with the participant-first body and two CTAs:
 *         - "Toch verplaatsen" — re-submits with force:true (audit override)
 *         - "Ongedaan maken" — calls the captured `revert()` from the drop
 *   3c. Other server errors → toast.error + revert.
 *
 * D-57 invariant: the server NEVER blocks. CONFLICT here means "soft warning,
 * user decides". The override audit row is written before the update succeeds.
 *
 * Threat T-03-36 (XSS via conflict body) is shared with <ConflictWarning>
 * — both use the same `renderMarkdownBold` helper that splits around `**`
 * markers and renders bold runs as <strong> JSX (no innerHTML).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Conflict Detection
 *            Surface 2 (lines 446-451)
 *            .planning/phases/03-kalender/03-CONTEXT.md D-57
 */
'use client';

import type { inferProcedureInput } from '@trpc/server';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { RedactedConflict } from '@/lib/calendar/conflicts';
import { trpc } from '@/lib/trpc-client';
import type { AppRouter } from '@/server/trpc/routers/_app';

/** WR-11: typed payload for calendar.event.update. Same derivation as
 *  the create/edit sheets — schema changes become compile errors at
 *  the switch site rather than slipping through under `as any`. */
type UpdatePayload = inferProcedureInput<
  AppRouter['calendar']['event']['update']
>;

interface PendingMove {
  eventId: string;
  newStart: string;
  newEnd: string;
  revert: () => void;
}

interface BannerState {
  conflicts: ReadonlyArray<RedactedConflict>;
  pending: PendingMove;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function fmtTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function renderMarkdownBold(s: string): ReactNode[] {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  return parts.map((chunk, i) =>
    i % 2 === 0 ? (
      <span key={i}>{chunk}</span>
    ) : (
      <strong key={i}>{chunk}</strong>
    ),
  );
}

export function ConflictBanner() {
  const t = useTranslations('calendar.conflict');
  const tToast = useTranslations('calendar.event.toast');
  const tLookup = useTranslations('lookup.eventType');
  const [state, setState] = useState<BannerState | null>(null);

  const utils = trpc.useUtils();
  const updateMutation = trpc.calendar.event.update.useMutation();

  const attemptMove = useCallback(
    async (detail: PendingMove, force: boolean) => {
      try {
        // Fetch the full event so we can compose the discriminated-union
        // update payload (eventUpdateInput requires type-specific fields).
        const full = await utils.calendar.event.get.fetch({
          eventId: detail.eventId,
        });
        const ev = full.event;
        const ext = (full.extension ?? {}) as Record<string, unknown>;
        const participants = (full.participants ?? []).map((p) => ({
          userId: p.userId,
          roleInEvent: p.roleInEvent as 'organizer' | 'participant' | 'invitee',
        }));

        // WR-11: build the discriminated-union payload via an exhaustive
        // switch over ev.typeCode. The `type` discriminator is set per
        // branch; basePayload carries only fields shared across every
        // event type. The Zod schema on the server is still the final
        // authority — the typed payload is purely a compile-time guard.
        // The server's typeCode is typed `string` (DB text column) but
        // the FK + the discriminated-union schema constrain it to the
        // 6 canonical D-47 codes; narrow at this trust boundary.
        type TypeCode =
          | 'event_type_training'
          | 'event_type_tournament'
          | 'event_type_meeting'
          | 'event_type_stage'
          | 'event_type_eval_conversation'
          | 'event_type_medical';
        const typeCode = ev.typeCode as TypeCode;
        const basePayload = {
          eventId: ev.id,
          title: ev.title,
          startsAt: new Date(detail.newStart),
          endsAt: new Date(detail.newEnd),
          allDay: ev.allDay,
          location: ev.location ?? undefined,
          description: ev.description ?? undefined,
          rrule: ev.rrule ?? undefined,
          participants,
          force,
        };

        let payload: UpdatePayload;
        switch (typeCode) {
          case 'event_type_training':
            payload = {
              ...basePayload,
              type: 'event_type_training',
              trainingTypeCode: String(ext.trainingTypeCode ?? ''),
              organisationCode: String(ext.organisationCode ?? ''),
              trainerId: String(ext.trainerId ?? ''),
              durationMinutes: Number(ext.durationMinutes ?? 60),
            };
            break;
          case 'event_type_tournament':
            payload = {
              ...basePayload,
              type: 'event_type_tournament',
              city: String(ext.city ?? ''),
              country: String(ext.country ?? ''),
              ageCategoryCode: String(ext.ageCategoryCode ?? ''),
              tournamentTypeCode: String(ext.tournamentTypeCode ?? ''),
            };
            break;
          case 'event_type_stage':
            payload = {
              ...basePayload,
              type: 'event_type_stage',
              place: String(ext.place ?? ''),
              country: String(ext.country ?? ''),
            };
            break;
          case 'event_type_eval_conversation':
            payload = {
              ...basePayload,
              type: 'event_type_eval_conversation',
              evaluatorUserId: String(ext.evaluatorUserId ?? ''),
              playerUserId: String(ext.playerUserId ?? ''),
            };
            break;
          case 'event_type_medical':
            payload = {
              ...basePayload,
              type: 'event_type_medical',
              isInjury: Boolean(ext.isInjury ?? false),
              doctor: ext.doctor ? String(ext.doctor) : undefined,
            };
            break;
          case 'event_type_meeting':
            payload = { ...basePayload, type: 'event_type_meeting' };
            break;
          default: {
            // WR-11: exhaustive-check guard. A new EventTypeCode added in
            // Phase 4+ becomes a compile error here.
            const _exhaustive: never = typeCode;
            throw new Error(
              `Unreachable EventTypeCode: ${String(_exhaustive)}`,
            );
          }
        }

        await updateMutation.mutateAsync(payload);
        toast.success(tToast('moved'));
        await utils.calendar.list.invalidate();
        setState(null);
      } catch (err: unknown) {
        // tRPC error: data.code === 'CONFLICT' + cause.conflicts[]
        const e = err as {
          data?: { code?: string };
          cause?: { conflicts?: RedactedConflict[] };
        };
        if (
          e.data?.code === 'CONFLICT' &&
          Array.isArray(e.cause?.conflicts) &&
          e.cause.conflicts.length > 0
        ) {
          setState({ conflicts: e.cause.conflicts, pending: detail });
          return;
        }
        toast.error(tToast('error'));
        detail.revert();
        setState(null);
      }
    },
    [utils, updateMutation, tToast],
  );

  useEffect(() => {
    function onMove(e: Event) {
      const detail = (e as CustomEvent<PendingMove>).detail;
      if (!detail || !detail.eventId || !detail.newStart || !detail.newEnd) {
        return;
      }
      void attemptMove(detail, false);
    }

    document.addEventListener('calendar:event-drop', onMove);
    document.addEventListener('calendar:event-resize', onMove);
    return () => {
      document.removeEventListener('calendar:event-drop', onMove);
      document.removeEventListener('calendar:event-resize', onMove);
    };
  }, [attemptMove]);

  if (!state) return null;

  const first = state.conflicts[0];
  if (!first) return null;
  const typeLabel = tLookup(first.typeCode);
  const detail =
    first.detailMode === 'full' && first.title
      ? t('detailFull', { title: first.title, typeLabel })
      : t('detailRedacted', { typeLabel });
  const start =
    first.startsAt instanceof Date ? first.startsAt : new Date(first.startsAt);
  const end =
    first.endsAt instanceof Date ? first.endsAt : new Date(first.endsAt);
  const body = t('body', {
    participant: first.participant,
    detail,
    start: fmtTime(start),
    end: fmtTime(end),
  });

  return (
    <div className="my-2">
      <Alert>
        <AlertTriangle />
        <AlertTitle>{t('title')}</AlertTitle>
        <AlertDescription>
          <div className="text-sm leading-relaxed">
            {renderMarkdownBold(body)}
          </div>
          {state.conflicts.length > 1 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t('extra', { n: state.conflicts.length - 1 })}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                // Re-submit with force:true; banner clears on success
                // inside attemptMove.
                const pending = state.pending;
                setState(null);
                void attemptMove(pending, true);
              }}
              disabled={updateMutation.isPending}
            >
              {t('moveAnyway')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                state.pending.revert();
                setState(null);
              }}
              disabled={updateMutation.isPending}
            >
              {t('undoMove')}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
