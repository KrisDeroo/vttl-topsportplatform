'use client';

/**
 * <RankingsTab> — container with type selector + conditional chart/strip.
 *
 * Renders <RankingTypeSelector> at top. For international types renders
 * <RankingLineChart> + <RangePillSelector>. For Belgium (ranking_belgium)
 * renders <BelgiumTimelineStrip> instead (no range pills — Belgium is
 * annual). Bottom-right: <NewRankingEntryButton> opens the entry sheet.
 *
 * Client Component (state-heavy — type + range are local).
 *
 * Reference: 04-UI-SPEC.md §Two Ranking Widgets, 04-CONTEXT.md D-87 + D-88
 *            + D-89 + D-90.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { BelgiumTimelineStrip } from '@/components/ranking/belgium-timeline-strip';
import { NewRankingEntrySheet } from '@/components/ranking/new-ranking-entry-sheet';
import {
  RangePillSelector,
  rangeToDate,
  type RangeValue,
} from '@/components/ranking/range-pill-selector';
import { RankingLineChart } from '@/components/ranking/ranking-line-chart';
import {
  RankingTypeSelector,
  type RankingTypeCode,
} from '@/components/ranking/ranking-type-selector';
import { Card, CardContent } from '@/components/ui/card';

export interface RankingsTabProps {
  playerUserId: string;
  defaultRankingTypeCode?: RankingTypeCode;
  canEnterRanking?: boolean;
}

export function RankingsTab({
  playerUserId,
  defaultRankingTypeCode = 'ranking_senior_world',
  canEnterRanking = false,
}: RankingsTabProps) {
  const [type, setType] = React.useState<RankingTypeCode>(defaultRankingTypeCode);
  const [range, setRange] = React.useState<RangeValue>('2y');

  const isBelgium = type === 'ranking_belgium';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <RankingTypeSelector value={type} onChange={setType} />
        {canEnterRanking && (
          <NewRankingEntrySheet
            playerUserId={playerUserId}
            defaultRankingTypeCode={type}
          />
        )}
      </div>

      {!isBelgium && (
        <div className="flex justify-end">
          <RangePillSelector value={range} onChange={setRange} />
        </div>
      )}

      <Card>
        <CardContent className="py-6">
          {isBelgium ? (
            <BelgiumTimelineStrip
              playerUserId={playerUserId}
              rankingTypeCode={type}
            />
          ) : (
            <RankingLineChart
              playerUserId={playerUserId}
              rankingTypeCode={type}
              from={rangeToDate(range)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
