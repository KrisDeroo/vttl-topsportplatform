/**
 * /[locale]/(app)/players/new — TD-only player creation (Plan 02-13 Task 4).
 *
 * Server Component:
 *   1. createContext() + role check — non-TD redirected to /players
 *      (WARNING-11: locale-aware redirect). The tRPC `player.create` is
 *      already a tdProcedure; this layer is defense-in-depth above the
 *      mutation so the page itself is unreachable to non-TD callers.
 *   2. Pre-fetch active academy + status codes from Drizzle. We avoid an
 *      extra tRPC list endpoint for lookups (small static data set).
 *   3. Render the PlayerCreateForm Client Component with the pre-fetched
 *      codes; it composes RHF + zod + LookupSelect + PhotoUpload.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PlayerCreateForm } from '@/components/players/player-create-form';
import { db } from '@/server/db/client';
import { academy, status } from '@/server/db/schema/lookups';
import { eq } from 'drizzle-orm';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewPlayerPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('players');
  const tCommon = await getTranslations('common');

  const ctx = await createContext();
  if (!ctx.scope || ctx.scope.role !== 'technical_director') {
    // WARNING-11: locale-aware redirect, never bare /players.
    redirect(`/${locale}/players`);
  }

  // Pre-fetch active lookup codes — Server Component reads through
  // Drizzle (no tRPC overhead for static lookup data).
  const [academyRows, statusRows] = await Promise.all([
    db.query.academy.findMany({
      where: eq(academy.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
    db.query.status.findMany({
      where: eq(status.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
  ]);
  const academyCodes = academyRows.map((r) => r.code);
  const statusCodes = statusRows.map((r) => r.code);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-col gap-3">
        <Link
          href={`/${locale}/players`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {tCommon('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('create.title')}</h1>
      </div>

      <PlayerCreateForm
        academyCodes={academyCodes}
        statusCodes={statusCodes}
        locale={locale as 'nl' | 'en' | 'fr'}
      />
    </main>
  );
}
