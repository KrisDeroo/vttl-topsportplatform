/**
 * /[locale]/(app)/trainers/new — TD-only trainer creation (Plan 02-13 Task 4).
 *
 * Mirrors players/new — Server Component pre-fetches active trainer
 * diploma codes from Drizzle and renders <TrainerCreateForm>.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { TrainerCreateForm } from '@/components/trainers/trainer-create-form';
import { db } from '@/server/db/client';
import { trainerDiploma } from '@/server/db/schema/lookups';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewTrainerPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('trainers');
  const tCommon = await getTranslations('common');

  const ctx = await createContext();
  if (!ctx.scope || ctx.scope.role !== 'technical_director') {
    redirect(`/${locale}/trainers`);
  }

  const diplomaRows = await db.query.trainerDiploma.findMany({
    where: eq(trainerDiploma.active, true),
    orderBy: (r, { asc }) => [asc(r.sortOrder)],
  });
  const diplomaCodes = diplomaRows.map((r) => r.code);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-col gap-3">
        <Link
          href={`/${locale}/trainers`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {tCommon('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('create.title')}</h1>
      </div>

      <TrainerCreateForm
        diplomaCodes={diplomaCodes}
        locale={locale as 'nl' | 'en' | 'fr'}
      />
    </main>
  );
}
