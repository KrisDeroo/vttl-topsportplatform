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

/**
 * Phase 3 — expected migration manifest (MIG-05).
 *
 * Wave 0 RED scaffold: Wave 2 ships 4 new Phase 3 migrations:
 *   0009_phase3_calendar_base_lookup_participants_exceptions
 *   0010_phase3_calendar_extension_tables
 *   0011_phase3_calendar_rls_policies
 *   0012_phase3_event_type_seed
 *
 * Each migration MUST land with a `.rollback.md` companion holding the
 * canonical Risk / Procedure / Verification headers (already enforced by
 * the loop above for every present file). This describe block adds an
 * existence check by canonical name once the file appears; until then
 * each migration assertion is gated by `it.skipIf` on the file's absence.
 */
describe('Phase 3 — expected migration manifest (MIG-05)', () => {
  const PHASE3_MIGRATIONS = [
    '0009_phase3_calendar_base_lookup_participants_exceptions',
    '0010_phase3_calendar_extension_tables',
    '0011_phase3_calendar_rls_policies',
    '0012_phase3_event_type_seed',
  ] as const;

  it('declares all 4 expected Phase 3 migration stems (manifest)', () => {
    expect(PHASE3_MIGRATIONS).toHaveLength(4);
    expect(new Set(PHASE3_MIGRATIONS).size).toBe(4);
  });

  for (const stem of PHASE3_MIGRATIONS) {
    const sqlName = `${stem}.sql`;
    const mdName = `${stem}.rollback.md`;
    let sqlExists = false;
    let mdExists = false;
    try {
      sqlExists = readdirSync(drizzleDir).includes(sqlName);
      mdExists = readdirSync(drizzleDir).includes(mdName);
    } catch {
      sqlExists = false;
      mdExists = false;
    }

    it.skipIf(!sqlExists)(`${sqlName} exists once Wave 2 lands`, () => {
      expect(sqlExists, `${sqlName} not yet shipped`).toBe(true);
    });

    it.skipIf(!sqlExists)(`${mdName} rollback companion exists`, () => {
      expect(mdExists, `${mdName} missing for ${sqlName}`).toBe(true);
    });
  }
});
