import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';

export async function freshDb() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(sql);
  // Truncate all app tables — keep schema, wipe rows; faster than re-migrate per test
  await db.execute(drizzleSql`
    DO $$ DECLARE r RECORD; BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('drizzle_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
  return {
    db,
    sql,
    [Symbol.asyncDispose]: async () => {
      await sql.end();
    },
  };
}

/**
 * rawPgAsAppUser — connects to Postgres as the `app_user` role (created in Plan 02
 * migration 001) so RLS policies (Plan 04) actually evaluate. The Drizzle client uses
 * the schema-owner role and bypasses RLS; this helper is the ONLY way to prove RLS
 * works at the DB layer (USER-05 + CRIT-2).
 *
 * Two call styles:
 *
 *  1. Long-lived session (RLS direct-query test):
 *       await using cx = await rawPgAsAppUser({ userId, role });
 *       const r = await cx.query('SELECT id FROM medical_events WHERE player_user_id = $1', [pid]);
 *
 *  2. One-shot query (RBAC matrix `rawPgAsAppUser` probe — CRIT-2):
 *       const rows = await rawPgAsAppUser({
 *         userId, role,
 *         sql: 'SELECT id FROM medical_events WHERE player_user_id = $1',
 *         params: [victimId],
 *       });
 *       // Returns the array of rows directly; connection auto-closed.
 *
 * Both styles set `app.user_id` / `app.user_role` GUCs via SELECT set_config(..., true)
 * inside a transaction so RLS policies see the caller identity.
 */
export interface RawPgAsAppUserArgs {
  userId: string;
  role: string;
  sql?: string;
  params?: readonly unknown[];
}

export async function rawPgAsAppUser<TRow extends Record<string, unknown> = Record<string, unknown>>(
  args: RawPgAsAppUserArgs,
): Promise<
  | TRow[]
  | {
      client: import('pg').Client;
      query: <T extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: readonly unknown[],
      ) => Promise<{ rows: T[] }>;
      [Symbol.asyncDispose]: () => Promise<void>;
    }
> {
  const { Client } = await import('pg');
  const url = new URL(process.env.DATABASE_URL!);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port),
    user: 'app_user',
    password: process.env.APP_USER_PASSWORD ?? 'app_user_pw',
    database: url.pathname.slice(1),
  });
  await client.connect();
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [args.userId]);
  await client.query(`SELECT set_config('app.user_role', $1, true)`, [args.role]);

  // One-shot: run the SQL, return rows, close.
  if (args.sql !== undefined) {
    try {
      const r = await client.query<TRow>(args.sql, args.params as unknown[] | undefined);
      return r.rows;
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  }

  // Long-lived: caller manages disposal via `await using`.
  return {
    client,
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ) {
      return client.query<T>(text, params as unknown[] | undefined);
    },
    [Symbol.asyncDispose]: async () => {
      await client.query('ROLLBACK');
      await client.end();
    },
  };
}
