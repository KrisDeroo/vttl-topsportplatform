/**
 * <RoleAssignDialog> — TD admin form for `admin.user.assignRole` (Plan 15
 * Task 2).
 *
 * Triggers Plan 09 D-09 revocation server-side: the moment the role
 * change commits, the user's existing JWT is added to the Upstash
 * revocation list with reason 'role_changed' (24h TTL). Their next tRPC
 * call returns UNAUTHORIZED `session_revoked` and the client redirects
 * to login.
 *
 * The audit_log row captures both `oldValues.role` and `newValues.role`
 * for security review.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            src/server/auth/revocation.ts (D-09)
 */
'use client';

import { useState, type FormEvent } from 'react';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';

interface UserLite {
  id: string;
  email: string;
  role: string;
}

interface Props {
  user: UserLite;
  onClose: () => void;
}

const ROLES = [
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
] as const;

export function RoleAssignDialog({ user, onClose }: Props) {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common');

  const assignRole = trpc.admin.user.assignRole.useMutation({
    onSuccess: () => onClose(),
  });

  const [role, setRole] = useState<(typeof ROLES)[number]>(
    (user.role as (typeof ROLES)[number]) ?? 'player',
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    assignRole.mutate({ userId: user.id, role });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-md border shadow-md w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-2">{t('assignRole')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{user.email}</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm">{t('fields.role')}</span>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as (typeof ROLES)[number])
              }
              className="mt-1 w-full border rounded-md px-3 py-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {assignRole.error && (
            <p role="alert" className="text-sm text-destructive">
              {assignRole.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={assignRole.isPending}>
              {tCommon('save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
