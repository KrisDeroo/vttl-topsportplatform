'use client';

/**
 * <TrainerListTable> — DataTable for the /trainers list (Plan 02-13 Task 3).
 *
 * Mirrors <PlayerListTable> with trainer-specific columns (UI-SPEC
 * §Component Inventory row 2):
 *   - avatar (40×40, initials fallback only — T-02-13-AVATAR-N+1)
 *   - name (firstName + lastName)
 *   - diploma (lookups.trainerDiploma.{code})
 *   - pedagogical qual (Badge variant=outline + check icon when true)
 *   - academies (comma-joined academy codes resolved via i18n)
 *   - action menu: Open profile only (no setAgeCategory analog)
 *
 * The Server Component pre-fetches academy memberships and passes them
 * alongside the trainer rows so we don't N+1 a memberships lookup per row.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 3
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Component Inventory
 */
import { Check, MoreHorizontal, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/common/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpc } from '@/lib/trpc-client';

export interface TrainerRow {
  userId: string;
  firstName: string;
  lastName: string;
  diplomaCode: string;
  hasPedagogicalQualification: boolean;
  profilePhotoFileId: string | null;
  /** Pre-fetched academy codes for this trainer (joined server-side). */
  academyCodes: string[];
}

export interface TrainerListTableProps {
  initialData: TrainerRow[];
  isTd: boolean;
  locale: string;
}

export function TrainerListTable({
  initialData,
  isTd,
  locale,
}: TrainerListTableProps) {
  const t = useTranslations('trainers.list');
  const tDiploma = useTranslations('lookups.trainerDiploma');
  const tAcademy = useTranslations('lookups.academy');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = trpc.trainer.list.useQuery(
    { limit: 50 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { initialData: initialData as any },
  );

  // The server `trainer.list` does not currently return joined
  // academy memberships; the Server Component supplies them via
  // `initialData.academyCodes`. The useQuery result re-fetches the
  // trainers themselves; for now we render off initialData rows so the
  // academies stay visible. (Phase 7 will widen the procedure or add a
  // dedicated trainer-with-academies endpoint.)
  const rows = (list.data
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (list.data as any[]).map((r) => {
        const seed = initialData.find((s) => s.userId === r.userId);
        return {
          userId: r.userId,
          firstName: r.firstName,
          lastName: r.lastName,
          diplomaCode: r.diplomaCode,
          hasPedagogicalQualification: r.hasPedagogicalQualification,
          profilePhotoFileId: r.profilePhotoFileId,
          academyCodes: seed?.academyCodes ?? [],
        } as TrainerRow;
      })
    : initialData) as TrainerRow[];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={UserCog}
        title={t('empty.title')}
        body={t('empty.body')}
        action={
          isTd ? (
            <Button asChild>
              <Link href={`/${locale}/trainers/new`}>
                {t('empty.ctaTd')}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-3 w-12" aria-label="avatar" />
            <th className="py-2 pr-3">{t('columns.name')}</th>
            <th className="py-2 pr-3">{t('columns.diploma')}</th>
            <th className="py-2 pr-3">{t('columns.pedagogical')}</th>
            <th className="py-2 pr-3">{t('columns.academies')}</th>
            <th className="py-2 pr-3 w-10" aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((tr) => {
            const initials = `${tr.firstName.charAt(0)}${tr.lastName.charAt(0)}`.toUpperCase();
            return (
              <tr
                key={tr.userId}
                className="border-b align-middle h-12 hover:bg-muted/30"
              >
                <td className="py-2 pr-3">
                  <Avatar className="size-10">
                    <AvatarImage src={undefined} alt="" />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/${locale}/trainers/${tr.userId}`}
                    className="font-medium hover:underline"
                  >
                    {tr.firstName} {tr.lastName}
                  </Link>
                </td>
                <td className="py-2 pr-3">{tDiploma(tr.diplomaCode)}</td>
                <td className="py-2 pr-3">
                  {tr.hasPedagogicalQualification ? (
                    <Badge variant="outline" className="gap-1">
                      <Check className="size-3" />
                      {t('columns.pedagogicalYes')}
                    </Badge>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  {tr.academyCodes.length > 0
                    ? tr.academyCodes
                        .map((code) => tAcademy(code))
                        .join(', ')
                    : '—'}
                </td>
                <td className="py-2 pr-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('actions.openMenu')}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/${locale}/trainers/${tr.userId}`}>
                          {t('actions.open')}
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
