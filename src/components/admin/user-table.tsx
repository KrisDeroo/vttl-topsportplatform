/**
 * <UserTable> — TD admin Client Component (Plan 15 Task 2).
 *
 * Renders the user list with row-level actions:
 *   - activate (Plan 12 minor-gate via the tRPC mutation)
 *   - deactivate (Plan 09 D-09 revocation, reason prompt)
 *   - assignRole (opens <RoleAssignDialog>)
 *   - linkParent (opens <ParentLinkDialog>; sensitiveProcedure routes
 *     non-fresh sessions to /[locale]/(auth)/re-auth)
 *   - linkAcademy (opens <AcademyLinkDialog>)
 *
 * Phase 1 ships a minimal HTML table — Plan 15 deliberately avoids
 * @tanstack/react-table here so the surface remains auditable. The
 * acceptance contract is the row-level actions; sorting/filtering can
 * land later without changing the tRPC contract.
 *
 * Mutations call `list.refetch()` on success so the table re-renders
 * with the new state. The `useUtils()` invalidation hook would be more
 * idiomatic; using the imperative refetch keeps the pattern legible
 * and matches the existing codebase's <ReConsentBanner> approach.
 *
 * i18n: every label is sourced from `messages/{nl,en,fr}.json`
 * `admin.users.*`. The locale catalogs already carry the keys (Plan 07
 * + Plan 08 added `admin.users` block); this component only consumes
 * them.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            messages/{nl,en,fr}.json `admin.users.*`
 *            src/lib/trpc-client.ts (typed tRPC React client)
 */
'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';

import { AcademyLinkDialog } from './academy-link-dialog';
import { ParentLinkDialog } from './parent-link-dialog';
import { RoleAssignDialog } from './role-assign-dialog';
import { UserCreateDialog } from './user-create-dialog';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  preferredLocale: string;
  active: boolean;
  createdAt: Date | string;
}

interface UserTableProps {
  /** Server-rendered initial list — hydrates the React Query cache so
   *  the first paint shows real data without a loading state. */
  initialData: UserRow[];
}

export function UserTable({ initialData }: UserTableProps) {
  const t = useTranslations('admin.users');

  // initialData typed loosely because the Server Component reads through
  // Drizzle's select-row type which carries extra fields (image,
  // dateOfBirth, deactivatedAt, etc.); UserRow is the subset the table
  // renders. (Note: `isMinor` is no longer a column post CR-01 fix; it
  // is computed in app code via `isMinorAt` from src/lib/consent.ts.)
  const list = trpc.admin.user.list.useQuery(
    { limit: 100 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { initialData: initialData as any },
  );

  const activate = trpc.admin.user.activate.useMutation({
    onSuccess: () => list.refetch(),
  });
  const deactivate = trpc.admin.user.deactivate.useMutation({
    onSuccess: () => list.refetch(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<UserRow | null>(null);
  const [parentTarget, setParentTarget] = useState<UserRow | null>(null);
  const [academyTarget, setAcademyTarget] = useState<UserRow | null>(null);

  function onDeactivate(u: UserRow): void {
    // The reason is required by `admin.user.deactivate` (min 3 chars). We
    // use a native prompt for Phase 1 — Phase 7 will replace this with a
    // shadcn AlertDialog + form for accessibility / styling polish.
    const reason = window.prompt(t('deactivate'));
    if (reason && reason.trim().length >= 3) {
      deactivate.mutate({ userId: u.id, reason });
    }
  }

  // The data array can come from either the react-query hook (after a
  // refetch) or initialData on first paint. Either way it's typed as the
  // Drizzle row shape; we narrow to UserRow for rendering.
  const rows = (list.data ?? initialData) as unknown as UserRow[];

  return (
    <div>
      <div className="flex items-center justify-between my-4">
        <Button onClick={() => setCreateOpen(true)}>{t('create')}</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3">{t('fields.email')}</th>
              <th className="py-2 pr-3">{t('fields.name')}</th>
              <th className="py-2 pr-3">{t('fields.role')}</th>
              <th className="py-2 pr-3">{t('fields.locale')}</th>
              <th className="py-2 pr-3">{t('fields.status')}</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b align-top">
                <td className="py-2 pr-3">{u.email}</td>
                <td className="py-2 pr-3">{u.name}</td>
                <td className="py-2 pr-3">{u.role}</td>
                <td className="py-2 pr-3">{u.preferredLocale}</td>
                <td className="py-2 pr-3">
                  {u.active ? 'active' : 'inactive'}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {!u.active ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          activate.mutate({ userId: u.id })
                        }
                      >
                        {t('activate')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDeactivate(u)}
                      >
                        {t('deactivate')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRoleTarget(u)}
                    >
                      {t('assignRole')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setParentTarget(u)}
                    >
                      {t('linkParent')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAcademyTarget(u)}
                    >
                      {t('linkAcademy')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <UserCreateDialog
          onClose={() => {
            setCreateOpen(false);
            list.refetch();
          }}
        />
      )}
      {roleTarget && (
        <RoleAssignDialog
          user={roleTarget}
          onClose={() => {
            setRoleTarget(null);
            list.refetch();
          }}
        />
      )}
      {parentTarget && (
        <ParentLinkDialog
          user={parentTarget}
          onClose={() => setParentTarget(null)}
        />
      )}
      {academyTarget && (
        <AcademyLinkDialog
          user={academyTarget}
          onClose={() => setAcademyTarget(null)}
        />
      )}
    </div>
  );
}
