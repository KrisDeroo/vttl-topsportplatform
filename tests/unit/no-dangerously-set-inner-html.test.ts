/**
 * Structural invariant — no `dangerouslySetInnerHTML` in any UI component.
 *
 * Closes CR-08 (Phase 4 VERIFICATION.md gaps[7]) — Plan 04-15.
 *
 * The Phase 4 incidents were:
 *   - src/components/nudge/nudge-banner.tsx line 127 (rendering catalog
 *     strings with markdown markers)
 *   - src/components/calendar/rrule-scope-picker-dialog.tsx lines 85/101/117
 *     (same pattern across 3 scope-preview blocks)
 *
 * The fix routes those bold markers through next-intl `t.rich({ b: chunks =>
 * <strong>{chunks}</strong> })`. The Phase 3 precedent conflict-banner.tsx
 * uses a hand-rolled split-on-`**` helper which also stays away from
 * innerHTML.
 *
 * This test gates future regressions: ANY use of `dangerouslySetInnerHTML`
 * anywhere under src/components/ trips the invariant. If a real need ever
 * arises (sanitised CMS HTML, etc.) it must move to a clearly-named
 * allowlisted helper and the allowlist below must be explicitly updated.
 *
 * Reference: 04-VERIFICATION.md gaps[7]; 04-REVIEW.md §CR-08.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(process.cwd(), 'src', 'components');

// Allowlist of files that intentionally render sanitised HTML through an
// explicitly reviewed helper. Each entry MUST have a justification in the
// file's docblock and a security-review sign-off.
const ALLOWLIST = new Set<string>([
  // Renders consent_versions.body_html — server-controlled, versioned per
  // locale, no user-supplied content. See file docblock for the full
  // threat-model + sanitisation pipeline (Plan 01-08 / Phase 1 consent flow).
  'src/components/consent/consent-step.tsx',
]);

function walkTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsxFiles(full, acc);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('no dangerouslySetInnerHTML in src/components/ (CR-08 structural invariant)', () => {
  it('no component file under src/components/ contains the dangerouslySetInnerHTML literal', () => {
    const files = walkTsxFiles(COMPONENTS_DIR);
    expect(files.length).toBeGreaterThan(0);

    // Match actual JSX attribute usage, NOT prose comments mentioning the
    // pattern. The attribute always appears as `dangerouslySetInnerHTML={...}`
    // — the `={` follow-on is the signature that distinguishes a use site
    // from a comment ("// we don't use dangerouslySetInnerHTML").
    const USAGE_RE = /dangerouslySetInnerHTML\s*=\s*\{/;

    const offenders: Array<{ file: string; line: number; excerpt: string }> = [];
    for (const file of files) {
      const rel = path.relative(process.cwd(), file);
      if (ALLOWLIST.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (USAGE_RE.test(lines[i]!)) {
          offenders.push({
            file: rel,
            line: i + 1,
            excerpt: lines[i]!.trim().slice(0, 120),
          });
        }
      }
    }

    expect(
      offenders,
      `Files in src/components/ MUST NOT use dangerouslySetInnerHTML.\n` +
        `Use next-intl t.rich({ b: chunks => <strong>{chunks}</strong> }) instead,\n` +
        `OR add the file to the ALLOWLIST with a code-review justification.\n` +
        `Offending lines:\n${JSON.stringify(offenders, null, 2)}`,
    ).toHaveLength(0);
  });

  it('has at least one t.rich call somewhere in src/components/ (positive signal)', () => {
    const files = walkTsxFiles(COMPONENTS_DIR);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('.rich(') || text.includes('t.rich(')) {
        hits.push(path.relative(process.cwd(), file));
      }
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});
