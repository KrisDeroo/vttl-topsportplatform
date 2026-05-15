/**
 * <EventDetailSheet> — read-mode Sheet for a calendar event.
 *
 * Listens for `calendar:open-detail` (Plan 06 dispatch from <CalendarView>
 * onEventClick) with `{ eventId, occurrenceDate }`. Fetches via
 * `trpc.calendar.event.get` and renders the read view:
 *   - title + type chip (UI-SPEC §Component Inventory line 298)
 *   - Wanneer / Waar / Wie sections (UI-SPEC §Copywriting Contract)
 *   - Description (multi-line)
 *   - Role-gated action buttons:
 *       - "Afspraak bewerken" → dispatches `calendar:open-edit`
 *       - "Afspraak verwijderen" → dispatches `calendar:open-delete`
 *       - "Ik kan niet aanwezig zijn" → calls
 *         `trpc.calendar.event.declineParticipation`
 *
 * The action buttons are always rendered; the server enforces RBAC:
 *   - update / delete → RLS narrows to creator + TD; NOT_FOUND if forbidden
 *   - declineParticipation → only updates the participant row matching the
 *     caller's userId; NOT_FOUND if the caller isn't a participant
 * Each failure toasts the generic `calendar.event.toast.error` key (D-46).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Component Inventory
 *            (line 298 — EventDetailSheet)
 *            .planning/phases/03-kalender/03-UI-SPEC.md §Interaction Contract
 *            (lines 471-472)
 *            src/server/trpc/routers/calendar.ts event.get / .declineParticipation
 */
'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { trpc } from '@/lib/trpc-client';

export function EventDetailSheet() {
  const t = useTranslations('calendar.event');
  const tToast = useTranslations('calendar.event.toast');
  const tLookup = useTranslations('lookup.eventType');
  const [eventId, setEventId] = useState<string | null>(null);
  const open = eventId !== null;

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ eventId: string }>).detail;
      if (detail?.eventId) setEventId(detail.eventId);
    }
    document.addEventListener('calendar:open-detail', handler);
    return () => document.removeEventListener('calendar:open-detail', handler);
  }, []);

  const { data: event } = trpc.calendar.event.get.useQuery(
    { eventId: eventId ?? '' },
    { enabled: Boolean(eventId), staleTime: 5_000 },
  );

  const decline = trpc.calendar.event.declineParticipation.useMutation();
  const utils = trpc.useUtils();

  function close() {
    setEventId(null);
  }

  function handleDecline() {
    if (!eventId) return;
    decline.mutate(
      { eventId },
      {
        onSuccess: () => {
          toast.success(t('decline.toast'));
          void utils.calendar.list.invalidate();
          close();
        },
        onError: () => toast.error(tToast('error')),
      },
    );
  }

  function handleEdit() {
    if (!event) return;
    document.dispatchEvent(
      new CustomEvent<{ eventId: string }>('calendar:open-edit', {
        detail: { eventId: event.event.id },
      }),
    );
    close();
  }

  function handleDelete() {
    if (!event) return;
    document.dispatchEvent(
      new CustomEvent<{ eventId: string }>('calendar:open-delete', {
        detail: { eventId: event.event.id },
      }),
    );
    close();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && close()}>
      <SheetContent className="sm:max-w-md">
        {event?.event ? (
          <>
            <SheetHeader>
              <SheetTitle>{event.event.title || t('untitled')}</SheetTitle>
              <SheetDescription>
                {tLookup(event.event.typeCode)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-3 px-4">
              <section>
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  {t('sections.when')}
                </div>
                <div className="text-sm">
                  {new Date(event.event.startsAt).toLocaleString()} —{' '}
                  {new Date(event.event.endsAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </section>
              {event.event.location && (
                <section>
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {t('sections.where')}
                  </div>
                  <div className="text-sm">{event.event.location}</div>
                </section>
              )}
              {event.event.description && (
                <section>
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {t('sections.description')}
                  </div>
                  <div className="whitespace-pre-wrap text-sm">
                    {event.event.description}
                  </div>
                </section>
              )}
              {event.participants && event.participants.length > 0 && (
                <section>
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {t('sections.who')}
                  </div>
                  <div className="text-sm">
                    {event.participants.length} {t('fields.participants')}
                  </div>
                </section>
              )}
              {event.event.rrule && (
                <section>
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {t('sections.recurrence')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {event.event.rrule}
                  </div>
                </section>
              )}
            </div>
            <Separator />
            <SheetFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={handleDecline}
                disabled={decline.isPending}
              >
                {t('decline.title')}
              </Button>
              <Button variant="outline" onClick={handleEdit}>
                {t('actions.edit')}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t('actions.delete')}
              </Button>
            </SheetFooter>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>{t('untitled')}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
