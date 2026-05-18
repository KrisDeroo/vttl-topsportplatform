'use client';

/**
 * <MatchResultsTable> — repeating match-row composer (D-80 add-row-as-needed).
 *
 * Used by <TournamentResultEntryForm>. Owns the matches[] field array
 * (react-hook-form `useFieldArray`). First row's `round` is derived
 * from the parent's selected outcome via outcome→round map per UI-SPEC
 * §"Outcome → first-row round derivation map".
 *
 * Layout per UI-SPEC §Component Inventory:
 *   [Ronde* | Tegenstander* | Ranking opp. | Datum* | Sets gewonnen* |
 *    Sets verloren* | Resultaat | Video | ✕]
 *
 * Mobile (UI4-D22): below md breakpoint each row is a Card stack with
 * fields stacked vertically; row-remove via "⋮" DropdownMenu.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (MatchResultsTable row),
 *            §Mobile Strategy, 04-CONTEXT.md D-80.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  Controller,
  type UseFieldArrayReturn,
  type UseFormReturn,
} from 'react-hook-form';

import { DerivedWonLostIndicator } from '@/components/tournament/derived-won-lost-indicator';
import { SetTallyInput } from '@/components/tournament/set-tally-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface MatchRowFormValue {
  round: string;
  opponent: string;
  opponentRanking: number | null;
  matchDate: Date;
  setsWon: number;
  setsLost: number;
  videoLink: string | null;
}

export interface TournamentResultFormShape {
  outcome: string;
  matches: MatchRowFormValue[];
}

/**
 * Outcome → first-row round derivation map per UI-SPEC §"Outcome →
 * first-row round derivation map" / §"Critical copy samples".
 */
export const OUTCOME_TO_ROUND_MAP: Record<string, string> = {
  outcome_winner: 'round_final',
  outcome_finalist: 'round_final',
  outcome_last_4: 'round_semi',
  outcome_last_8: 'round_quarter',
  outcome_last_16: 'round_eighth',
  outcome_last_32: 'round_sixteenth',
  outcome_last_64: 'round_thirty_second',
  outcome_last_128: 'round_sixty_fourth',
  outcome_group_stage: 'round_group_stage',
};

const ROUND_CODES: readonly string[] = [
  'round_final',
  'round_semi',
  'round_quarter',
  'round_eighth',
  'round_sixteenth',
  'round_thirty_second',
  'round_sixty_fourth',
  'round_one_twenty_eighth',
  'round_group_stage',
  'round_other',
];

