/**
 * /[locale]/(app)/trainers — trainer list page (Plan 02-13 Task 4).
 *
 * Mirrors the players list pattern (Server Component → tRPC server caller
 * → Client TrainerListTable with initialData). Trainer-specific
 * differences: no setAgeCategory CTA in the action menu; academy
 * memberships are joined server-side (a trainer can belong to multiple
 * academies via the `academy_memberships` table — D-35).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { eq } from 'drizzle-orm';

import { TrainerListTable } from '@/components/trainers/trainer-list-table';
import { Button } from '@/components/ui/button';
import { db } from '@/server/db/client';
import { academyMemberships } from '@/server/db/schema/memberships';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function TrainersListPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('trainers.list');

  const ctx = await createContext();
  if (!ctx.scope) {
    redirect(`/${locale}/login`);
  }

  // Trainer-self users go to /me/profile (UI-SPEC parity with players).
  if (ctx.scope.role === 'trainer') {
    redirect(`/${locale}/me/profile`);
  }

  const caller = appRouter.createCaller(ctx);
  const trainers = await caller.trainer.list({ limit: 50 });

  // Join academy memberships server-side so the list column can render
  // comma-joined academy labels without an N+1 in the Client Component.
  // Single query per trainer would be cheaper as a bulk SELECT; for v1
  // this loop is fine because Phase 2 list is < 100 rows in production.
  const trainersWithAcademies = await Promise.all(
    trainers.map(async (tr) => {
      const memberships = await db.query.academyMemberships.findMany({
        where: eq(academyMemberships.userId, tr.userId),
      });
      return {
        userId: tr.userId,
        firstName: tr.firstName,
        lastName: tr.lastName,
        diplomaCode: tr.diplomaCode,
        hasPedagogicalQualification: tr.hasPedagogicalQualification,
        profilePhotoFileId: tr.profilePhotoFileId,
        academyCodes: memberships
          .filter((m) => m.role === 'trainer')
          .map((m) => m.academyCode),
      };
    }),
  );

  const isTd = ctx.scope.role === 'technical_director';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {isTd ? (
          <Button asChild>
            <Link href={`/${locale}/trainers/new`}>{t('empty.ctaTd')}</Link>
          </Button>
        ) : null}
      </div>

      <TrainerListTable
        initialData={trainersWithAcademies}
        isTd={isTd}
        locale={locale}
      />
    </main>
  );
}
