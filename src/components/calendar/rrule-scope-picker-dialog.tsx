'use client';

/**
 * <RruleScopePickerDialog> — pre-save scope picker modal (D-84 + UI4-D18).
 *
 * shadcn <AlertDialog> with 3 scope options:
 *   - "Deze afspraak" (default) — single-occurrence; writes
 *     calendar_event_exceptions row (Phase 3 path).
 *   - "Deze en toekomstige" — server split-and-rewrite (D-84 Plan 04-06).
 *   - "Alle in de reeks" — server in-place update.
 *
 * Each option shows a sentence-style preview with formatDate. Replaces
 * the Phase 3 disabled-with-"Komt in Fase 4" tooltip on the scope radio.
 *
 * Reference: 04-UI-SPEC.md §RruleEditor Scope Picker + BYDAY Layout
 *            §Scope picker dialog (UI4-D18), 04-CONTEXT.md D-84.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type RruleScope = 'single' | 'this_and_future' | 'all_in_series';

export interface RruleScopePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The occurrence date being edited (used in the preview sentence). */
  occurrenceDate: Date;
  /** Called when the user confirms a scope. */
  onConfirm: (scope: RruleScope) => void;
  /** Called when the user cancels (open also flips to false). */
  onCancel?: () => void;
  locale?: string;
}

const boldChunk = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

export function RruleScopePickerDialog({
  open,
  onOpenChange,
  occurrenceDate,
  onConfirm,
  onCancel,
  locale = 'nl',
}: RruleScopePickerDialogProps) {
  const t = useTranslations('calendar.event.recurrence');
  const [scope, setScope] = React.useState<RruleScope>('single');

  const dateStr = occurrenceDate.toLocaleDateString(
    locale === 'en' ? 'en-GB' : `${locale}-BE`,
    { day: '2-digit', month: '2-digit', year: 'numeric' },
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('scopeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('scopeBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          value={scope}
          onValueChange={(v) => setScope(v as RruleScope)}
          className="space-y-3"
        >
          <div className="rounded-md border p-3">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="single" id="scope-single" />
              <div className="space-y-1">
                <Label htmlFor="scope-single" className="font-medium">
                  {t('scopeThis')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t.rich('scopeThisPreview', { date: dateStr, b: boldChunk })}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="this_and_future" id="scope-future" />
              <div className="space-y-1">
                <Label htmlFor="scope-future" className="font-medium">
                  {t('scopeFuture')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t.rich('scopeFuturePreview', { date: dateStr, b: boldChunk })}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="all_in_series" id="scope-all" />
              <div className="space-y-1">
                <Label htmlFor="scope-all" className="font-medium">
                  {t('scopeAll')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t.rich('scopeAllPreview', { b: boldChunk })}
                </p>
              </div>
            </div>
          </div>
        </RadioGroup>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(scope)}>
            {t('apply')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
