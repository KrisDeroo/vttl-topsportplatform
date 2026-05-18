/**
 * <NudgeBannerStack> — slot above page chrome (UI4-D08).
 *
 * Renders up to N persistent banners stacked vertically. Sits OUTSIDE the
 * max-width container of the page chrome so it spans full viewport. Each
 * banner is non-dismissible per D-67.
 *
 * Server Component shell that picks which banners to render based on the
 * caller's role:
 *   - trainer + technical_director → trainer score nudge
 *   - player → player tournament-result nudge
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (NudgeBannerStack row),
 *            04-CONTEXT.md D-67 + D-72 + UI4-D08.
 */
import { NudgeBanner } from '@/components/nudge/nudge-banner';
import type { createContext } from '@/server/trpc/server-context';

type Ctx = Awaited<ReturnType<typeof createContext>>;

interface NudgeBannerStackProps {
  ctx: Ctx;
  locale: string;
}

export function NudgeBannerStack({ ctx, locale }: NudgeBannerStackProps) {
  if (!ctx.scope) return null;
  const role = ctx.scope.role;
  const banners: React.ReactElement[] = [];

  if (role === 'trainer' || role === 'technical_director') {
    banners.push(
      <NudgeBanner
        key="trainer-score"
        kind="trainer_score"
        scope={role === 'technical_director' ? 'all' : 'self'}
        href={`/${locale}/dashboard`}
      />,
    );
  }

  if (role === 'player') {
    banners.push(
      <NudgeBanner
        key="player-result"
        kind="player_result"
        href={`/${locale}/dashboard`}
      />,
    );
  }

  if (banners.length === 0) return null;

  return (
    <div className="w-full" data-slot="nudge-banner-stack">
      {banners}
    </div>
  );
}
