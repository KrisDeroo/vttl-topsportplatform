/**
 * /[locale]/(app)/tournaments/new — TD-only tournament create form.
 *
 * Server Component shell. URL guard: only TD reaches this route; other
 * roles get a 404 (server-side; the `tdProcedure` middleware would also
 * reject the mutation).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentCreateForm row),
 *            04-CONTEXT.md D-79.
 */
import { notFound } from 'next/navigation';

import { TournamentCreateForm } from '@/components/tournament/tournament-create-form';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

// Fixed sets — Phase 4 v1 uses the canonical seeds from migration 0017.
// Future plans may fetch these from the lookup tables via a Server query.
const AGE_CATEGORY_CODES = [
  'age_pre_minor',
  'age_minor',
  'age_cadet',
  'age_junior',
  'age_senior',
  'age_veteran',
] as const;
const TOURNAMENT_TYPE_CODES = [
  'tournament_wtt',
  'tournament_wtt_star',
  'tournament_ettu',
  'tournament_ejk',
  'tournament_wk',
  'tournament_international',
  'tournament_belgium',
] as const;

export default async function NewTournamentPage(props: PageProps) {
  const { locale } = await props.params;
  const ctx = await createContext();
  if (!ctx.scope || ctx.scope.role !== 'technical_director') {
    notFound();
  }
  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6">
      <TournamentCreateForm
        ageCategoryCodes={AGE_CATEGORY_CODES}
        tournamentTypeCodes={TOURNAMENT_TYPE_CODES}
        locale={locale}
      />
    </main>
  );
}
