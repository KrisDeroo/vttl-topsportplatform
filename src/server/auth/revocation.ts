/**
 * JWT revocation list (D-09).
 *
 * When the technical director downgrades a role, breaks a parent-child link, or
 * deactivates an account, the user's existing JWT is still cryptographically valid
 * until it expires. To enforce scope changes immediately, we mark the user as revoked
 * in Upstash and the tRPC `requireAuth` middleware (Plan 11) checks this list on every
 * authenticated request. Sub-millisecond Upstash REST GET on the hot path.
 *
 * Key format: `revoked:{userId}`
 * Value:      human-readable reason ("role_changed", "parent_link_revoked", "deactivated", …)
 * TTL:        same as session lifetime (30 days by default) — entries auto-expire
 *             so the list does not grow unbounded; the JWT will have expired by then anyway.
 *
 * Call sites (future plans):
 *   - Plan 11 `requireAuth` middleware — calls `isRevoked(userId)` per request,
 *     throws 401 with reason if non-null; user is forced to re-authenticate.
 *   - Plan 15 TD admin UI — calls `setRevoked(userId, reason)` on the
 *     `deactivate` and `assignRole` mutations.
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §D (D-09).
 *            .planning/phases/01-fundament/01-RESEARCH.md §Auth.
 */
import { cache } from '@/lib/cache';

/** 30 days — matches the default Better Auth session TTL configured in Plan 05. */
const DEFAULT_REVOCATION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Mark `userId` as revoked. Existing JWTs for this user will be rejected by `requireAuth`
 * until the entry expires (`ttlSeconds`) or `clearRevocation` is called.
 *
 * @param userId      The user whose JWTs should be invalidated.
 * @param reason      Short machine-readable code; surfaced in the 401 response so the
 *                    frontend can show a meaningful re-auth prompt
 *                    (e.g. "role_changed", "parent_link_revoked", "deactivated").
 * @param ttlSeconds  Defaults to the JWT lifetime (30 days). Override to a shorter
 *                    window when the revocation is known to be temporary.
 */
export async function setRevoked(
  userId: string,
  reason: string,
  ttlSeconds: number = DEFAULT_REVOCATION_TTL_SECONDS,
): Promise<void> {
  await cache.set(`revoked:${userId}`, reason, ttlSeconds);
}

/**
 * Look up the revocation status for `userId`.
 *
 * @returns The reason string if the user is currently revoked, or `null` if not.
 *          Callers should treat any non-null value as "force re-auth".
 */
export async function isRevoked(userId: string): Promise<string | null> {
  return cache.get(`revoked:${userId}`);
}

/**
 * Clear a previously-set revocation. Used when the TD reverses a downgrade
 * (e.g. re-activates an account or restores a role) before the TTL expires.
 */
export async function clearRevocation(userId: string): Promise<void> {
  await cache.del(`revoked:${userId}`);
}
