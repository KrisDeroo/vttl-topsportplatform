/**
 * `audit_log` write helpers (Plan 11) — backbone of the GDPR Article 30
 * "record of processing activities" trail.
 *
 * Two surfaces:
 *
 *   1. `writeAudit(ctx, entry)` — direct call from a mutation handler.
 *      Mutations should call this AFTER the state change is committed so the
 *      audit row reflects the truth of the write. Pulls the actor from
 *      `ctx.scope.userId`, ip + user-agent + requestId from the surrounding
 *      CallerContext. Defaults `outcome` to 'success' — pass 'denied' from
 *      RBAC failure handlers and 'error' from a try/catch on the mutation
 *      body (see `auditMiddleware` for the generic-wrapper pattern).
 *
 *   2. `auditMiddleware(action, resourceType)` — generic per-procedure
 *      middleware that writes an audit row regardless of business logic
 *      outcome (logs success on resolution, error on rejection, then re-throws).
 *      Use sparingly: prefer per-mutation explicit `writeAudit()` calls so the
 *      `resourceId` matches the mutated row. The generic middleware cannot
 *      know which row was touched, so it leaves `resourceId` null.
 *
 * Tamper-evidence: the migration in Plan 02 revokes UPDATE/DELETE on
 * `audit_log` from the application user (`REVOKE UPDATE, DELETE ON audit_log
 * FROM app_user`). This file deliberately writes through the application
 * connection, so attempts to mutate or delete an audit row will fail at the
 * Postgres role layer — append-only by design.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Audit middleware (lines 1812–1844)
 *            src/server/db/schema/audit.ts (table shape, append-only contract)
 */
import { db as rawDb, type DbClient } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';

import { middleware } from '../trpc';

export interface AuditEntry {
  /** Domain action verb — 'user.deactivate', 'consent.give', 'medical.read', … */
  action: string;
  /** Resource kind — 'user', 'consent_record', 'medical_event', … */
  resourceType?: string;
  /** Affected row id; text (not uuid) so non-uuid resources are auditable. */
  resourceId?: string;
  /** Pre-image (UPDATE/DELETE actions). Never include password hashes / medical envelopes. */
  oldValues?: unknown;
  /** Post-image (INSERT/UPDATE actions). Same redaction rules. */
  newValues?: unknown;
  /** 'success' (default) | 'denied' (RBAC fail) | 'error' (handler threw). */
  outcome?: 'success' | 'denied' | 'error';
}

/**
 * Subset of CallerContext that writeAudit needs. Typed loosely so test fakes
 * and the real tRPC context both fit without a casting dance.
 */
interface AuditContext {
  /** RLS-bound transaction handle, or undefined when called outside withRlsContext. */
  db?: unknown;
  scope?: { userId: string } | null;
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
}

/**
 * Direct insertion into `audit_log`. Uses the RLS-bound transaction (`ctx.db`)
 * when available so the row is visible-to-self under RLS, falling back to the
 * raw pool when called outside `withRlsContext` (e.g. background jobs).
 *
 * `occurredAt` is intentionally omitted — the schema (`occurred_at TIMESTAMPTZ
 * DEFAULT NOW()`) fills it. Drizzle's strict TS inference does not pick up the
 * default through the `tstz` helper's conditional return shape, so the values
 * object is cast to skip the inferred-required `occurredAt` field. The DB
 * default is the canonical source of "when did this happen" — passing a
 * client-side `Date.now()` would re-introduce wall-clock drift between the
 * audit timestamp and the surrounding transaction's `txid_snapshot`.
 *
 * `ctx.db` is typed `unknown` in CallerContext (see trpc.ts rationale) so we
 * narrow to `DbClient` here at the boundary.
 */
export async function writeAudit(
  ctx: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
  // The row intentionally omits occurredAt — the schema default
  // (`DEFAULT NOW()`) fills it server-side. Drizzle's strict TS inference
  // does not pick up the default through the `tstz` helper's conditional
  // return shape, so we cast through `unknown` to suppress the mistaken
  // "occurredAt is required" inference. The DB default is canonical: a
  // client-side `Date.now()` here would drift from the surrounding
  // transaction's snapshot timestamp by milliseconds-to-seconds depending
  // on connection-pool latency.
  const row = {
    actorUserId: ctx.scope?.userId ?? null,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
    requestId: ctx.requestId,
    outcome: entry.outcome ?? 'success',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await dbHandle.insert(auditLog).values(row as any);
}

/**
 * Generic mutation auditor. Wrap a procedure to write an audit row on every
 * successful call (and an `error` row on rejection, then re-throw):
 *
 *   const deactivate = tdProcedure
 *     .use(auditMiddleware('user.deactivate', 'user'))
 *     .input(...)
 *     .mutation(...);
 *
 * Limitations:
 *   - Cannot fill `resourceId` (the wrapper doesn't know the row id). Use
 *     `writeAudit` directly for that.
 *   - On rejection, calls `writeAudit` then re-throws so the underlying
 *     TRPCError is preserved. If the audit insert itself fails, the original
 *     error is masked — acceptable trade-off; alerting on audit insert
 *     failures is an OPS-04 dashboard concern.
 */
export const auditMiddleware = (action: string, resourceType: string) =>
  middleware(async ({ ctx, next }) => {
    try {
      const result = await next({ ctx });
      await writeAudit(ctx, { action, resourceType, outcome: 'success' });
      return result;
    } catch (e) {
      await writeAudit(ctx, { action, resourceType, outcome: 'error' });
      throw e;
    }
  });
