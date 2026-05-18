'use client';

/**
 * <MultiDayPicker> — BYDAY 7-toggle picker (D-85 + UI4-D19).
 *
 * 7 Toggle buttons in a row: Ma | Di | Wo | Do | Vr | Za | Zo (Monday
 * weekstart, locale-aware abbreviations from `lookup.rrule.days.*`).
 * 40x40 desktop / 44x44 mobile tap target per UI-SPEC.
 *
 * Preview line below shows joined selection via `lookup.rrule.bydayPreview`.
 *
 * Serializes selected days to RFC 5545 BYDAY string (`MO,TU,...`) — the
 * 2-letter codes are always English regardless of UI locale (RFC compliance).
 *
 * Validation: min-1 via Zod refine `.min(1, { message: 'errors.calendar.rruleBydayRequired' })`.
 *
 * Reference: 04-UI-SPEC.md §RruleEditor Scope Picker + BYDAY Layout
 *            §BYDAY picker (UI4-D19), 04-CONTEXT.md D-85.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Toggle } from '@/components/ui/toggle';

/** RFC 5545 BYDAY 2-letter codes (English regardless of UI locale). */
export const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type BydayCode = (typeof BYDAY_CODES)[number];

/** Map BYDAY code → i18n abbreviation key (`lookup.rrule.days.{mo|tu|...}`). */
const DAY_KEY_BY_CODE: Record<BydayCode, string> = {
  MO: 'mo',
  TU: 'tu',
  WE: 'we',
  TH: 'th',
  FR: 'fr',
  SA: 'sa',
  SU: 'su',
};

export interface MultiDayPickerProps {
  /** Array of selected BYDAY 2-letter codes. */
  value: readonly BydayCode[];
  onChange: (next: BydayCode[]) => void;
  disabled?: boolean;
  /** Optional aria-label for the toggle group. */
  ariaLabel?: string;
}

export function MultiDayPicker({
  value,
  onChange,
  disabled,
  ariaLabel,
}: MultiDayPickerProps) {
  const tDays = useTranslations('lookup.rrule.days');
  const tPreview = useTranslations('lookup.rrule');

  const selected = new Set<BydayCode>(value);

  function toggle(code: BydayCode) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    // Maintain ordering by canonical Mo..Su order.
    const ordered = BYDAY_CODES.filter((c) => next.has(c));
    onChange(ordered);
  }

  const previewText =
    selected.size > 0
      ? BYDAY_CODES.filter((c) => selected.has(c))
          .map((c) => tDays(DAY_KEY_BY_CODE[c]))
          .join(' + ')
      : '';

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1"
      >
        {BYDAY_CODES.map((code) => {
          const isSelected = selected.has(code);
          return (
            <Toggle
              key={code}
              pressed={isSelected}
              onPressedChange={() => toggle(code)}
              disabled={disabled}
              aria-label={tDays(DAY_KEY_BY_CODE[code])}
              className="h-10 w-10 min-h-11 min-w-11 sm:min-h-10 sm:min-w-10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {tDays(DAY_KEY_BY_CODE[code])}
            </Toggle>
          );
        })}
      </div>
      {selected.size > 0 && (
        <p className="text-xs text-muted-foreground">
          {tPreview('bydayPreview', { days: previewText })}
        </p>
      )}
    </div>
  );
}
