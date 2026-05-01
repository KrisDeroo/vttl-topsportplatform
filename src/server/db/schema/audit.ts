/**
 * Audit log — append-only general action audit (CRIT-7, T-01-04).
 *
 * `audit_log` records every state-changing action across the platform:
 * login, role change, consent given, parent-child link created, etc.
 * It is the GDPR Article 30 "record of processing activities" backbone.
 *
 * `id` is `bigserial` (mode: 'bigint') — guarantees monotonic ordering
 * of writes, which we use as a tamper-evidence signal: a missing id
 * indicates a deleted row.
 *
 * Tamper-evidence is enforced at the Postgres role layer in migration
 * 0000:
 *   REVOKE UPDATE, DELETE ON audit_log FROM app_user;
 * The application-runtime user can only INSERT. To read audit_log
 * (admin UI in Phase 7), the request must enter via a SECURITY DEFINER
 * function, which the TD role can call but the regular `app_user` role
 * cannot.
 *
 * `oldValues` / `newValues` (jsonb): for UPDATE actions, capture the
 * before/after document. Restricted to non-sensitive fields by tRPC
 * middleware (Plan 11) — never includes password hashes or medical
 * data. Medical access has its own dedicated audit table
 * (`medical_access_audit`, Plan 03) so retention and read access can
 * differ.
 *
 * `outcome` records 'success' | 'denied' | 'error' — denied entries
 * are the most valuable signal for security review (failed RBAC
 * checks indicate enumeration attempts).
 *
 * `ipAddress` is `inet` (native IP type, IPv4 + IPv6).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Audit log (lines 703-723)
 */
import { pgTable, uuid, text, jsonb, inet, bigserial } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  actorUserId: uuid('actor_user_id'), // null for system actions (cron, BullMQ workers)
  action: text('action').notNull(), // 'login' | 'role_change' | 'consent_given' | ...
  resourceType: text('resource_type'), // 'user' | 'consent_record' | 'medical_event' | ...
  resourceId: text('resource_id'), // text (not uuid) so we can audit non-uuid resources
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'), // correlation id from tRPC middleware
  outcome: text('outcome').notNull().default('success'), // 'success' | 'denied' | 'error'
  occurredAt: tstz('occurred_at', { defaultNow: true }).notNull(),
});
