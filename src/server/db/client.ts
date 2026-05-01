/**
 * Drizzle client — runtime DB access.
 *
 * Connects to `DATABASE_URL` (the Supabase pooler on port 6543). The
 * pooler does NOT support prepared statements, so `prepare: false` is
 * mandatory — passing prepared statements through the pooler raises
 * `prepared statement "X" already exists` under load.
 *
 * Connection-pool sizing is intentionally small: the pooler itself
 * fans out to the underlying Postgres, so each app instance only needs
 * a thin local pool. `idle_timeout: 20` recycles idle backends so
 * Coolify rolling deploys release server-side resources promptly.
 *
 * Migrations use `DIRECT_DATABASE_URL` (port 5432) — see drizzle.config.ts.
 *
 * `onnotice` is silenced because Postgres NOTICE lines from extension
 * checks (`CREATE EXTENSION IF NOT EXISTS pgcrypto`) are not actionable
 * at runtime — they belong in migration logs only.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Drizzle query interceptor (lines 1923-1970)
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';

import * as schema from './schema';

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  prepare: false, // Supabase pooler compat (port 6543)
  onnotice: () => {
    // Suppress NOTICE chatter; migrations log notices through drizzle-kit.
  },
});

export const db = drizzle(client, { schema });
export type DbClient = typeof db;
