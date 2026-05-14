/**
 * <EventDeleteDialog> — destructive confirmation for `calendar.event.delete`
 * (D-58 operation 1 — hard delete).
 *
 * Copy (D-58b):
 *   title:   "Afspraak verwijderen?"
 *   body:    "Deze afspraak wordt definitief verwijderd voor alle deelnemers."
 *   confirm: "Verwijderen"
 *   cancel:  "Niet verwijderen"
 *
 * D-58b is an explicit override of the more generic "30-day-restore" copy
 * pattern that ships in some Phase 1/2 destructive dialogs — calendar events
 * are NOT soft-deleted in v1 (Phase 3 schema has no `deleted_at` column).
 * The audit_log capture in `calendar.event.delete` writes a JSONB snapshot
 * BEFORE the row is dropped (D-58c cascade order; Pitfall 9 cap of 1000
 * exceptions), so admin recovery is possible from the audit table — but it
 * is not a user-facing "Undo" affordance in v1.
 *
 * Reference: .planning/phases/03-kalender/03-CONTEXT.md D-58 + D-58b
 *            .planning/phases/03-kalender/03-UI-SPEC.md §Copywriting Contract
 *            (calendar.event.delete.* keys)
 *            src/server/trpc/routers/calendar.ts event.delete
 */
'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { trpc } from '@/lib/trpc-client';

interface Props {
  eventId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventDeleteDialog({ eventId, open, onOpenChange }: Props) {
  const t = useTranslations('calendar.event.delete');
  const tToast = useTranslations('calendar.event.toast');
  const deleteMutation = trpc.calendar.event.delete.useMutation();
  const utils = trpc.useUtils();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (!eventId) return;
              deleteMutation.mutate(
                { eventId },
                {
                  onSuccess: () => {
                    toast.success(tToast('deleted'));
                    void utils.calendar.list.invalidate();
                    onOpenChange(false);
                  },
                  onError: () => toast.error(tToast('error')),
                },
              );
            }}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
