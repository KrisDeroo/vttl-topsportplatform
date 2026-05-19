#!/usr/bin/env node
/**
 * Replay all drizzle/*.sql migrations against DIRECT_DATABASE_URL with
 * a 30-second per-statement timeout (pgbouncer pooler can be slow).
 *
 * On error / timeout: log, continue to next statement. Recoverable
 * error codes (table already exists, policy already exists, etc.)
 * are silenced. Other errors logged but NOT halted — we MUST get
 * through to the policy-creation statements in later migrations.
 *
 * Run:
 *   set -a && . ./.env.local && set +a && node scripts/replay-migrations.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const RECOVERABLE = new Set([
  '42P07', '42710', '42P06', '42701', '23505', '42704', '42P01',
  '42723', // duplicate_function (CREATE FUNCTION when one exists)
]);

const STMT_TIMEOUT_MS = 30000;

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('DIRECT_DATABASE_URL not set');
  process.exit(1);
}

const migrationsDir = resolve('./drizzle');
const files = readdirSync(migrationsDir)
  .filter((f) => f.match(/^\d{4}_.+\.sql$/))
  .sort();

console.log(`Files: ${files.length}`);

const client = new Client({ connectionString: url });
await client.connect();
// Set per-statement timeout server-side as a safety net.
await client.query(`SET statement_timeout = '${STMT_TIMEOUT_MS}'`);
console.log(`Connected. statement_timeout=${STMT_TIMEOUT_MS}ms.`);

const results = {
  totalStmts: 0,
  executed: 0,
  recovered: 0,
  timedOut: 0,
  otherErrors: [],
};

for (const file of files) {
  const fullPath = resolve(migrationsDir, file);
  const sql = readFileSync(fullPath, 'utf8');
  const statements = sql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0) return false;
      const meaningful = s
        .split('\n')
        .filter((line) => line.trim().length > 0 && !line.trim().startsWith('--'))
        .join('\n')
        .trim();
      return meaningful.length > 0;
    });

  process.stdout.write(`${file}: ${statements.length} stmts ... `);

  let fileExec = 0;
  let fileRec = 0;
  let fileTimeout = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    results.totalStmts++;

    try {
      await client.query(stmt);
      fileExec++;
      results.executed++;
    } catch (e) {
      const code = e.code;
      const head = stmt.slice(0, 70).replace(/\s+/g, ' ');

      if (code === '57014') {
        // statement_timeout
        fileTimeout++;
        results.timedOut++;
        console.error(`\n  ⏱ TIMEOUT stmt ${i + 1}: ${head}`);
      } else if (RECOVERABLE.has(code)) {
        fileRec++;
        results.recovered++;
      } else {
        results.otherErrors.push({
          file,
          stmt: i + 1,
          code,
          head,
          message: e.message,
        });
        console.error(`\n  ✗ stmt ${i + 1} code=${code}: ${head}`);
        console.error(`    ${e.message.slice(0, 200)}`);
      }
    }
  }
  console.log(`exec=${fileExec} rec=${fileRec} timeout=${fileTimeout}`);
}

console.log('\n=== Summary ===');
console.log(`Total: ${results.totalStmts}`);
console.log(`Executed: ${results.executed}`);
console.log(`Recovered (already-exists): ${results.recovered}`);
console.log(`Timed out: ${results.timedOut}`);
console.log(`Other errors: ${results.otherErrors.length}`);

const r = await client.query(
  `SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public'`,
);
console.log(`\nPolicies after replay: ${r.rows[0].n}`);

const r2 = await client.query(
  `SELECT COUNT(*)::int AS n FROM pg_class
   WHERE relrowsecurity=true
     AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')`,
);
console.log(`Tables with ENABLE RLS: ${r2.rows[0].n}`);

await client.end();
console.log('Done.');
