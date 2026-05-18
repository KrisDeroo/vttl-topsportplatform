'use client';

/**
 * <DerivedWonLostIndicator> — pure render (D-81).
 *
 * Won/lost is DERIVED at query time from sets_won vs sets_lost — never
 * stored as a column, never editable. This component is the read-side
 * display: green dot + "Gewonnen" when setsWon > setsLost; red dot +
 * "Verloren" when setsWon < setsLost; neutral em-dash otherwise.
 *
 * Accessibility (UI-SPEC §Color is NEVER the only signifier): color is
 * always paired with the text label.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (DerivedWonLostIndicator
 *            row), 04-CONTEXT.md D-81.
 */
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

export interface DerivedWonLostIndicatorProps {
  setsWon: number;
  setsLost: number;
}

export function DerivedWonLostIndicator({
  setsWon,
  setsLost,
}: DerivedWonLostIndicatorProps) {
  const t = useTranslations('tournament.matchResults');
  if (!Number.isFinite(setsWon) || !Number.isFinite(setsLost)) {
    return <span className="text-muted-foreground" aria-label={t('draw')}>—</span>;
  }
  if (setsWon === 0 && setsLost === 0) {
    return <span className="text-muted-foreground" aria-label={t('draw')}>—</span>;
  }
  if (setsWon > setsLost) {
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <span
          className={cn(
            'inline-block size-2 rounded-full bg-green-600 dark:bg-green-500',
          )}
          aria-hidden
        />
        {t('won')}
      </span>
    );
  }
  if (setsWon < setsLost) {
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <span
          className={cn(
            'inline-block size-2 rounded-full bg-state-nudge-critical-border',
          )}
          aria-hidden
        />
        {t('lost')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <span className="inline-block size-2 rounded-full bg-muted-foreground" aria-hidden />
      {t('draw')}
    </span>
  );
}
