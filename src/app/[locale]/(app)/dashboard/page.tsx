/**
 * /[locale]/(app)/dashboard — Phase 4 minimal home (UI4-D06).
 *
 * Above page chrome: <NudgeBannerStack> — full-width above the
 * max-w-screen-xl container per UI-SPEC §"Nudge banner stack".
 *
 * Body composition (role-conditional):
 *   - trainer / TD:        <TeScorenOverview>
 *   - player:              <MyTournamentResultPendingWidget>
 *   - other (parent/etc.): just the minimal inbox
 *
 * Footer (always): <MinimalSystemInbox>.
 *
 * Phase 7 will replace `/dashboard` with the cross-domain player view
 * dashboard; the route slug stays so deep links survive (UI4-D06).
 *
 * Reference: 04-UI-SPEC.md §Page Surfaces (/dashboard row), 04-CONTEXT.md
 *            D-66 + D-67 + D-68 + D-72 + UI4-D06.
 */
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MinimalSystemInbox } from '@/components/inbox/minimal-system-inbox';
import { NudgeBannerStack } from '@/components/nudge/nudge-banner-stack';
import { MyTournamentResultPendingWidget } from '@/components/tournament/my-tournament-result-pending-widget';
import { TeScorenOverview } from '@/components/training/te-scoren-overview';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage(props: PageProps) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const ctx = await createContext();
  if (!ctx.scope) redirect(`/${locale}/login`);

  const role = ctx.scope.role;

  return (
    <>
      <NudgeBannerStack ctx={ctx} locale={locale} />
      <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
        </header>
        {(role === 'trainer' || role === 'technical_director') && (
          <TeScorenOverview
            ctx={ctx}
            scope={role === 'technical_director' ? 'all' : 'self'}
            locale={locale}
          />
        )}
        {role === 'player' && (
          <MyTournamentResultPendingWidget ctx={ctx} locale={locale} />
        )}
        <MinimalSystemInbox ctx={ctx} locale={locale} />
      </main>
    </>
  );
}
