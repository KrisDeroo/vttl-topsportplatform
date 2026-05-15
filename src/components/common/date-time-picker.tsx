/**
 * <DateTimePicker> — Popover + shadcn Calendar + Input[type=time] compound.
 *
 * Phase 3 introduces this compound for the event create/edit form; Phase 4
 * (training session form) and Phase 5 (medical / stage form) reuse it 1:1.
 * Lives in `src/components/common/` to signal cross-phase reuse — the
 * Phase 3 `<EventCreateSheet>` imports it from here, not from
 * `@/components/calendar/`.
 *
 * Composition shape mirrors the canonical Phase 2 dateOfBirth pattern in
 * `src/components/players/player-create-form.tsx` lines 312-358:
 *   <Popover><PopoverTrigger><Button …/></PopoverTrigger>
 *     <PopoverContent><Calendar mode="single" …/></PopoverContent></Popover>
 *   <Input type="time" …/>
 *
 * Locale formatting flows through `formatDate` from `src/lib/i18n-format.ts`
 * (I18N-07 — `dd/MM/yyyy` across nl/en/fr per Belgian convention).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Form-field contract
 *            (Start/End rows, lines 318-319)
 *            .planning/phases/03-kalender/03-PATTERNS.md §`src/components/common/date-time-picker.tsx`
 */
'use client';

import { CalendarIcon } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Locale } from '@/i18n/routing';
import { formatDate } from '@/lib/i18n-format';
import { cn } from '@/lib/utils';

interface Props {
  value: Date | undefined;
  onChange: (next: Date) => void;
  ariaLabel?: string;
  /** Optional placeholder text shown when value is undefined. */
  placeholder?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function DateTimePicker({
  value,
  onChange,
  ariaLabel,
  placeholder,
}: Props) {
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const date = value ?? new Date();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

  function setDatePart(next: Date) {
    const merged = new Date(next);
    merged.setHours(date.getHours(), date.getMinutes(), 0, 0);
    onChange(merged);
    setOpen(false);
  }

  function setTimePart(raw: string) {
    const [hStr, mStr] = raw.split(':');
    const h = Number.parseInt(hStr ?? '0', 10);
    const m = Number.parseInt(mStr ?? '0', 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const merged = new Date(date);
    merged.setHours(h, m, 0, 0);
    onChange(merged);
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              'justify-start text-left font-normal',
              !value && 'text-muted-foreground',
            )}
            aria-label={ariaLabel}
          >
            <CalendarIcon className="mr-2 size-4" />
            {value ? formatDate(date, locale) : (placeholder ?? '—')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              if (d) setDatePart(d);
            }}
            captionLayout="dropdown"
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={time}
        onChange={(e) => setTimePart(e.target.value)}
        className="w-28"
        aria-label={ariaLabel ? `${ariaLabel} — tijd` : 'Tijd'}
      />
    </div>
  );
}
