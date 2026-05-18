'use client';

/**
 * <RangePillSelector> — range pill row (D-90 + UI4-D14).
 *
 * 5 pills: 1m / 6m / 1y / 2y / all. Default 2y per D-90. Hidden when
 * Belgium type active (the timeline shows all-time always).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (RangePillSelector row),
 *            04-CONTEXT.md D-90 + UI4-D14.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export const RANGE_VALUES = ['1m', '6m', '1y', '2y', 'all'] as const;
export type RangeValue = (typeof RANGE_VALUES)[number];

export interface RangePillSelectorProps {
  value: RangeValue;
  onChange: (next: RangeValue) => void;
}

export function rangeToDate(range: RangeValue): Date | undefined {
  const now = Date.now();
  switch (range) {
    case '1m':
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case '6m':
      return new Date(now - 6 * 30 * 24 * 60 * 60 * 1000);
    case '1y':
      return new Date(now - 365 * 24 * 60 * 60 * 1000);
    case '2y':
      return new Date(now - 2 * 365 * 24 * 60 * 60 * 1000);
    case 'all':
      return undefined;
  }
}

export function RangePillSelector({ value, onChange }: RangePillSelectorProps) {
  const t = useTranslations('ranking.range');
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as RangeValue)}
    >
      {RANGE_VALUES.map((r) => (
        <ToggleGroupItem key={r} value={r} className="h-8 px-3">
          {t(r)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
