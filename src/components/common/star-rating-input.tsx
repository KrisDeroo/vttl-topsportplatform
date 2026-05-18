'use client';

/**
 * <StarRatingInput> — 5-star rating input (UI4-D05).
 *
 * v1 UI is 5-star; maps to DB values 2/4/6/8/10 via {@link mapStarsToDb}
 * helper from `@/lib/quality-score` (D-60). v2 will swap to 1..10 numeric
 * stepper or half-stars without migration.
 *
 * Accessibility contract (UI-SPEC §Accessibility Contract):
 *  - Container: `role="radiogroup"` with `aria-labelledby={...}`.
 *  - Each star: `<button role="radio" aria-checked={...} aria-label={...}>`.
 *  - Keyboard:
 *      - `1`..`5` direct-set the value.
 *      - `←` `→` step the value (clamped 0..5).
 *      - `0` or `Esc` clears.
 *      - Click already-filled star → clear (UI4-D05 affordance).
 *  - Color is NEVER the sole signifier — every star is also a labelled
 *    button; the value is exposed via `aria-checked`.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (StarRatingInput row),
 *            §Accessibility Contract §Star rating accessibility,
 *            04-CONTEXT.md D-60 + UI4-D05.
 */
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { mapDbToStars, mapStarsToDb } from '@/lib/quality-score';

type Stars = 0 | 1 | 2 | 3 | 4 | 5;

export interface StarRatingInputProps {
  /** DB-side value (1..10) or null for "not yet scored". */
  value: number | null;
  /** Called with the next DB-side value (or null on clear). */
  onChange: (next: number | null) => void;
  disabled?: boolean;
  ariaLabelledById?: string;
  name?: string;
}

const STAR_VALUES: Stars[] = [1, 2, 3, 4, 5];

export function StarRatingInput({
  value,
  onChange,
  disabled,
  ariaLabelledById,
  name,
}: StarRatingInputProps) {
  const t = useTranslations('training.score.stars');
  const stars = mapDbToStars(value) as Stars;

  const select = React.useCallback(
    (n: Stars) => {
      if (disabled) return;
      if (n === stars) {
        // UI4-D05: click already-filled star → clear.
        onChange(null);
        return;
      }
      onChange(mapStarsToDb(n));
    },
    [disabled, onChange, stars],
  );

  const clear = React.useCallback(() => {
    if (disabled) return;
    onChange(null);
  }, [disabled, onChange]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (['1', '2', '3', '4', '5'].includes(e.key)) {
      e.preventDefault();
      select(Number(e.key) as Stars);
      return;
    }
    if (e.key === '0' || e.key === 'Escape') {
      e.preventDefault();
      clear();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.min(stars + 1, 5) as Stars;
      if (next > 0) select(next);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = Math.max(stars - 1, 0) as Stars;
      if (next === 0) clear();
      else select(next);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={ariaLabelledById}
      aria-disabled={disabled || undefined}
      aria-valuetext={t('aria', { n: stars })}
      className={cn(
        'inline-flex items-center gap-0.5 outline-none',
        disabled && 'opacity-50',
      )}
      onKeyDown={onKeyDown}
      tabIndex={disabled ? -1 : 0}
      data-testid="star-rating-input"
      data-name={name}
    >
      {STAR_VALUES.map((n) => {
        const filled = n <= stars;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={t('aria', { n })}
            disabled={disabled}
            onClick={() => select(n)}
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-sm p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
              disabled && 'cursor-not-allowed',
            )}
            tabIndex={-1}
          >
            <Star
              size={28}
              aria-hidden
              className={cn(
                'transition-colors',
                filled
                  ? 'fill-current text-[var(--cal-event-evalconv-border)]'
                  : 'text-muted-foreground',
              )}
            />
          </button>
        );
      })}
      {stars > 0 && !disabled && (
        <button
          type="button"
          onClick={clear}
          className="ml-2 text-xs text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={t('clear')}
          tabIndex={-1}
        >
          {t('clear')}
        </button>
      )}
    </div>
  );
}
