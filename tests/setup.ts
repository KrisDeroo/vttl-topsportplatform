import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

let container: StartedPostgreSqlContainer | null = null;

/**
 * Stub env values used by unit tests that import @/lib/env (which validates
 * via @t3-oss/env-nextjs). Integration tests overwrite DATABASE_URL/DIRECT_DATABASE_URL
 * with the real testcontainer URI; unit tests get these stubs and never touch a network.
 */
const STUB_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://stub:stub@127.0.0.1:6543/stub',
  DIRECT_DATABASE_URL: 'postgres://stub:stub@127.0.0.1:5432/stub',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  UPSTASH_REDIS_REST_URL: 'https://stub-upstash.example/api',
  UPSTASH_REDIS_REST_TOKEN: 'b'.repeat(20),
  REDIS_URL: 'rediss://stub:stub@127.0.0.1:6379',
  RESEND_API_KEY: 're_stub_key',
  EMAIL_FROM: 'noreply@vttl.be',
  MEDICAL_ENCRYPTION_KEY: 'test-medical-key-must-be-32-bytes!!',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
};

function ensureStubEnv() {
  for (const [k, v] of Object.entries(STUB_ENV)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

export async function setup() {
  // Always populate stub env first so unit tests that don't need a DB can run
  // even when Docker / a container runtime is not available locally (CI laptops,
  // sandboxed worktrees). Integration tests will overwrite DATABASE_URL below.
  ensureStubEnv();

  // Allow tests that don't need Postgres to skip the container entirely.
  // Set SKIP_TESTCONTAINERS=true to bypass Docker (unit-only test runs).
  if (process.env.SKIP_TESTCONTAINERS === 'true') {
    return;
  }

  try {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('vttl_test')
      .withUsername('test')
      .withPassword('test')
      .withCommand([
        'postgres',
        '-c',
        'log_min_duration_statement=0',
        '-c',
        'shared_preload_libraries=pgcrypto',
      ])
      .start();
  } catch (err) {
    // Docker / container runtime unavailable. Unit tests still run with stub env;
    // integration tests that need a real DB will fail explicitly when they try
    // to connect. This is preferable to aborting the entire test process.
    console.warn(
      '[testcontainer] container runtime unavailable, skipping Postgres setup:',
      (err as Error).message,
    );
    return;
  }

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;

  // Apply Drizzle migrations (Plan 02-04 produce these)
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
  } catch (e) {
    // OK on day one — drizzle/ folder may be empty until Plan 02 lands
    console.warn('[testcontainer] no migrations to apply yet:', (e as Error).message);
  }
  await sql.end();
}

export async function teardown() {
  if (container) await container.stop();
}
