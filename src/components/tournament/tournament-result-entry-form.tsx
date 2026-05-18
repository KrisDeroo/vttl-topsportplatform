'use client';

/**
 * <TournamentResultEntryForm> — atomic single-screen entry form (D-69 + D-80).
 *
 * Two sections per UI4-D10:
 *  - Top:    final-ranking dropdown (<LookupSelect category="outcome_level">)
 *            + read-only age-category snapshot label.
 *  - Bottom: <MatchResultsTable> add-row-as-needed table.
 *
 * Single bottom sticky Save commits `{outcome, matches[]}` atomically via
 * `trpc.tournament.enterResult.useMutation` with fresh UUIDv4
 * `_meta.idempotencyKey` per submit (T-04-51 + T-04-25 mitigation).
 *
 * Modes:
 *  - read-only (14d wall expired for player caller OR ?mode=read) →
 *    UI4-D21: inputs disabled + top `<Alert>` with
 *    `errors.tournament.entryWindowExpired`; no Save button.
 *  - overwrite (TD on existing row) → UI4-D12 header badge
 *    `tournament.result.overwriteBadge`.
 *  - backfill (trainer past 14d) → UI4-D12 header badge
 *    `tournament.result.backfillBadge`.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentResultEntryForm
 *            row), 04-CONTEXT.md D-69 + D-71 + D-73 + D-75 + D-80.
 */
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  MatchResultsTable,
  OUTCOME_TO_ROUND_MAP,
  type TournamentResultFormShape,
} from '@/components/tournament/match-results-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/trpc-client';

const OUTCOME_CODES: readonly string[] = [
  'outcome_winner',
  'outcome_finalist',
  'outcome_last_4',
  'outcome_last_8',
  'outcome_last_16',
  'outcome_last_32',
  'outcome_last_64',
  'outcome_last_128',
  'outcome_group_stage',
];

export interface TournamentResultEntryFormProps {
  tournamentEventId: string;
  playerUserId: string;
  ageCategoryCode: string | null;
  initial?: {
    outcome: string;
    matches: TournamentResultFormShape['matches'];
  } | undefined;
  /** Caller-derived flags determining mode. */
  readOnly?: boolean | undefined;
  isOverwrite?: boolean | undefined;
  isBackfill?: boolean | undefined;
  /** Locale for navigation after save. */
  locale: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

function makeDefaultMatch(round: string): TournamentResultFormShape['matches'][number] {
  return {
    round,
    opponent: '',
    opponentRanking: null,
    matchDate: new Date(),
    setsWon: 0,
    setsLost: 0,
    videoLink: null,
  };
}

export function TournamentResultEntryForm({
  tournamentEventId,
  playerUserId,
  ageCategoryCode,
  initial,
  readOnly,
  isOverwrite,
  isBackfill,
  locale,
}: TournamentResultEntryFormProps) {
  const t = useTranslations('tournament.result');
  const tEntry = useTranslations('tournament');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors.tournament');
  const tLookupOutcome = useTranslations('lookup.outcomeLevel');
  const router = useRouter();
  const utils = trpc.useUtils();

  const [idempotencyKey, setIdempotencyKey] = React.useState(() =>
    generateIdempotencyKey(),
  );

  const defaultOutcome = initial?.outcome ?? 'outcome_winner';
  const defaultRound =
    OUTCOME_TO_ROUND_MAP[defaultOutcome] ?? 'round_other';
  const form = useForm<TournamentResultFormShape>({
    defaultValues: {
      outcome: defaultOutcome,
      matches:
        initial?.matches && initial.matches.length > 0
          ? initial.matches
          : [makeDefaultMatch(defaultRound)],
    },
  });

  const matchesField = useFieldArray({
    control: form.control,
    name: 'matches',
  });

  const mutation = trpc.tournament.enterResult.useMutation({
    onSuccess: () => {
      toast.success(t('save'));
      void utils.tournament.listPendingForPlayer.invalidate();
      void utils.tournament.listResults.invalidate();
      setIdempotencyKey(generateIdempotencyKey());
      router.push(`/${locale}/tournaments/${tournamentEventId}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function onSubmit(data: TournamentResultFormShape) {
    if (data.matches.length === 0) {
      toast.error(tErrors('atLeastOneMatchRequired'));
      return;
    }
    mutation.mutate({
      tournamentEventId,
      playerUserId,
      outcome: data.outcome,
      matches: data.matches.map((m) => ({
        round: m.round,
        opponent: m.opponent,
        opponentRanking: m.opponentRanking,
        matchDate: m.matchDate,
        setsWon: m.setsWon,
        setsLost: m.setsLost,
        videoLink: m.videoLink,
      })),
      _meta: { idempotencyKey },
    });
  }

  if (readOnly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>{t('title')}</AlertTitle>
            <AlertDescription>{tErrors('entryWindowExpired')}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {(isOverwrite || isBackfill) && (
        <div>
          {isOverwrite && (
            <Badge className="bg-state-needs-action-bg text-state-needs-action-fg border-state-needs-action-border">
              {t('overwriteBadge')}
            </Badge>
          )}
          {isBackfill && !isOverwrite && (
            <Badge className="bg-state-needs-action-bg text-state-needs-action-fg border-state-needs-action-border">
              {t('backfillBadge')}
            </Badge>
          )}
        </div>
      )}

      {/* Section 1 — Outcome + Age Category snapshot */}
      <Card>
        <CardHeader>
          <CardTitle>{t('section.outcome')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">{t('field.outcome')}*</label>
              <Select
                value={form.watch('outcome')}
                onValueChange={(v) =>
                  form.setValue('outcome', v, { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {tLookupOutcome(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                {t('field.ageCategory')}
              </label>
              <div className="mt-2 text-sm">{ageCategoryCode ?? '—'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Match Results */}
      <Card>
        <CardHeader>
          <CardTitle>{t('section.matches')}</CardTitle>
        </CardHeader>
        <CardContent>
          <MatchResultsTable form={form} matchesField={matchesField} />
        </CardContent>
      </Card>

      {/* Sticky Save */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background p-4 md:static md:mx-0 md:border-0 md:p-0">
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {tCommon('loading')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
