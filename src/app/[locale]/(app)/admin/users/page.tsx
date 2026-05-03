/**
 * /[locale]/(app)/admin/users — TD-only user-management page (Plan 15 Task 2).
 *
 * Server Component:
 *   - Re-validates the session via Better Auth (the parent layout already
 *     redirected anonymous users; we re-check role here so a non-TD
 *     authenticated user can't reach this URL).
 *   - Reads the initial user list with the schema-owner Drizzle client
 *     (bypasses RLS on read; mutations from the Client Component go
 *     through tRPC where RLS is honoured per-request).
 *   - Hands the list off to <UserTable> as `initialData` so the React
 *     Query cache hydrates without a client-side round-trip.
 *
 * Role gating: the redirect target is `/[locale]/login` for both
 * "no session" and "wrong role" — we deliberately do NOT differentiate
 * between the two cases at this layer (no enumeration of which paths
 * exist for which roles). The login page can prompt re-auth; if the
 * user is already authenticated they land on the role's home page after
 * login.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            .planning/phases/01-fundament/01-RESEARCH.md
 *              §`/admin/users/page.tsx` (lines 2132–2156)
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getTranslations } from 'next-intl/server';

import { UserTable } from '@/components/admin/user-table';
import { auth } from '@/server/auth/auth';
import { db } from '@/server/db/client';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminUsersPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('admin.users');
  const session = await auth.api.getSession({ headers: await headers() });

  // Better Auth's session.user shape includes Better Auth-managed fields
  // (id, email, emailVerified, name, image) but VTTL extension columns
  // (role, preferredLocale) come through with `unknown` typing — narrowing
  // here mirrors the `pickLocale` pattern in src/server/auth/auth.ts.
  const role =
    session && (session.user as { role?: unknown }).role !== undefined
      ? (session.user as { role: unknown }).role
      : null;

  if (!session || role !== 'technical_director') {
    redirect(`/${locale}/login`);
  }

  const list = await db.query.users.findMany({
    orderBy: (u, { desc }) => desc(u.createdAt),
    limit: 100,
  });

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <UserTable initialData={list} />
    </main>
  );
}
