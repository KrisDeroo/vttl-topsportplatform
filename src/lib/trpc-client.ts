/**
 * tRPC React Query client (browser-side) — Plan 15 Task 2.
 *
 * `createTRPCReact<AppRouter>()` returns a fully-typed client object whose
 * shape mirrors the server router tree (`admin.user.list.useQuery(...)`,
 * `admin.user.activate.useMutation(...)`, etc.). No code generation —
 * the types flow from the AppRouter export at compile time.
 *
 * Usage in Client Components:
 *   import { trpc } from '@/lib/trpc-client';
 *   const list = trpc.admin.user.list.useQuery({ limit: 100 });
 *
 * Wrapper / hydration: `<TrpcProvider>` (src/lib/trpc-provider.tsx) creates
 * the QueryClient + tRPC client and wires both providers around the app
 * (mounted in src/app/[locale]/(app)/layout.tsx for the authenticated
 * admin shell).
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            https://trpc.io/docs/client/react
 */
import { createTRPCReact } from '@trpc/react-query';

import type { AppRouter } from '@/server/trpc/routers/_app';

export const trpc = createTRPCReact<AppRouter>();
