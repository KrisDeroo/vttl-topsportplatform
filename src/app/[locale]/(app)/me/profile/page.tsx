/**
 * /[locale]/(app)/me/profile — caller self-profile (Plan 02-13 Task 4).
 *
 * Server Component that:
 *   1. Reads the caller's session via createContext().
 *   2. Looks up whether the caller owns a `players` or `trainers` row
 *      (the two are mutually exclusive in practice; if neither exists
 *      we render a neutral "complete your profile" Card).
 *   3. Renders the appropriate self-edit form in mode='self':
 *        - players row exists → <PlayerEditForm mode="self" ...>
 *        - trainers row exists → <TrainerEditForm mode="self" ...>
 *        - neither              → placeholder (TD must finish profile)
 *
 * D-37/D-38 enforcement: self-update schemas (`playerSelfUpdateInput`,
 * `trainerSelfUpdateInput`) are .strict() — sensitive fields are not in
 * the schema, so a malicious client can't smuggle them through. RLS on
 * UPDATE additionally ensures the row truly belongs to the caller.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Page Surfaces (me.profile)
 */
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { PlayerEditForm } from '@/components/players/player-edit-form';
import { PlayerHeader } from '@/components/players/player-header';
import { TrainerEditForm } from '@/components/trainers/trainer-edit-form';
import { TrainerHeader } from '@/components/trainers/trainer-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/server/db/client';
import { academy, status, trainerDiploma } from '@/server/db/schema/lookups';
import { players } from '@/server/db/schema/players';
import { trainers } from '@/server/db/schema/trainers';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function MyProfilePage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('me.profile');

  const ctx = await createContext();
  if (!ctx.scope) {
    // WARNING-11: locale-aware redirect.
    redirect(`/${locale}/login`);
  }

  const userId = ctx.scope.userId;

  // Probe both tables in parallel. The two are mutually exclusive in
  // practice (a player is not also a trainer in the same season), but we
  // do not assume — Phase 2 supports a single self-edit form per user.
  // Drizzle reads here bypass tRPC because we already have the session;
  // the player/trainer routers' own RLS would also pass these queries.
  const [playerRow, trainerRow] = await Promise.all([
    db.query.players.findFirst({ where: eq(players.userId, userId) }),
    db.query.trainers.findFirst({ where: eq(trainers.userId, userId) }),
  ]);

  // Pre-fetch lookups used by the form variants.
  const [academyRows, statusRows, diplomaRows] = await Promise.all([
    db.query.academy.findMany({
      where: eq(academy.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
    db.query.status.findMany({
      where: eq(status.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
    db.query.trainerDiploma.findMany({
      where: eq(trainerDiploma.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
  ]);
  const academyCodes = academyRows.map((r) => r.code);
  const statusCodes = statusRows.map((r) => r.code);
  const diplomaCodes = diplomaRows.map((r) => r.code);

  // Mint signed URL for whichever profile row exists (no N+1 here — at
  // most one signed URL on /me/profile).
  const caller = appRouter.createCaller(ctx);
  let photoUrl: string | null = null;
  const photoId = playerRow?.profilePhotoFileId ?? trainerRow?.profilePhotoFileId ?? null;
  if (photoId) {
    try {
      const result = await caller.file.getSignedUrl({ fileId: photoId });
      photoUrl = result.url;
    } catch {
      photoUrl = null;
    }
  }

  if (playerRow) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 space-y-8">
        <PlayerHeader
          player={{
            firstName: playerRow.firstName,
            lastName: playerRow.lastName,
            statusCode: playerRow.statusCode,
            isMinor: playerRow.isMinor,
          }}
          photoUrl={photoUrl}
          locale={locale}
        />
        <PlayerEditForm
          player={{
            userId: playerRow.userId,
            firstName: playerRow.firstName,
            lastName: playerRow.lastName,
            dateOfBirth:
              typeof playerRow.dateOfBirth === 'string'
                ? playerRow.dateOfBirth
                : (playerRow.dateOfBirth as unknown as Date).toISOString().slice(0, 10),
            gender: playerRow.gender,
            school: playerRow.school,
            street: playerRow.street,
            streetNumber: playerRow.streetNumber,
            postalCode: playerRow.postalCode,
            city: playerRow.city,
            province: playerRow.province,
            country: playerRow.country,
            phone: playerRow.phone,
            email: playerRow.email,
            club: playerRow.club,
            statusCode: playerRow.statusCode,
            academyCode: playerRow.academyCode,
            ageCategoryCode: playerRow.ageCategoryCode,
            isMinor: playerRow.isMinor,
            emergencyContactName: playerRow.emergencyContactName,
            emergencyContactPhone: playerRow.emergencyContactPhone,
            emergencyContactRelation: playerRow.emergencyContactRelation,
            profilePhotoFileId: playerRow.profilePhotoFileId,
          }}
          mode="self"
          academyCodes={academyCodes}
          statusCodes={statusCodes}
          locale={locale as 'nl' | 'en' | 'fr'}
          initialPhotoUrl={photoUrl}
        />
      </main>
    );
  }

  if (trainerRow) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 space-y-8">
        <TrainerHeader
          trainer={{
            firstName: trainerRow.firstName,
            lastName: trainerRow.lastName,
            diplomaCode: trainerRow.diplomaCode,
          }}
          photoUrl={photoUrl}
          locale={locale}
        />
        <TrainerEditForm
          trainer={{
            userId: trainerRow.userId,
            firstName: trainerRow.firstName,
            lastName: trainerRow.lastName,
            dateOfBirth:
              typeof trainerRow.dateOfBirth === 'string'
                ? trainerRow.dateOfBirth
                : (trainerRow.dateOfBirth as unknown as Date).toISOString().slice(0, 10),
            gender: trainerRow.gender,
            street: trainerRow.street,
            streetNumber: trainerRow.streetNumber,
            postalCode: trainerRow.postalCode,
            city: trainerRow.city,
            province: trainerRow.province,
            country: trainerRow.country,
            phone: trainerRow.phone,
            email: trainerRow.email,
            diplomaCode: trainerRow.diplomaCode,
            hasPedagogicalQualification: trainerRow.hasPedagogicalQualification,
            profilePhotoFileId: trainerRow.profilePhotoFileId,
          }}
          mode="self"
          diplomaCodes={diplomaCodes}
          locale={locale as 'nl' | 'en' | 'fr'}
          initialPhotoUrl={photoUrl}
        />
      </main>
    );
  }

  // Neither row exists — placeholder Card. The TD must complete the
  // user's profile via /players/new or /trainers/new before this page
  // becomes editable. Role users who reach this state (e.g.,
  // technical_director, academy_manager, medical_staff) intentionally
  // do not have a player/trainer profile.
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <h1 className="mb-6 text-2xl font-semibold">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('placeholder.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('placeholder.body')}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
