/**
 * <TrpcProvider> — wraps the authenticated app shell with React Query
 * and tRPC providers (Plan 15 Task 2).
 *
 * `useState(() => ...)` lazy-instantiation matters: the QueryClient and
 * tRPC client are created exactly once per browser session (not on every
 * render), preserving query cache identity across re-renders.
 *
 * `httpBatchLink` automatically batches sibling tRPC calls into a single
 * HTTP request — useful for the admin UI where opening the page kicks off
 * `admin.user.list` plus any per-row queries in parallel.
 *
 * `staleTime: 30_000` keeps queries fresh for 30s by default — enough to
 * avoid refetch storms when the admin clicks between dialogs but short
 * enough that mutations get reflected promptly.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            https://trpc.io/docs/client/react/setup
 */
'use client';

import { useState } from 'react';

import { httpBatchLink } from '@trpc/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { trpc } from './trpc-client';

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000 } },
      }),
  );
  const [tc] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: '/api/trpc' })],
    }),
  );
  return (
    <trpc.Provider client={tc} queryClient={qc}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
