/**
 * `createContext` — builds the per-request `CallerContext` for tRPC (Plan 11).
 *
 * Called once per HTTP request by `app/api/trpc/[trpc]/route.ts` (Next.js App
 * Router fetch adapter). Composition steps:
 *
 *   1. Read Better Auth session via `auth.api.getSession({ headers })`.
 *   2. If a session exists, rebuild the authorization scope from the DB:
 *      - academy memberships (codes the user belongs to in any role)
 *      - parent_child_links (children the user has consent for, parent role)
 *      - locale + role come straight off the user row
 *      - SEC-03 freshness derived from `session.freshUntil`
 *      Both DB reads run in parallel (Promise.all) — the academy and
 *      parent-link tables are independent and cumulatively keep cold-path
 *      latency under ~30ms.
 *   3. Populate request metadata: requestId (header `x-request-id` if Coolify
 *      / Caddy injects one, else a fresh UUID), client IP (`x-forwarded-for`
 *      first hop), user agent. These flow into audit_log rows and the child
 *      pino logger.
 *
 * Phase-1 always-fresh policy (MAJOR-11): scope is rebuilt on EVERY request.
 * The 15-min cache from D-08 is deferred to v1.1 — see
 * `src/server/trpc/middleware/auth.ts` block-comment for the migration plan.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §createContext (lines 2425–2467)
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';

import { log } from '@/lib/log';
import { auth } from '@/server/auth/auth';
import { db } from '@/server/db/client';
import { academyMemberships, parentChildLinks } from '@/server/db/schema';

import type { CallerContext, CallerScope } from './trpc';
import type { Role } from '@/server/auth/permissions';

/**
 * The seven canonical VTTL roles, mirroring `userRoleEnum`
 * (src/server/db/schema/auth.ts) and `Role` (permissions.ts). Used by
 * the WR-04 sanity check that rejects any unknown / drifted role
 * string from the session row.
 */
const KNOWN_ROLES = [
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
] as const;

function isKnownRole(role: unknown): role is Role {
  return (
    typeof role === 'string' &&
    (KNOWN_ROLES as readonly string[]).includes(role)
  );
}

/**
 * Build the per-request caller context. The Next.js route handler hands this
 * function the inbound `Request`; we read headers via `next/headers` (the App
 * Router pattern that Better Auth's `getSession` already uses internally).
 *
 * Throws nothing — anonymous requests return `{ scope: null }` which the
 * `requireAuth` middleware rejects later with UNAUTHORIZED.
 */
export async function createContext(): Promise<CallerContext> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  const requestId = hdrs.get('x-request-id') ?? randomUUID();
  const ipAddress =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const userAgent = hdrs.get('user-agent') ?? '';

  let scope: CallerScope | null = null;
  if (session?.user) {
    const u = session.user as {
      id: string;
      role?: string;
      preferredLocale?: string;
    };

    // Run academy + parent-link reads in parallel — they're independent and
    // both are needed before we can fan out to a downstream procedure.
    const [academies, links] = await Promise.all([
      db.query.academyMemberships.findMany({
        where: eq(academyMemberships.userId, u.id),
      }),
      db.query.parentChildLinks.findMany({
        where: eq(parentChildLinks.parentUserId, u.id),
      }),
    ]);

    // Better Auth stores `freshUntil` on the session row (Plan 02 schema +
    // Plan 05 freshAge=1h). Treat any non-future freshUntil — including null —
    // as "stale, requires re-auth for sensitive ops".
    const sessionRow = (session.session ?? {}) as { freshUntil?: Date | string | null };
    const freshUntilRaw = sessionRow.freshUntil;
    const freshUntilMs =
      freshUntilRaw instanceof Date
        ? freshUntilRaw.getTime()
        : typeof freshUntilRaw === 'string'
          ? Date.parse(freshUntilRaw)
          : 0;
    const fresh = freshUntilMs > Date.now();

    // WR-04 fix (2026-05-01): reject unknown role values instead of
    // defaulting to 'player'. The previous fallback (`u.role ?? 'player'`
    // cast as Role) silently downgraded any unrecognised role string —
    // if Better Auth's additional-fields plugin ever returned a
    // schema-drifted or partially-migrated row, the user got
    // 'player'-level grants without an audit trail of why. With the
    // sanity check, an unknown role becomes "no scope" → the request
    // falls through to anonymous handling (requireAuth then rejects
    // with UNAUTHORIZED). The DEBUG log lets ops track when this
    // happens without surfacing details to the caller.
    if (!isKnownRole(u.role)) {
      log.warn(
        { userId: u.id, roleRaw: u.role },
        'auth.unknown_role',
      );
      // Leave `scope` as null — the caller is treated as anonymous.
      return {
        session: session?.session ?? null,
        user: session?.user ?? null,
        scope: null,
        requestId,
        ipAddress,
        userAgent,
        log: log.child({ requestId, userId: u.id }),
      };
    }
    const role: Role = u.role;
    const locale = (u.preferredLocale ?? 'nl') as 'nl' | 'en' | 'fr';

    scope = {
      userId: u.id,
      role,
      academyIds: academies.map((a) => a.academyCode),
      linkedPlayerIds: links.map((l) => l.childUserId),
      locale,
      issuedAt: Date.now(),
      fresh,
    };
  }

  return {
    session: session?.session ?? null,
    user: session?.user ?? null,
    scope,
    requestId,
    ipAddress,
    userAgent,
    log: log.child({ requestId, userId: scope?.userId }),
  };
}
