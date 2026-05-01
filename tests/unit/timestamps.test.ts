/**
 * tstz helper unit tests — GDPR-08.
 *
 * Goal: every timestamp column in the VTTL schema is TIMESTAMPTZ
 * (`withTimezone: true`) so we never store a naive datetime that
 * silently drifts on cross-region reads.
 *
 * The Drizzle column object stores its options on `column.config`; we
 * assert the relevant fields rather than introspect the generated SQL
 * (avoids needing a live Postgres pool for a unit test).
 */
import { describe, it, expect } from 'vitest';
import { tstz } from '@/server/db/helpers/timestamps';

describe('tstz helper — GDPR-08', () => {
  it('returns timestamptz with mode date', () => {
    const col = tstz('created_at');
    // Drizzle PgTimestamp builders expose `dataType: 'timestamp'` plus
    // `withTimezone: true | false` and `mode`.
    expect((col as { config: { dataType: string } }).config.dataType).toMatch(/timestamp/i);
    expect((col as { config: { withTimezone: boolean } }).config.withTimezone).toBe(true);
    expect((col as { config: { mode: string } }).config.mode).toBe('date');
  });

  it('applies defaultNow when requested', () => {
    const col = tstz('created_at', { defaultNow: true });
    expect((col as { config: { hasDefault: boolean } }).config.hasDefault).toBe(true);
  });

  it('does NOT apply defaultNow when not requested', () => {
    const col = tstz('updated_at');
    // hasDefault is false (or undefined) when no .defaultNow() was applied.
    expect((col as { config: { hasDefault?: boolean } }).config.hasDefault).toBeFalsy();
  });
});
