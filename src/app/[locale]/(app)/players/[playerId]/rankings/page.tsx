/**
 * /[locale]/(app)/players/[playerId]/rankings — Phase 4 canonical Rankings home (D-91).
 *
 * Server Component shell. URL guard: player role can only access
 * /players/{ownId}/rankings → 403 otherwise (T-04-50 mitigation; RLS also
 * filters via ranking_entry_visible_to).
 *
 * Renders <RankingsTab> Client component which manages local state for
 * type + range selection.
 *
 * Reference: 04-UI-SPEC.md §Page Surfaces (/players/[playerId]/rankings row),
 *            04-CONTEXT.md D-89 + D-91 + UI4-D17.
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { RankingEntriesTable } from '@/components/ranking/ranking-entries-table';
import { RankingsTab } from '@/components/ranking/rankings-tab';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string; playerId: string }>;
}

export default async function PlayerRankingsPage(props: PageProps) {
  const { locale, playerId } = await props.params;
  const t = await getTranslations({ locale, namespace: 'ranking' });
  const ctx = await createContext();
  if (!ctx.scope) notFound();
  const { userId, role } = ctx.scope;

  // URL guard (T-04-50): player role can only access own rankings page.
  if (role === 'player' && playerId !== userId) {
    notFound();
  }

  // Player + TD can enter rankings (D-89). Trainer cannot.
  const canEnterRanking = role === 'player' || role === 'technical_director';

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </header>
      <RankingsTab
        playerUserId={playerId}
        canEnterRanking={canEnterRanking}
      />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('entries.column.value')}</h2>
        <RankingEntriesTable ctx={ctx} playerUserId={playerId} locale={locale} />
      </section>
    </main>
  );
}
