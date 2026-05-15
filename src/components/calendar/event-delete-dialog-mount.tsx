/**
 * <EventDeleteDialogMount> — tiny Client wrapper that owns the AlertDialog
 * `open` state for <EventDeleteDialog>.
 *
 * <EventDeleteDialog> is a pure controlled component (props: eventId / open
 * / onOpenChange). Mounting it at page level requires SOMETHING that holds
 * state and listens for `calendar:open-delete`. This wrapper is that
 * something. Lives next to the dialog so the imports/exports stay co-located.
 *
 * The dispatch comes from <EventDetailSheet>'s "Afspraak verwijderen" button.
 *
 * Reference: .planning/phases/03-kalender/03-07-PLAN.md Task 3
 */
'use client';

import { useEffect, useState } from 'react';

import { EventDeleteDialog } from './event-delete-dialog';

export function EventDeleteDialogMount() {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ eventId?: string }>).detail;
      if (detail?.eventId) setEventId(detail.eventId);
    }
    document.addEventListener('calendar:open-delete', handler);
    return () => document.removeEventListener('calendar:open-delete', handler);
  }, []);

  return (
    <EventDeleteDialog
      eventId={eventId}
      open={eventId !== null}
      onOpenChange={(open) => {
        if (!open) setEventId(null);
      }}
    />
  );
}
