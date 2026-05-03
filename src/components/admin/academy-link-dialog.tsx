/**
 * <AcademyLinkDialog> — TD admin form for `admin.user.linkAcademy` (Plan 15
 * Task 2).
 *
 * Adds an academy_memberships row tying a trainer (or academy_manager) to
 * a specific academy code. The composite PK on (user_id + academy_code +
 * role) lets a user hold the same role at multiple academies and multiple
 * roles at the same academy — per CONTEXT.md a user can have several
 * academy memberships.
 *
 * Phase 1 takes a free-text academy code; Phase 2+ replaces it with a
 * lookup-driven dropdown over the `academy` lookup table. Until then the
 * Postgres FK on `academy.code` enforces that the code exists (a typo
 * fails with 23503 foreign-key violation surfaced as a generic mutation
 * error).
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            src/server/db/schema/memberships.ts (composite PK)
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

export function AcademyLinkDialog({ user, onClose }: Props) {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common');

  const linkAcademy = trpc.admin.user.linkAcademy.useMutation({
    onSuccess: () => onClose(),
  });

  const [academyCode, setAcademyCode] = useState('');
  const [role, setRole] = useState<'trainer' | 'academy_manager'>('trainer');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    linkAcademy.mutate({
      trainerUserId: user.id,
      academyCode,
      role,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-md border shadow-md w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-2">{t('linkAcademy')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{user.email}</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm">academyCode</span>
            <input
              type="text"
              required
              value={academyCode}
              onChange={(e) => setAcademyCode(e.target.value)}
              placeholder="topsportschool"
              className="mt-1 w-full border rounded-md px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="block text-sm">{t('fields.role')}</span>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as 'trainer' | 'academy_manager')
              }
              className="mt-1 w-full border rounded-md px-3 py-2"
            >
              <option value="trainer">trainer</option>
              <option value="academy_manager">academy_manager</option>
            </select>
          </label>
          {linkAcademy.error && (
            <p role="alert" className="text-sm text-destructive">
              {linkAcademy.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={linkAcademy.isPending}>
              {tCommon('save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
