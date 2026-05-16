/**
 * Phase 4 Wave 0 — i18n catalog completeness invariants (I18N-01, I18N-05, I18N-10).
 *
 * The three locale catalogs in `messages/{nl,en,fr}.json` MUST hold an
 * identical set of dot-joined key paths so the production-launch gate
 * (I18N-10 — 100% string coverage for every locale that ships) is
 * structurally enforced from Wave 0 onwards.
 *
 * Two invariants:
 *  1. Key-set parity: `keys(nl) == keys(en) == keys(fr)` (set equality).
 *     Asymmetric drift surfaces as a precise per-locale missing-key list.
 *  2. No placeholder leaks: no value in any of the three files equals the
 *     literal markers `[MISSING_TRANSLATION]`, `TODO`, or `__TODO__`.
 *     (Per CONTEXT D-91 the planner accepts Dutch placeholder values for
 *     non-critical-sample en/fr keys at Wave 0; those are real strings,
 *     not placeholder markers, so this gate passes.)
 *
 * Static-file invariant — synchronous fs.readFileSync is intentional; no
 * DB connection, no async setup. Runs in every CI lane.
 *
 * Reference: 04-CONTEXT.md §i18n keyspaces; 04-UI-SPEC.md §Multilingual
 * Copy; threat T-04-02-MISSING-LOCALE-FALLBACK.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const LOCALES = ['nl', 'en', 'fr'] as const;
type Locale = (typeof LOCALES)[number];

const messagesDir = path.resolve(process.cwd(), 'messages');

/** Recursively flatten a JSON object into a Set of dot-joined key paths. */
function flatten(obj: unknown, prefix: string, out: Set<string>): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    out.add(prefix);
    return;
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) {
    // Empty object — record the path so we still see structural drift.
    out.add(prefix);
    return;
  }
  for (const [k, v] of entries) {
    const next = prefix === '' ? k : `${prefix}.${k}`;
    flatten(v, next, out);
  }
}

/** Recursively walk values and report any equal to a placeholder marker. */
function collectPlaceholderHits(
  obj: unknown,
  prefix: string,
  markers: readonly string[],
  out: Array<{ key: string; value: string }>,
): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (typeof obj === 'string' && markers.includes(obj)) {
      out.push({ key: prefix, value: obj });
    }
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix === '' ? k : `${prefix}.${k}`;
    collectPlaceholderHits(v, next, markers, out);
  }
}

function loadLocale(locale: Locale): unknown {
  const raw = readFileSync(path.join(messagesDir, `${locale}.json`), 'utf-8');
  return JSON.parse(raw);
}

describe('i18n catalog completeness — I18N-01, I18N-05, I18N-10', () => {
  const catalogs: Record<Locale, unknown> = {
    nl: loadLocale('nl'),
    en: loadLocale('en'),
    fr: loadLocale('fr'),
  };

  const keysets: Record<Locale, Set<string>> = {
    nl: new Set(),
    en: new Set(),
    fr: new Set(),
  };
  for (const loc of LOCALES) {
    flatten(catalogs[loc], '', keysets[loc]);
  }

  it('nl, en, fr have identical key sets (no missing keys per locale)', () => {
    const nl = keysets.nl;
    const en = keysets.en;
    const fr = keysets.fr;

    const missingInEn = [...nl].filter((k) => !en.has(k));
    const extraInEn = [...en].filter((k) => !nl.has(k));
    const missingInFr = [...nl].filter((k) => !fr.has(k));
    const extraInFr = [...fr].filter((k) => !nl.has(k));

    expect(
      missingInEn,
      `messages/en.json missing keys present in nl: ${missingInEn.slice(0, 20).join(', ')}${
        missingInEn.length > 20 ? ` (+${missingInEn.length - 20} more)` : ''
      }`,
    ).toEqual([]);
    expect(
      extraInEn,
      `messages/en.json has keys absent in nl: ${extraInEn.slice(0, 20).join(', ')}${
        extraInEn.length > 20 ? ` (+${extraInEn.length - 20} more)` : ''
      }`,
    ).toEqual([]);
    expect(
      missingInFr,
      `messages/fr.json missing keys present in nl: ${missingInFr.slice(0, 20).join(', ')}${
        missingInFr.length > 20 ? ` (+${missingInFr.length - 20} more)` : ''
      }`,
    ).toEqual([]);
    expect(
      extraInFr,
      `messages/fr.json has keys absent in nl: ${extraInFr.slice(0, 20).join(', ')}${
        extraInFr.length > 20 ? ` (+${extraInFr.length - 20} more)` : ''
      }`,
    ).toEqual([]);
  });

  it('no value equals a placeholder marker ([MISSING_TRANSLATION], TODO, __TODO__)', () => {
    const markers = ['[MISSING_TRANSLATION]', 'TODO', '__TODO__'] as const;
    const hits: Array<{ locale: Locale; key: string; value: string }> = [];
    for (const loc of LOCALES) {
      const localHits: Array<{ key: string; value: string }> = [];
      collectPlaceholderHits(catalogs[loc], '', markers, localHits);
      for (const h of localHits) hits.push({ locale: loc, ...h });
    }
    expect(
      hits,
      `placeholder markers detected: ${hits
        .slice(0, 20)
        .map((h) => `${h.locale}:${h.key}=${h.value}`)
        .join(' | ')}`,
    ).toEqual([]);
  });
});
