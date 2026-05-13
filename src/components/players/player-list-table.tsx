'use client';

/**
 * <PlayerListTable> — DataTable for the /players list (Plan 02-13 Task 1).
 *
 * Client Component that hydrates a tRPC `player.list` query with the
 * Server-rendered initialData (same Server-Component → tRPC server caller
 * → Client `useQuery({ initialData })` pattern shipped by Phase 1's
 * <UserTable>). RLS scopes the row set server-side; the client only
 * receives rows the caller may see, so we never branch on role here.
 *
 * Columns (UI-SPEC §Component Inventory row 1):
 *   - avatar (40×40) — initials fallback only in the list (T-02-13-AVATAR-N+1
 *     mitigation; signed-URL fetch happens on the detail page)
 *   - name — firstName + lastName (D-45 canonical order)
 *   - statuut letter — A/B/C plain letter with full label resolved via
 *     `lookups.status.{code}` (UI-SPEC line 134)
 *   - academy — resolved via `lookups.academy.{code}` (D-44)
 *   - age category — resolved via `lookups.ageCategory.{code}` (D-44)
 *   - minor flag — Badge variant="outline" + User icon when isMinor (UI-SPEC)
 *   - action menu — Open profile / Change age category (TD only)
 *
 * The action menu uses shadcn DropdownMenu (Phase 1 primitive). TD-only
 * affordances (Leeftijdscategorie wijzigen) are conditionally rendered;
 * the server enforces the real RBAC (T-02-13-CLIENT-ROLE-CHECK — UI is
 * cosmetic). Empty state uses the generic <EmptyState> card from 02-12.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 1
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Component Inventory
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37, D-40
 */
import { MoreHorizontal, User, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AgeCategoryChangeDialog } from '@/components/players/age-category-change-dialog';
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

/** Subset of the `players` row the table renders. The Server Component
 *  passes through Drizzle's select-row shape; this interface narrows it
 *  to the columns actually rendered so the TS surface is auditable. */
export interface PlayerRow {
  userId: string;
  firstName: string;
  lastName: string;
  statusCode: string;
  academyCode: string;
  ageCategoryCode: string;
  categoryYear: number;
  isMinor: boolean;
  profilePhotoFileId: string | null;
}

export interface PlayerListTableProps {
  /** Server-rendered initial list (Phase 1 pattern). */
  initialData: PlayerRow[];
  /** Whether the caller is a Technical Director — controls TD-only
   *  affordances (Leeftijdscategorie wijzigen). Server enforces the real
   *  RBAC; this prop is a cosmetic gate (T-02-13-CLIENT-ROLE-CHECK). */
  isTd: boolean;
  /** Pre-fetched age category codes for the change dialog (Server
   *  Component reads `age_categories` via Drizzle; LookupSelect resolves
   *  labels via i18n). */
  ageCategoryCodes: readonly string[];
  /** Current locale — used for the locale-aware Link target (WARNING-11). */
  locale: string;
}

export function PlayerListTable({
  initialData,
  isTd,
  ageCategoryCodes,
  locale,
}: PlayerListTableProps) {
  const t = useTranslations('players.list');
  const tStatus = useTranslations('lookups.status');
  const tAcademy = useTranslations('lookups.academy');
  const tAge = useTranslations('lookups.ageCategory');
  const tDetail = useTranslations('players.detail');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = trpc.player.list.useQuery(
    { limit: 50 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { initialData: initialData as any },
  );

  const [ageCategoryTarget, setAgeCategoryTarget] = useState<PlayerRow | null>(
    null,
  );

  const rows = (list.data ?? initialData) as unknown as PlayerRow[];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('empty.title')}
        body={t('empty.body')}
        action={
          isTd ? (
            <Button asChild>
              <Link href={`/${locale}/players/new`}>{t('empty.ctaTd')}</Link>
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
            <th className="py-2 pr-3">{t('columns.status')}</th>
            <th className="py-2 pr-3">{t('columns.academy')}</th>
            <th className="py-2 pr-3">{t('columns.ageCategory')}</th>
            <th className="py-2 pr-3">{t('columns.minor')}</th>
            <th className="py-2 pr-3 w-10" aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const initials = `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase();
            // Single-letter A/B/C derived from the status code suffix.
            const letter = p.statusCode.startsWith('status_')
              ? p.statusCode.slice('status_'.length).toUpperCase()
              : p.statusCode.toUpperCase();
            return (
              <tr key={p.userId} className="border-b align-middle h-12 hover:bg-muted/30">
                <td className="py-2 pr-3">
                  {/* T-02-13-AVATAR-N+1 mitigation: initials fallback only,
                   *  no signed-URL fetch in list rows. */}
                  <Avatar className="size-10">
                    <AvatarImage src={undefined} alt="" />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/${locale}/players/${p.userId}`}
                    className="font-medium hover:underline"
                  >
                    {p.firstName} {p.lastName}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  <span className="font-medium">{letter}</span>{' '}
                  <span className="text-muted-foreground">
                    {tStatus(p.statusCode)}
                  </span>
                </td>
                <td className="py-2 pr-3">{tAcademy(p.academyCode)}</td>
                <td className="py-2 pr-3">{tAge(p.ageCategoryCode)}</td>
                <td className="py-2 pr-3">
                  {p.isMinor ? (
                    <Badge variant="outline" className="gap-1">
                      <User className="size-3" />
                      {tDetail('minor')}
                    </Badge>
                  ) : null}
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
                        <Link href={`/${locale}/players/${p.userId}`}>
                          {t('actions.open')}
                        </Link>
                      </DropdownMenuItem>
                      {isTd ? (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setAgeCategoryTarget(p);
                          }}
                        >
                          {t('actions.setAgeCategory')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {ageCategoryTarget ? (
        <AgeCategoryChangeDialog
          playerId={ageCategoryTarget.userId}
          currentCode={ageCategoryTarget.ageCategoryCode}
          ageCategoryCodes={ageCategoryCodes}
          open={ageCategoryTarget !== null}
          onOpenChange={(open) => {
            if (!open) setAgeCategoryTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