function emptyRow(round: string): MatchRowFormValue {
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

interface MatchResultsTableProps {
  form: UseFormReturn<TournamentResultFormShape>;
  matchesField: UseFieldArrayReturn<TournamentResultFormShape, 'matches'>;
  disabled?: boolean;
}

export function MatchResultsTable({
  form,
  matchesField,
  disabled,
}: MatchResultsTableProps) {
  const t = useTranslations('tournament.matchResults');
  const tEntry = useTranslations('tournament.result');
  const tLookupRound = useTranslations('lookup.tournamentRound');

  const watchedOutcome = form.watch('outcome');

  // Derive first-row round from outcome (UI-SPEC outcome→round map).
  React.useEffect(() => {
    const derived = OUTCOME_TO_ROUND_MAP[watchedOutcome];
    if (derived && matchesField.fields.length > 0) {
      const currentRound = form.getValues('matches.0.round');
      if (!currentRound || currentRound !== derived) {
        form.setValue('matches.0.round', derived, { shouldDirty: false });
      }
    }
  }, [watchedOutcome, matchesField.fields.length, form]);

  function addRow() {
    const defaultRound =
      OUTCOME_TO_ROUND_MAP[watchedOutcome] ?? 'round_other';
    matchesField.append(emptyRow(defaultRound));
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('column.round')}*</TableHead>
              <TableHead>{t('column.opponent')}*</TableHead>
              <TableHead>{t('column.opponentRanking')}</TableHead>
              <TableHead>{t('column.date')}*</TableHead>
              <TableHead>{t('column.setsWon')}*</TableHead>
              <TableHead>{t('column.setsLost')}*</TableHead>
              <TableHead>{t('column.result')}</TableHead>
              <TableHead>{t('column.video')}</TableHead>
              <TableHead aria-hidden />
            </TableRow>
          </TableHeader>
          <TableBody>
            {matchesField.fields.map((field, idx) => {
              const row = form.watch(`matches.${idx}`);
              return (
                <TableRow key={field.id}>
                  <TableCell>
                    <Controller
                      control={form.control}
                      name={`matches.${idx}.round`}
                      render={({ field: f }) => (
                        <Select
                          value={f.value}
                          onValueChange={f.onChange}
                          disabled={disabled ?? false}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROUND_CODES.map((code) => (
                              <SelectItem key={code} value={code}>
                                {tLookupRound(code)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={row?.opponent ?? ''}
                      onChange={(e) =>
                        form.setValue(`matches.${idx}.opponent`, e.target.value, {
                          shouldDirty: true,
                        })
                      }
                      maxLength={200}
                      disabled={disabled}
                      className="w-[200px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      value={row?.opponentRanking ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        form.setValue(
                          `matches.${idx}.opponentRanking`,
                          v === '' ? null : Math.max(1, Number(v)),
                          { shouldDirty: true },
                        );
                      }}
                      disabled={disabled}
                      className="w-24 tabular-nums"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={
                        row?.matchDate instanceof Date
                          ? row.matchDate.toISOString().slice(0, 10)
                          : ''
                      }
                      onChange={(e) =>
                        form.setValue(
                          `matches.${idx}.matchDate`,
                          new Date(e.target.value),
                          { shouldDirty: true },
                        )
                      }
                      disabled={disabled}
                      className="w-[150px] tabular-nums"
                    />
                  </TableCell>
                  <TableCell>
                    <SetTallyInput
                      value={row?.setsWon ?? 0}
                      onChange={(v) =>
                        form.setValue(`matches.${idx}.setsWon`, v, {
                          shouldDirty: true,
                        })
                      }
                      disabled={disabled}
                      ariaLabel={t('column.setsWon')}
                    />
                  </TableCell>
                  <TableCell>
                    <SetTallyInput
                      value={row?.setsLost ?? 0}
                      onChange={(v) =>
                        form.setValue(`matches.${idx}.setsLost`, v, {
                          shouldDirty: true,
                        })
                      }
                      disabled={disabled}
                      ariaLabel={t('column.setsLost')}
                    />
                  </TableCell>
                  <TableCell>
                    <DerivedWonLostIndicator
                      setsWon={row?.setsWon ?? 0}
                      setsLost={row?.setsLost ?? 0}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="url"
                      value={row?.videoLink ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        form.setValue(
                          `matches.${idx}.videoLink`,
                          v === '' ? null : v,
                          { shouldDirty: true },
                        );
                      }}
                      maxLength={500}
                      disabled={disabled}
                      className="w-[180px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => matchesField.remove(idx)}
                      disabled={disabled || matchesField.fields.length === 1}
                      aria-label={t('removeRow.aria')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card stack */}
      <div className="space-y-3 md:hidden">
        {matchesField.fields.map((field, idx) => {
          const row = form.watch(`matches.${idx}`);
          return (
            <div key={field.id} className="rounded-md border p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">{t('column.round')}*</label>
                  <Controller
                    control={form.control}
                    name={`matches.${idx}.round`}
                    render={({ field: f }) => (
                      <Select
                        value={f.value}
                        onValueChange={f.onChange}
                        disabled={disabled ?? false}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROUND_CODES.map((code) => (
                            <SelectItem key={code} value={code}>
                              {tLookupRound(code)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">{t('column.date')}*</label>
                  <Input
                    type="date"
                    value={
                      row?.matchDate instanceof Date
                        ? row.matchDate.toISOString().slice(0, 10)
                        : ''
                    }
                    onChange={(e) =>
                      form.setValue(
                        `matches.${idx}.matchDate`,
                        new Date(e.target.value),
                        { shouldDirty: true },
                      )
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">{t('column.opponent')}*</label>
                <Input
                  value={row?.opponent ?? ''}
                  onChange={(e) =>
                    form.setValue(`matches.${idx}.opponent`, e.target.value, {
                      shouldDirty: true,
                    })
                  }
                  maxLength={200}
                  disabled={disabled}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="text-xs font-medium">{t('column.setsWon')}*</label>
                  <SetTallyInput
                    value={row?.setsWon ?? 0}
                    onChange={(v) =>
                      form.setValue(`matches.${idx}.setsWon`, v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={disabled}
                    ariaLabel={t('column.setsWon')}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">{t('column.setsLost')}*</label>
                  <SetTallyInput
                    value={row?.setsLost ?? 0}
                    onChange={(v) =>
                      form.setValue(`matches.${idx}.setsLost`, v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={disabled}
                    ariaLabel={t('column.setsLost')}
                  />
                </div>
                <DerivedWonLostIndicator
                  setsWon={row?.setsWon ?? 0}
                  setsLost={row?.setsLost ?? 0}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => matchesField.remove(idx)}
                  disabled={disabled || matchesField.fields.length === 1}
                  aria-label={t('removeRow.aria')}
                >
                  <Trash2 className="mr-2 size-4" />
                  {t('removeRow.aria')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <Button type="button" variant="outline" onClick={addRow} disabled={disabled}>
          <Plus className="mr-1 size-4" />
          {tEntry('addMatch')}
        </Button>
      </div>
    </div>
  );
}
