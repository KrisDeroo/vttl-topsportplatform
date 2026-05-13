/**
 * <TrainerHeader> — Server Component (Plan 02-13 Task 3).
 *
 * Mirrors <PlayerHeader> with trainer-specific badges (diploma instead
 * of status, no minor pill since trainers are always adults).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 3
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Component Inventory
 */
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export interface TrainerHeaderData {
  firstName: string;
  lastName: string;
  diplomaCode: string;
}

export interface TrainerHeaderProps {
  trainer: TrainerHeaderData;
  photoUrl: string | null;
  readOnly?: boolean;
  locale: string;
}

export async function TrainerHeader({
  trainer,
  photoUrl,
  readOnly = false,
  locale,
}: TrainerHeaderProps) {
  const t = await getTranslations('trainers');
  const tDiploma = await getTranslations('lookups.trainerDiploma');
  const tCommon = await getTranslations('common');

  const initials = `${trainer.firstName.charAt(0) || '?'}${trainer.lastName.charAt(0) || '?'}`.toUpperCase();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${locale}/trainers`}
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
            {trainer.firstName} {trainer.lastName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tDiploma(trainer.diplomaCode)}</Badge>
            {readOnly ? (
              <Badge variant="outline">{t('detail.readOnly')}</Badge>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
