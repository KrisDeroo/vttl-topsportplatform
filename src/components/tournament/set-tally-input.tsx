'use client';

/**
 * <SetTallyInput> — numeric stepper for sets_won / sets_lost (D-81).
 *
 * Range 0..4 per DB CHECK `match_results.sets_won/sets_lost BETWEEN 0
 * AND 4`. Cross-field constraint `sets_won + sets_lost ∈ [1, 7]` is
 * enforced at submit time by Zod (the table-tennis best-of-5 vs best-of-7
 * shape).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (SetTallyInput row).
 */
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SetTallyInputProps {
  value: number;
  onChange: (next: number) => void;
  max?: number | undefined;
  disabled?: boolean | undefined;
  ariaLabel?: string | undefined;
}

export function SetTallyInput({
  value,
  onChange,
  max = 4,
  disabled,
  ariaLabel,
}: SetTallyInputProps) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = Number(e.target.value);
        if (!Number.isFinite(raw)) return;
        const clamped = Math.max(0, Math.min(max, Math.floor(raw)));
        onChange(clamped);
      }}
      className={cn('w-20 tabular-nums')}
    />
  );
}
