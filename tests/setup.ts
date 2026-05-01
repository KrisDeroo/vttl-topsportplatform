import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

let container: StartedPostgreSqlContainer | null = null;

export async function setup() {
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

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-must-be-32-bytes!!';

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
