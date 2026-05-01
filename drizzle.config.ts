/**
 * Drizzle Kit configuration.
 *
 * - Targets DIRECT_DATABASE_URL (port 5432, NOT the pooler on 6543).
 *   The pooler does not support DDL primitives like `CREATE INDEX CONCURRENTLY`,
 *   transactional DDL, and several `CREATE EXTENSION` operations migrations need.
 * - Migration metadata stored in `public.drizzle_migrations` (not the default
 *   `__drizzle_migrations` schema) so it shows up in pg_dump and can be audited
 *   like any other application table.
 * - schema path is the barrel re-export from src/server/db/schema/index.ts;
 *   Plan 02 fills this with real table definitions.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Drizzle Kit config
 */
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL! },
  verbose: true,
  strict: true,
  migrations: { table: 'drizzle_migrations', schema: 'public' },
});
