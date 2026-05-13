/**
 * Generic EmptyState card — used by /players list, /trainers list, and
 * any future RLS-filtered "no data" surface. Per UI-SPEC §Empty state,
 * the copy is identical between "no rows visible to you" and "no rows
 * exist" to honor D-36 enumeration prevention.
 *
 * Server Component (no use-client directive) — `icon` is a function
 * reference and `action` can hold either a server-side or client-side
 * element so the caller chooses the right boundary for their CTA.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md
 *              §Empty state (used on every list)
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';

export interface EmptyStateProps {
  /** lucide-react icon component reference (e.g., `Users`, `UserCog`). */
  icon: LucideIcon;
  /** Already-localised title string (caller resolved via useTranslations). */
  title: string;
  /** Already-localised body string. */
  body: string;
  /** Optional CTA — either a Server or Client element (caller's choice). */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: EmptyStateProps) {
  return (
    <Card className="mx-auto max-w-md p-6 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}
