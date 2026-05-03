/**
 * Authenticated app shell layout (Plan 15 Task 2).
 *
 * Protects every route under /[locale]/(app)/* — redirects anonymous
 * visitors to /[locale]/login. Inside the protected tree the layout
 * wraps children in <TrpcProvider> so Client Components can call
 * `trpc.admin.user.list.useQuery(...)` without re-mounting the query
 * client per page navigation.
 *
 * Role-based access control is layered at the page level (e.g.
 * /admin/users redirects non-TD users) — the layout's only contract is
 * "must be authenticated". This keeps RBAC decisions co-located with
 * the resource they protect.
 *
 * Server Component — `auth.api.getSession` runs server-side so the
 * session check never leaks to the client bundle. The TrpcProvider
 * itself is a Client Component, but it is rendered as a child here
 * (Server can render Client; not the other way around).
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            src/server/auth/auth.ts (Better Auth instance)
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { TrpcProvider } from '@/lib/trpc-provider';
import { auth } from '@/server/auth/auth';

interface AppLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AppLayout({
  children,
  params,
}: AppLayoutProps) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect(`/${locale}/login`);
  }
  return <TrpcProvider>{children}</TrpcProvider>;
}
