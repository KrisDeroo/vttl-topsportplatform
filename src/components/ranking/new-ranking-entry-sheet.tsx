'use client';

/**
 * <NewRankingEntrySheet> — right-side Sheet for D-86 + D-89 ranking entry.
 *
 * Conditional value input swap based on selected ranking type:
 *   - numeric input for the 4 international types (Senior/Youth World/European)
 *   - <Select> over belgium_classification codes for ranking_belgium
 *
 * Submits via `trpc.ranking.addEntry.useMutation` with fresh UUIDv4
 * idempotency key (T-04-51). Always-visible disclaimer per UI4-D24.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (NewRankingEntrySheet row),
 *            04-CONTEXT.md D-86 + D-89 + UI4-D17 + UI4-D24.
 */
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { RANKING_TYPE_CODES, type RankingTypeCode } from '@/components/ranking/ranking-type-selector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { trpc } from '@/lib/trpc-client';

// 67 Belgium classification codes (per UI-SPEC + migration 0017 seed).
// A1..A50 + B0/2/4/6 + C0..C6 + D0..D6 + E0..E6 + NC.
const BELGIUM_CODES: readonly string[] = [
  ...Array.from({ length: 50 }, (_, i) => `A${i + 1}`),
  'B0', 'B2', 'B4', 'B6',
  'C0', 'C2', 'C4', 'C6',
  'D0', 'D2', 'D4', 'D6',
  'E0', 'E2', 'E4', 'E6',
  'NC',
];

interface FormShape {
  rankingTypeCode: RankingTypeCode;
  recordedAt: string;
  /** numeric value as string for the input; coerced on submit. */
  numericValue: string;
  classificationCode: string;
}

interface NewRankingEntrySheetProps {
  playerUserId: string;
  defaultRankingTypeCode?: RankingTypeCode;
  /** Trigger element — defaults to button "+ Toevoegen". */
  triggerLabel?: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function NewRankingEntrySheet({
  playerUserId,
  defaultRankingTypeCode,
  triggerLabel,
}: NewRankingEntrySheetProps) {
  const t = useTranslations('ranking.entry');
  const tCommon = useTranslations('common');
  const tLookupType = useTranslations('lookup.rankingType');
  const tErrRanking = useTranslations('errors.ranking');
  const utils = trpc.useUtils();
  const [open, setOpen] = React.useState(false);
  const [idempotencyKey, setIdempotencyKey] = React.useState(() =>
    generateIdempotencyKey(),
  );

  const form = useForm<FormShape>({
    defaultValues: {
      rankingTypeCode: defaultRankingTypeCode ?? 'ranking_senior_world',
      recordedAt: new Date().toISOString().slice(0, 10),
      numericValue: '',
      classificationCode: 'A1',
    },
  });

  const watchedType = form.watch('rankingTypeCode');
  const isBelgium = watchedType === 'ranking_belgium';

  const mutation = trpc.ranking.addEntry.useMutation({
    onSuccess: () => {
      toast.success(t('save'));
      void utils.ranking.getHistory.invalidate();
      void utils.ranking.listEntries.invalidate();
      setIdempotencyKey(generateIdempotencyKey());
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err.message),
  });

  function onSubmit(data: FormShape) {
    const value = isBelgium
      ? { kind: 'classification' as const, code: data.classificationCode }
      : {
          kind: 'numeric' as const,
          value: Number(data.numericValue),
        };
    if (value.kind === 'numeric' && (!Number.isFinite(value.value) || value.value <= 0)) {
      toast.error(tErrRanking('mustBePositive'));
      return;
    }
    mutation.mutate({
      playerUserId,
      rankingTypeCode: data.rankingTypeCode,
      recordedAt: new Date(data.recordedAt),
      source: 'manual',
      value,
      _meta: { idempotencyKey },
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-1 size-4" />
          {triggerLabel ?? t('title')}
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('disclaimer')}</SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 px-4 pb-4">
          <div>
            <Label>{t('field.type')}*</Label>
            <Select
              value={form.watch('rankingTypeCode')}
              onValueChange={(v) =>
                form.setValue('rankingTypeCode', v as RankingTypeCode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANKING_TYPE_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {tLookupType(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('field.date')}*</Label>
            <Input type="date" {...form.register('recordedAt', { required: true })} />
          </div>
          {isBelgium ? (
            <div>
              <Label>{t('field.value.belgium')}*</Label>
              <Select
                value={form.watch('classificationCode')}
                onValueChange={(v) => form.setValue('classificationCode', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BELGIUM_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>{t('field.value.international')}*</Label>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                {...form.register('numericValue', { required: true })}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('disclaimer')}</p>
        </form>
        <SheetFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={form.handleSubmit(onSubmit)} disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {tCommon('loading')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
