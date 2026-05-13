/**
 * <PlayerHeader> — Server Component (Plan 02-13 Task 1).
 *
 * Renders the H1 + 96×96 Avatar + status Badge + minor Badge + back link
 * on `/players/[id]` and `/me/profile` (player branch). No `'use client'`
 * — the Server Component receives a pre-resolved `photoUrl` (signed URL
 * minted by the page through `trpc.file.getSignedUrl`) and the initials,
 * so it can render without any client-side state.
 *
 * UI-SPEC line 189 — 96×96 Avatar with initials fallback; H1 = first +
 * last name (D-45 canonical order); status Badge resolves via i18n
 * (`lookups.status.{code}`); minor Badge appears only when `isMinor`
 * (outline variant + lucide `User` icon).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 1
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Component Inventory
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-45
 */
import { ArrowLeft, User } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export interface PlayerHeaderData {
  firstName: string;
  lastName: string;
  statusCode: string;
  isMinor: boolean;
}

export interface PlayerHeaderProps {
  player: PlayerHeaderData;
  /** Already-resolved signed URL (minted server-side); null = use initials. */
  photoUrl: string | null;
  /** Whether to render the "read-only" header pill (UI-SPEC §RBAC line 387). */
  readOnly?: boolean;
  /** Locale for the back link target (WARNING-11 — locale-aware redirects). */
  locale: string;
}

export async function PlayerHeader({
  player,
  photoUrl,
  readOnly = false,
  locale,
}: PlayerHeaderProps) {
  const t = await getTranslations('players');
  const tStatus = await getTranslations('lookups.status');
  const tCommon = await getTranslations('common');

  const initials = `${player.firstName.charAt(0) || '?'}${player.lastName.charAt(0) || '?'}`.toUpperCase();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${locale}/players`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tCommon('back')}
      </Link>

      <div className="flex items-center gap-4">
        <Avatar className="size-24">
          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
          <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
        </Avatar>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">
            {player.firstName} {player.lastName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tStatus(player.statusCode)}</Badge>
            {player.isMinor ? (
              <Badge variant="outline" className="gap-1">
                <User className="size-3" />
                {t('detail.minor')}
              </Badge>
            ) : null}
            {readOnly ? (
              <Badge variant="outline">{t('detail.readOnly')}</Badge>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
