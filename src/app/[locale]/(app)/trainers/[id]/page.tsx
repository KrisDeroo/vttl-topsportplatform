/**
 * /[locale]/(app)/trainers/[id] — trainer detail (Plan 02-13 Task 4).
 *
 * Mirrors /players/[id] with trainer-specific mode mapping:
 *   - TD                  → 'td'
 *   - self (trainer)      → 'self' (own profile)
 *   - any other role      → 'readOnly'
 *
 * D-38 self-update path: `trainer.updateSelf` is the only schema that
 * lets the trainer modify their own row, and it deliberately omits
 * `diplomaCode` + `hasPedagogicalQualification` (TD-only fields).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import {
  TrainerEditForm,
  type TrainerEditMode,
} from '@/components/trainers/trainer-edit-form';
import { TrainerHeader } from '@/components/trainers/trainer-header';
import { db } from '@/server/db/client';
import { trainerDiploma } from '@/server/db/schema/lookups';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function TrainerDetailPage({ params }: PageProps) {
  const { locale, id } = await params;

  const ctx = await createContext();
  if (!ctx.scope) notFound();

  const caller = appRouter.createCaller(ctx);
  let trainer: Awaited<ReturnType<typeof caller.trainer.get>>;
  try {
    trainer = await caller.trainer.get({ trainerId: id });
  } catch {
    notFound();
  }

  const role = ctx.scope.role;
  const isOwnRow = ctx.scope.userId === trainer.userId;

  let mode: TrainerEditMode;
  if (role === 'technical_director') mode = 'td';
  else if (role === 'trainer' && isOwnRow) mode = 'self';
  else mode = 'readOnly';

  let photoUrl: string | null = null;
  if (trainer.profilePhotoFileId) {
    try {
      const result = await caller.file.getSignedUrl({
        fileId: trainer.profilePhotoFileId,
      });
      photoUrl = result.url;
    } catch {
      photoUrl = null;
    }
  }

  const diplomaRows = await db.query.trainerDiploma.findMany({
    where: eq(trainerDiploma.active, true),
    orderBy: (r, { asc }) => [asc(r.sortOrder)],
  });
  const diplomaCodes = diplomaRows.map((r) => r.code);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 space-y-8">
      <TrainerHeader
        trainer={{
          firstName: trainer.firstName,
          lastName: trainer.lastName,
          diplomaCode: trainer.diplomaCode,
        }}
        photoUrl={photoUrl}
        readOnly={mode === 'readOnly'}
        locale={locale}
      />

      <TrainerEditForm
        trainer={{
          userId: trainer.userId,
          firstName: trainer.firstName,
          lastName: trainer.lastName,
          dateOfBirth:
            typeof trainer.dateOfBirth === 'string'
              ? trainer.dateOfBirth
              : (trainer.dateOfBirth as unknown as Date).toISOString().slice(0, 10),
          gender: trainer.gender,
          street: trainer.street,
          streetNumber: trainer.streetNumber,
          postalCode: trainer.postalCode,
          city: trainer.city,
          province: trainer.province,
          country: trainer.country,
          phone: trainer.phone,
          email: trainer.email,
          diplomaCode: trainer.diplomaCode,
          hasPedagogicalQualification: trainer.hasPedagogicalQualification,
          profilePhotoFileId: trainer.profilePhotoFileId,
        }}
        mode={mode}
        diplomaCodes={diplomaCodes}
        locale={locale as 'nl' | 'en' | 'fr'}
        initialPhotoUrl={photoUrl}
      />
    </main>
  );
}
