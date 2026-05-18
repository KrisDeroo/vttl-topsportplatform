/**
 * /[locale]/(app)/trainings/[eventId]/score — Phase 4 D-62 score-entry route.
 *
 * Server Component. Pre-fetches form data via the server caller pattern
 * (createContext + appRouter.createCaller); only the form leaf is a Client
 * Component. RLS-filtered → out-of-scope = 404. 14d wall is server-enforced
 * at mutation time (D-64); the read endpoint exposes the session so the
 * trainer/TD can see the data even outside the wall.
 *
 * URL guard: this route is implicitly restricted to trainer/TD via the
 * server caller (other roles get NOT_FOUND from `training.getSession`).
 *
 * Reference: 04-UI-SPEC.md §Page Surfaces (/trainings/[eventId]/score row).
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  BulkAttendanceScoreForm,
  type ParticipantRow,
} from '@/components/training/bulk-attendance-score-form';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string; eventId: string }>;
  searchParams: Promise<{ occurrenceDate?: string | undefined }>;
}

function defaultOccurrenceDate(): string {
  // Today's ISO date (UTC slice — matches training router toIsoDate).
  return new Date().toISOString().slice(0, 10);
}

export default async function ScorePage(props: PageProps) {
  const { locale, eventId } = await props.params;
  const sp = await props.searchParams;
  const occurrenceDate = sp.occurrenceDate ?? defaultOccurrenceDate();

  const t = await getTranslations({ locale, namespace: 'training.score' });
  const ctx = await createContext();
  if (!ctx.scope) notFound();
  const caller = appRouter.createCaller(ctx);

  let session: Awaited<ReturnType<typeof caller.training.getSession>>;
  try {
    session = await caller.training.getSession({
      eventId,
      occurrenceDate: new Date(occurrenceDate),
    });
  } catch {
    notFound();
  }

  const participants: ParticipantRow[] = session.participants.map((p) => ({
    userId: p.userId,
    userName: p.userName,
    attended: p.attended,
    qualityScore: p.qualityScore,
    feedbackText: p.feedbackText,
    hasMedicalConflict: p.hasMedicalConflict,
  }));

  const endsAt = new Date(session.event.endsAt);
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const wallExpired = Date.now() - endsAt.getTime() > fourteenDaysMs;

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            {t('metadataDate', {
              date: new Date(session.event.startsAt).toLocaleDateString(
                locale === 'en' ? 'en-GB' : `${locale}-BE`,
              ),
            })}
          </span>
          <span>{t('metadataType', { type: session.event.trainingTypeCode ?? '—' })}</span>
          <span>
            {t('metadataOrg', { org: session.event.organisationCode ?? '—' })}
          </span>
        </div>
      </header>
      <BulkAttendanceScoreForm
        eventId={eventId}
        occurrenceDate={occurrenceDate}
        participants={participants}
        readOnly={wallExpired}
        locale={locale}
      />
    </main>
  );
}
