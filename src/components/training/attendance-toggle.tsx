'use client';

/**
 * <AttendanceToggle> — three-state attendance toggle for the per-session
 * bulk score form (D-62).
 *
 * Three states:
 *   - true   → present
 *   - false  → absent (covers both "absent" and "absent_medical"; the
 *              DB column does not distinguish — feedback_text or the
 *              hasMedicalConflict server flag carries the reason).
 *   - null   → pending (default; trainer hasn't decided yet).
 *
 * DOM-MED-CONFLICT-02 behaviour (UI4-D04): when `hasMedicalConflict`
 * is true on initial mount AND the current value is null (pending), the
 * toggle pre-selects "absent" and surfaces a tooltip explaining the
 * medical-conflict reason. The trainer can override at any time.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (AttendanceToggle row),
 *            04-CONTEXT.md D-62 + DOM-MED-CONFLICT-02.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export interface AttendanceToggleProps {
  /** Current attendance value (null = pending / not yet answered). */
  value: boolean | null;
  /** Called with next attendance value. */
  onChange: (next: boolean | null) => void;
  /** DOM-MED-CONFLICT-02: server-flagged medical-event overlap for this user. */
  hasMedicalConflict?: boolean;
  disabled?: boolean;
  name?: string;
}

export function AttendanceToggle({
  value,
  onChange,
  hasMedicalConflict,
  disabled,
  name,
}: AttendanceToggleProps) {
  const t = useTranslations('training.score.attendance');
  // Pre-select 'absent' on first mount if hasMedicalConflict and value is null.
  React.useEffect(() => {
    if (hasMedicalConflict && value === null && !disabled) {
      onChange(false);
    }
    // run only on initial mount + when hasMedicalConflict changes; trainer
    // overrides are preserved (we don't reset on subsequent renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMedicalConflict]);

  const stringValue = value === true ? 'present' : value === false ? 'absent' : '';

  function onValueChange(next: string) {
    if (disabled) return;
    if (next === 'present') onChange(true);
    else if (next === 'absent') onChange(false);
    else onChange(null);
  }

  const absentLabel = hasMedicalConflict ? t('absentMedical') : t('absent');

  return (
    <div className={cn('inline-flex items-center gap-2', disabled && 'opacity-50')} data-name={name}>
      <ToggleGroup
        type="single"
        value={stringValue}
        onValueChange={onValueChange}
        disabled={disabled ?? false}
        aria-label={t('present')}
      >
        <ToggleGroupItem value="present" className="px-3" aria-label={t('present')}>
          {t('present')}
        </ToggleGroupItem>
        {hasMedicalConflict ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="absent" className="px-3" aria-label={absentLabel}>
                  {absentLabel}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{t('absentMedical')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <ToggleGroupItem value="absent" className="px-3" aria-label={absentLabel}>
            {absentLabel}
          </ToggleGroupItem>
        )}
      </ToggleGroup>
      {value === null && (
        <span className="text-xs text-muted-foreground">{t('pending')}</span>
      )}
    </div>
  );
}
