/**
 * pgcrypto-encrypted column helpers — GDPR-03 (Article-9 special-category
 * data), CRIT-2, T-01-03 (information disclosure on medical free-text).
 *
 * Pattern: writes use raw SQL with
 *   `pgp_sym_encrypt(text, current_setting('app.medical_key'))`
 * reads decrypt via
 *   `pgp_sym_decrypt(bytea, current_setting('app.medical_key'))`.
 *
 * The symmetric key is set per-connection from the `MEDICAL_ENCRYPTION_KEY`
 * env var via the session GUC `app.medical_key` — `src/server/db/client.ts`
 * wires the GUC via the postgres-js `connection.options` startup parameter
 * (CR-06 fix, 2026-05-01) so every pooled backend has the key set BEFORE
 * the first query runs. Plan 04's `withRlsContext` additionally sets the
 * same GUC with `is_local=true` per tRPC transaction for layered defence.
 * The key is NEVER stored in any database column or migration file;
 * rotation = rotate the env var, re-encrypt rows in a background job
 * (deferred; see RESEARCH §pgcrypto encrypted column read pattern,
 * lines 2483-2502).
 *
 * Cipher columns are stored as `text` (base64-encoded bytea) for portability
 * across pg drivers. The `pgp_sym_encrypt` function returns bytea; the
 * driver casts it to text on the wire when the column type is text. Reads
 * cast back via `::bytea` before `pgp_sym_decrypt`.
 *
 * IMPORTANT: every connection that touches `medical_*` tables MUST have
 * `app.medical_key` set — the pool initializer (`src/server/db/client.ts`)
 * enforces this. A missing key raises `unrecognized configuration
 * parameter` on the first encrypted read/write, which is the correct
 * fail-loud behaviour (do not silently fall back to a default key).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md
 *   §Medical isolation (lines 759-803), §pgcrypto encrypted column read
 *   pattern (lines 2483-2502).
 */
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * Wrap a plaintext value in `pgp_sym_encrypt(...)` for INSERT/UPDATE.
 *
 * The resulting expression evaluates server-side to a bytea cipher. Use
 * inside a Drizzle `db.insert(medicalEvents).values({ eventDescriptionCipher: encrypt('text') })`
 * where the column type is `text` — Postgres will implicit-cast the bytea
 * to text via the binary protocol, base64-encoded.
 *
 * @example
 *   await db.insert(medicalEvents).values({
 *     playerUserId: pid,
 *     eventDescriptionCipher: encrypt('Lower-back strain') as unknown as string,
 *     startDate: '2026-05-01',
 *     createdBy: callerId,
 *   });
 */
export function encrypt(plaintext: string): SQL {
  return sql`pgp_sym_encrypt(${plaintext}, current_setting('app.medical_key'))`;
}

/**
 * Wrap a column reference for SELECT-time decryption.
 *
 * Returns NULL when the column is NULL (so optional cipher columns like
 * `doctor_cipher` round-trip correctly). The cast `::bytea` is necessary
 * because the column type is `text` on the schema side but `pgp_sym_decrypt`
 * requires a bytea input.
 *
 * @example
 *   const rows = await db.execute<{ description: string }>(sql`
 *     SELECT ${decrypt(medicalEvents.eventDescriptionCipher)} AS description
 *       FROM medical_events
 *      WHERE player_user_id = ${playerId}
 *        AND deleted_at IS NULL
 *   `);
 */
export function decrypt(columnExpr: SQLWrapper | SQL): SQL {
  return sql`CASE WHEN ${columnExpr} IS NULL THEN NULL ELSE pgp_sym_decrypt(${columnExpr}::bytea, current_setting('app.medical_key')) END`;
}
