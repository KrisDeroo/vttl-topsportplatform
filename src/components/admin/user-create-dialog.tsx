/**
 * <UserCreateDialog> — TD admin form for `admin.user.create` (Plan 15 Task 2).
 *
 * Minimal modal: email + name + role + preferred locale + optional date of
 * birth. Closes on success so the parent table can refetch and re-render
 * the new row. Phase 1 uses a simple positioned div for the overlay; Phase
 * 7 will swap to shadcn `<Dialog>` for accessibility + styling consistency.
 *
 * Better Auth's `signUp.email` is NOT used here — that flow is for self-
 * registration. TD-driven user creation goes through the admin tRPC
 * mutation which writes the row with `active=false` (AUTH-04). The
 * verification email + magic-link onboarding lands in a future plan
 * (deferred per CONTEXT.md "Magic-link login").
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            messages/{nl,en,fr}.json `admin.users.fields.*`
 */
'use client';

import { useState, type FormEvent } from 'react';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';

interface Props {
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

export function UserCreateDialog({ onClose }: Props) {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common');

  const create = trpc.admin.user.create.useMutation({
    onSuccess: () => onClose(),
  });

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('player');
  const [preferredLocale, setPreferredLocale] = useState<'nl' | 'en' | 'fr'>(
    'nl',
  );
  const [dateOfBirth, setDateOfBirth] = useState<string>('');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate({
      email,
      name,
      role,
      preferredLocale,
      // Empty string → undefined so zod's `.optional()` accepts the value.
      ...(dateOfBirth ? { dateOfBirth } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-md border shadow-md w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">{t('create')}</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm">{t('fields.email')}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border rounded-md px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="block text-sm">{t('fields.name')}</span>
            <input
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border rounded-md px-3 py-2"
            />
          </label>
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
          <label className="block">
            <span className="block text-sm">{t('fields.locale')}</span>
            <select
              value={preferredLocale}
              onChange={(e) =>
                setPreferredLocale(e.target.value as 'nl' | 'en' | 'fr')
              }
              className="mt-1 w-full border rounded-md px-3 py-2"
            >
              <option value="nl">NL</option>
              <option value="en">EN</option>
              <option value="fr">FR</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-sm">DOB</span>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="mt-1 w-full border rounded-md px-3 py-2"
            />
          </label>
          {create.error && (
            <p role="alert" className="text-sm text-destructive">
              {create.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {tCommon('save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
