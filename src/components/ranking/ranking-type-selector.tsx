'use client';

/**
 * <RankingTypeSelector> — tab-style selector for the 5 ranking types
 * (D-88 + UI-SPEC §"Two Ranking Widgets").
 *
 * 5 tabs: Senior Wereld / Jeugd Wereld / Senior Europees / Jeugd Europees /
 * België. Default = the player's primary type (D-88 — server-derived from
 * age category; this component takes default as a prop).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (RankingTypeSelector row),
 *            04-CONTEXT.md D-88.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const RANKING_TYPE_CODES = [
  'ranking_senior_world',
  'ranking_youth_world',
  'ranking_senior_european',
  'ranking_youth_european',
  'ranking_belgium',
] as const;
export type RankingTypeCode = (typeof RANKING_TYPE_CODES)[number];

export interface RankingTypeSelectorProps {
  value: RankingTypeCode;
  onChange: (next: RankingTypeCode) => void;
}

export function RankingTypeSelector({
  value,
  onChange,
}: RankingTypeSelectorProps) {
  const t = useTranslations('lookup.rankingType');
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as RankingTypeCode)}
    >
      <TabsList className="overflow-x-auto">
        {RANKING_TYPE_CODES.map((code) => (
          <TabsTrigger key={code} value={code}>
            {t(code)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
