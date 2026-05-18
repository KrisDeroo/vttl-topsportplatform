/**
 * <RruleEditor> — minimal RFC 5545 RRULE builder for Phase 3 v1.
 *
 * Phase 3 scope (UI-SPEC §Form-field contract "Recurring" row):
 *   - frequency: DAILY / WEEKLY / MONTHLY
 *   - interval: 1–4 (Elke 1–4 …)
 *   - end-mode: Never / Op datum / Na N keer
 *
 * UI3-D12 carry-forward (the plan-level edit-scope decision):
 *   When this editor is rendered inside <EventEditSheet>, the surrounding
 *   form ALSO renders a scope radio ("Deze afspraak" / "Deze en toekomstige"
 *   / "Alle in de reeks") — Phase 3 only enables the first option; the
 *   other two are disabled with "(Fase 4)" suffix copy. That radio is
 *   adjacent to this editor, not inside it.
 *
 * Output: emits an RFC 5545 RRULE string via `RRule.optionsToString()`
 * (Pitfall 8 — never string-concat). If end-mode is "Never", we emit a
 * rule with no UNTIL/COUNT — the server's `ensureHorizon()` (src/lib/rrule.ts)
 * will auto-inject UNTIL = +2y on write, keeping the D-55 horizon invariant.
 *
 * Phase 4/5 reuse:
 *   - Phase 4 training session form will set defaultFreq='WEEKLY' for the
 *     standard "two evenings a week" pattern.
 *   - Phase 5 meeting form (AGE-02) uses the same widget for recurring board
 *     meetings.
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Form-field contract
 *            (line 323 — Recurring)
 *            .planning/phases/03-kalender/03-CONTEXT.md D-12 (UI3-D12)
 *            .planning/phases/03-kalender/03-PATTERNS.md §`src/components/common/rrule-editor.tsx`
 *            src/lib/rrule.ts (server-side horizon enforcement)
 */
'use client';

import { addYears, format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Frequency, RRule } from 'rrule';

import {
  BYDAY_CODES,
  MultiDayPicker,
  type BydayCode,
} from '@/components/common/multi-day-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type EndMode = 'never' | 'on_date' | 'after_n';

interface Props {
  /** Current rrule string (or undefined when none). Reserved for future
   *  rehydration of an existing recurring event in the edit sheet — the
   *  Phase 3 implementation initialises form state from frequency/interval
   *  pickers rather than round-tripping the string, since the v1 widget
   *  only covers a strict subset of RFC 5545. */
  value: string | undefined;
  onChange: (rrule: string | undefined) => void;
  /** The event's startsAt — used for default end-date calculation. */
  dtstart: Date;
}

const FREQ_MAP: Record<Freq, Frequency> = {
  DAILY: Frequency.DAILY,
  WEEKLY: Frequency.WEEKLY,
  MONTHLY: Frequency.MONTHLY,
};

export function RruleEditor({ value, onChange, dtstart }: Props) {
  const t = useTranslations('calendar.event.recurrence');

  // The `value` prop is accepted for API symmetry with future Phase 4
  // rehydration; v1 always rebuilds from local pickers and emits.
  void value;

  const [freq, setFreq] = useState<Freq>('WEEKLY');
  const [interval, setInterval] = useState(1);
  const [endMode, setEndMode] = useState<EndMode>('never');
  const [endDate, setEndDate] = useState(
    format(addYears(dtstart, 1), 'yyyy-MM-dd'),
  );
  const [endCount, setEndCount] = useState(10);
  /** Phase 4 D-85 / UI4-D19 BYDAY selector — only used when FREQ=WEEKLY. */
  const [byday, setByday] = useState<BydayCode[]>([]);

  // Avoid emitting on first mount until the parent has wired the handler.
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  }, [onChange]);

  useEffect(() => {
    // Build the rrule string via the library — never string-concat
    // (Pitfall 8).
    const options: ConstructorParameters<typeof RRule>[0] = {
      freq: FREQ_MAP[freq],
      interval,
    };
    if (endMode === 'on_date') {
      const parsed = new Date(endDate);
      if (!Number.isNaN(parsed.getTime())) options.until = parsed;
    }
    if (endMode === 'after_n') options.count = endCount;
    // Phase 4 D-85: serialize selected weekdays into the BYDAY option.
    // rrule@2.8.1 byweekday accepts arrays of RRule.MO/TU/.. constants.
    if (freq === 'WEEKLY' && byday.length > 0) {
      const RRULE_WEEKDAYS: Record<BydayCode, unknown> = {
        MO: RRule.MO,
        TU: RRule.TU,
        WE: RRule.WE,
        TH: RRule.TH,
        FR: RRule.FR,
        SA: RRule.SA,
        SU: RRule.SU,
      };
      options.byweekday = byday.map((c) => RRULE_WEEKDAYS[c]) as never;
    }
    try {
      const str = RRule.optionsToString(options);
      ref.current(str);
    } catch {
      ref.current(undefined);
    }
  }, [freq, interval, endMode, endDate, endCount, byday]);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>{t('frequency')}</Label>
          <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAILY">Dagelijks</SelectItem>
              <SelectItem value="WEEKLY">Wekelijks</SelectItem>
              <SelectItem value="MONTHLY">Maandelijks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('interval', { n: interval, unit: '' })}</Label>
          <Input
            type="number"
            min={1}
            max={4}
            value={interval}
            onChange={(e) =>
              setInterval(
                Math.max(1, Math.min(4, Number(e.target.value) || 1)),
              )
            }
          />
        </div>
      </div>
      {/* Phase 4 D-85 / UI4-D19: BYDAY picker — visible only when FREQ=WEEKLY. */}
      {freq === 'WEEKLY' && (
        <MultiDayPicker
          value={byday}
          onChange={setByday}
        />
      )}
      <div className="space-y-1">
        <Label>{t('endLabel')}</Label>
        <Select value={endMode} onValueChange={(v) => setEndMode(v as EndMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">{t('endNever')}</SelectItem>
            <SelectItem value="on_date">{t('endOnDate')}</SelectItem>
            <SelectItem value="after_n">
              {t('endAfter', { n: endCount })}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {endMode === 'on_date' && (
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      )}
      {endMode === 'after_n' && (
        <Input
          type="number"
          min={1}
          max={365}
          value={endCount}
          onChange={(e) =>
            setEndCount(Math.max(1, Number(e.target.value) || 1))
          }
        />
      )}
    </div>
  );
}
