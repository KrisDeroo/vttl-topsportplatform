'use client';

/**
 * <TournamentFilterBar> — filter row above <TournamentList>.
 *
 * Minimal Phase 4 v1: shadcn Select dropdowns for type + age category +
 * period. State is local-only in v1 (URL-state filters per Phase 3
 * pattern are a future enhancement). Mobile: filters collapse to a
 * single combined dropdown menu.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentFilterBar row).
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface TournamentFilterValue {
  tournamentTypeCode: string | null;
  ageCategoryCode: string | null;
  period: 'this_year' | 'last_year' | 'all';
}

export interface TournamentFilterBarProps {
  value: TournamentFilterValue;
  onChange: (next: TournamentFilterValue) => void;
  tournamentTypeCodes: readonly string[];
  ageCategoryCodes: readonly string[];
}

export function TournamentFilterBar({
  value,
  onChange,
  tournamentTypeCodes,
  ageCategoryCodes,
}: TournamentFilterBarProps) {
  const t = useTranslations('tournament');
  const tLookupType = useTranslations('lookup.tournamentType');
  const tLookupAge = useTranslations('lookups.ageCategory');

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={value.tournamentTypeCode ?? '__all__'}
        onValueChange={(v) =>
          onChange({
            ...value,
            tournamentTypeCode: v === '__all__' ? null : v,
          })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder={t('filter.type')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t('filter.all')}</SelectItem>
          {tournamentTypeCodes.map((code) => (
            <SelectItem key={code} value={code}>
              {tLookupType(code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.ageCategoryCode ?? '__all__'}
        onValueChange={(v) =>
          onChange({
            ...value,
            ageCategoryCode: v === '__all__' ? null : v,
          })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder={t('filter.ageCategory')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t('filter.all')}</SelectItem>
          {ageCategoryCodes.map((code) => (
            <SelectItem key={code} value={code}>
              {tLookupAge(code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.period}
        onValueChange={(v) =>
          onChange({
            ...value,
            period: v as TournamentFilterValue['period'],
          })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder={t('filter.period')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('filter.all')}</SelectItem>
          <SelectItem value="this_year">{t('filter.thisYear')}</SelectItem>
          <SelectItem value="last_year">{t('filter.lastYear')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
