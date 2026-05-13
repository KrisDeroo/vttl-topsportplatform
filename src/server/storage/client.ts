import 'server-only';

/**
 * Service-role Supabase Storage client singleton (D-22, FILE-01).
 *
 * The service-role key BYPASSES Supabase Storage RLS — this is intentional
 * because all upload/download/signed-URL flows happen on the server, gated
 * by Phase 2 tRPC procedures (which do their OWN RBAC via withRlsContext +
 * `protectedProcedure`/`tdProcedure`). Direct browser-to-Storage is OUT OF
 * SCOPE for v1.
 *
 * Security guards:
 *  - `import 'server-only'` makes Next.js refuse to bundle this into a
 *    Client Component. A developer trying to `import { storageClient }`
 *    from a `'use client'` file gets a build-time error.
 *  - ESLint restricted-imports rule on `@/server/storage/*` (added in 02-13)
 *    enforces the same invariant at lint time.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 5
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-22
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

export const storageClient: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
