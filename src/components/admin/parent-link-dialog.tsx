/**
 * <ParentLinkDialog> — TD admin form for `admin.user.linkParent` (Plan 15
 * Task 2).
 *
 * The mutation uses `sensitiveProcedure` (Plan 11 → requireFreshSession,
 * SEC-03). When the TD's session is older than 1 hour the server throws
 * FORBIDDEN with `message='re_auth_required'`. We catch that here and
 * route to /[locale]/(auth)/re-auth so the operator can re-authenticate
 * without losing the form context. The dialog state is intentionally
 * NOT preserved across the re-auth round-trip — Phase 1 keeps the flow
 * simple; Phase 7 can persist the partial form to sessionStorage for a
 * smoother UX.
 *
 * Belgian Art. 8 (HIGH-5): the DB UNIQUE constraint on
 * `parent_child_links.child_user_id` enforces the "one consenting parent
 * per minor" invariant. A second link insert here surfaces as a Postgres
 * 23505 violation; the UI shows the generic mutation error. The ALTER
 * TABLE comment on memberships.ts documents the invariant.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            src/server/trpc/middleware/freshSession.ts (SEC-03)
 *            src/server/db/schema/memberships.ts (HIGH-5 UNIQUE)
 */
'use client';

import { useState, type FormEvent } from 'react';

import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
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

export function ParentLinkDialog({ user, onClose }: Props) {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();

  const linkParent = trpc.admin.user.linkParent.useMutation({
    onSuccess: () => onClose(),
    onError: (err) => {
      // SEC-03: server returns FORBIDDEN re_auth_required when the
      // session has aged out of the freshAge window (1h). Bounce to the
      // re-auth page so the operator can refresh their session.
      if (
        err.data?.code === 'FORBIDDEN' &&
        err.message === 're_auth_required'
      ) {
        router.push('/re-auth', { locale });
      }
    },
  });

  // Phase 1 input style: the TD pastes the parent's user_id directly.
  // Phase 7 will swap to a typeahead picker over `users.role='parent'`.
  const [parentUserId, setParentUserId] = useState('');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    linkParent.mutate({
      parentUserId,
      childUserId: user.id,
      consentGivenAt: new Date(Date.now()).toISOString(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-md border shadow-md w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-2">{t('linkParent')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{user.email}</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm">parentUserId</span>
            <input
              type="text"
              required
              value={parentUserId}
              onChange={(e) => setParentUserId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-1 w-full border rounded-md px-3 py-2 font-mono text-xs"
            />
          </label>
          {linkParent.error && (
            <p role="alert" className="text-sm text-destructive">
              {linkParent.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={linkParent.isPending}>
              {tCommon('save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
