/**
 * /[locale]/(app)/players/[id] — player detail (Plan 02-13 Task 4).
 *
 * Server Component:
 *   1. createContext + tRPC server caller → `player.get({ playerId })`.
 *      RLS filters → 0 rows surfaces NOT_FOUND → renders Next.js 404 page
 *      (D-36 enumeration prevention).
 *   2. Compute `mode` per UI-SPEC §RBAC table:
 *        - TD                  → 'td'
 *        - academy_manager     → 'academyManager'
 *        - self (player)       → 'self'  (the player's own profile)
 *        - parent of this minor → 'parent'
 *        - trainer             → 'readOnly'
 *   3. Mint a signed URL for the profile photo (single-row fetch — no
 *      N+1, this is the detail page). Pre-fetch active academy + status
 *      + age-category codes so the form does not need a tRPC list.
 *   4. Render <PlayerHeader> (Server) + <PlayerEditForm mode={...}>.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §RBAC-Sensitive UI Behavior
 */
import { notFound } from 'next/navigation';

import { PlayerEditForm, type PlayerEditMode } from '@/components/players/player-edit-form';
import { PlayerHeader } from '@/components/players/player-header';
import { db } from '@/server/db/client';
import { academy, ageCategories, status } from '@/server/db/schema/lookups';
import { eq } from 'drizzle-orm';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function PlayerDetailPage({ params }: PageProps) {
  const { locale, id } = await params;

  const ctx = await createContext();
  if (!ctx.scope) {
    notFound(); // (app) layout already redirects anonymous; defensive 404.
  }

  const caller = appRouter.createCaller(ctx);
  let player: Awaited<ReturnType<typeof caller.player.get>>;
  try {
    player = await caller.player.get({ playerId: id });
  } catch {
    // RLS-NOT_FOUND or invalid id → Next.js 404 (D-36 — indistinguishable
    // from "row exists but out of scope").
    notFound();
  }

  // Determine mode based on the caller's role + scope vs the loaded row.
  const role = ctx.scope.role;
  const isOwnRow = ctx.scope.userId === player.userId;
  const isLinkedParent = ctx.scope.linkedPlayerIds.includes(player.userId);

  let mode: PlayerEditMode;
  if (role === 'technical_director') mode = 'td';
  else if (role === 'academy_manager') mode = 'academyManager';
  else if (role === 'player' && isOwnRow) mode = 'self';
  else if (role === 'parent' && isLinkedParent) mode = 'parent';
  else mode = 'readOnly'; // trainer, sparring_partner, medical_staff, etc.

  // Mint signed URL for the avatar (single fetch — no N+1).
  let photoUrl: string | null = null;
  if (player.profilePhotoFileId) {
    try {
      const result = await caller.file.getSignedUrl({
        fileId: player.profilePhotoFileId,
      });
      photoUrl = result.url;
    } catch {
      // Scan-pending / row-missing — fall back to initials.
      photoUrl = null;
    }
  }

  // Pre-fetch lookups for the form.
  const [academyRows, statusRows, ageRows] = await Promise.all([
    db.query.academy.findMany({
      where: eq(academy.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
    db.query.status.findMany({
      where: eq(status.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
    db.query.ageCategories.findMany({
      where: eq(ageCategories.active, true),
      orderBy: (r, { asc }) => [asc(r.sortOrder)],
    }),
  ]);
  void ageRows; // available for an inline age-category change CTA if needed
  const academyCodes = academyRows.map((r) => r.code);
  const statusCodes = statusRows.map((r) => r.code);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 space-y-8">
      <PlayerHeader
        player={{
          firstName: player.firstName,
          lastName: player.lastName,
          statusCode: player.statusCode,
          isMinor: player.isMinor,
        }}
        photoUrl={photoUrl}
        readOnly={mode === 'readOnly'}
        locale={locale}
      />

      <PlayerEditForm
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        player={{
          userId: player.userId,
          firstName: player.firstName,
          lastName: player.lastName,
          dateOfBirth:
            typeof player.dateOfBirth === 'string'
              ? player.dateOfBirth
              : (player.dateOfBirth as unknown as Date).toISOString().slice(0, 10),
          gender: player.gender,
          school: player.school,
          street: player.street,
          streetNumber: player.streetNumber,
          postalCode: player.postalCode,
          city: player.city,
          province: player.province,
          country: player.country,
          phone: player.phone,
          email: player.email,
          club: player.club,
          statusCode: player.statusCode,
          academyCode: player.academyCode,
          ageCategoryCode: player.ageCategoryCode,
          isMinor: player.isMinor,
          emergencyContactName: player.emergencyContactName,
          emergencyContactPhone: player.emergencyContactPhone,
          emergencyContactRelation: player.emergencyContactRelation,
          profilePhotoFileId: player.profilePhotoFileId,
        }}
        mode={mode}
        academyCodes={academyCodes}
        statusCodes={statusCodes}
        locale={locale as 'nl' | 'en' | 'fr'}
        initialPhotoUrl={photoUrl}
      />
    </main>
  );
}
