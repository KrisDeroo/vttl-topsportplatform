/**
 * Unit tests asserting the on-disk format invariants of the drizzle/ folder.
 *
 * MIG-01 (immutability) is enforced by CI (.github/workflows/protect-migrations.yml).
 * MIG-05 (rollback companion) is enforced both by CI AND by this test, so a developer
 * generating a new migration locally gets feedback before pushing.
 *
 * The tests use `it.skipIf(sqlFiles.length === 0)` so they pass cleanly during
 * Phase 1 Wave 2 (when this plan lands) before Plan 02 has produced the first
 * migration. As soon as drizzle/0000_*.sql exists, the assertions run.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const drizzleDir = path.resolve(process.cwd(), 'drizzle');

function listMigrationSqlFiles(): string[] {
  try {
    if (!statSync(drizzleDir).isDirectory()) return [];
    return readdirSync(drizzleDir).filter((f) => /^\d{4}_.*\.sql$/.test(f));
  } catch {
    return [];
  }
}

describe('migration format — MIG-01, MIG-05', () => {
  const sqlFiles = listMigrationSqlFiles();

  it.skipIf(sqlFiles.length === 0)(
    'every migration file has a companion .rollback.md (MIG-05)',
    () => {
      const missing: string[] = [];
      for (const sql of sqlFiles) {
        const md = sql.replace(/\.sql$/, '.rollback.md');
        try {
          readFileSync(path.join(drizzleDir, md), 'utf-8');
        } catch {
          missing.push(md);
        }
      }
      expect(missing, `missing rollback companions: ${missing.join(', ')}`).toHaveLength(0);
    },
  );

  it.skipIf(sqlFiles.length === 0)(
    'migration filenames are sequential and zero-padded 4 digits',
    () => {
      const numbers = sqlFiles.map((f) => Number(f.slice(0, 4))).sort((a, b) => a - b);
      // Check there are no duplicate numbers.
      const unique = new Set(numbers);
      expect(unique.size, 'duplicate migration numbers').toBe(numbers.length);
      // Check there are no gaps.
      for (let i = 0; i < numbers.length - 1; i++) {
        const current = numbers[i]!;
        const next = numbers[i + 1]!;
        expect(next - current, `gap between ${current} and ${next}`).toBe(1);
      }
    },
  );

  it.skipIf(sqlFiles.length === 0)(
    'rollback companions reference the canonical sections (Risk, Procedure, Verification)',
    () => {
      const missingSections: Array<{ file: string; sections: string[] }> = [];
      for (const sql of sqlFiles) {
        const md = sql.replace(/\.sql$/, '.rollback.md');
        let body = '';
        try {
          body = readFileSync(path.join(drizzleDir, md), 'utf-8');
        } catch {
          continue; // already covered by the previous test
        }
        const required = ['**Risk:**', '**Procedure:**', '**Verification:**'];
        const missing = required.filter((s) => !body.includes(s));
        if (missing.length > 0) missingSections.push({ file: md, sections: missing });
      }
      expect(
        missingSections,
        `rollback files missing required sections: ${JSON.stringify(missingSections)}`,
      ).toHaveLength(0);
    },
  );
});
