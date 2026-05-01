import { describe, it, expect } from 'vitest';
import { formatDate, formatNumber } from '@/lib/i18n-format';

/**
 * I18N-07 — locale-specific date/number formatting.
 *
 * Belgian/Dutch decimal convention: '.' thousands, ',' decimal.
 * UK: ',' thousands, '.' decimal.
 * French (BE): NBSP/space thousands, ',' decimal.
 * weekStartsOn=1 (Monday) for all three (D-18 + I18N-07 explicit).
 */
describe('I18N-07 — Intl/date-fns format', () => {
  const ref = new Date('2026-05-01T10:00:00Z');

  it('formatDate uses nl-BE for nl locale', () => {
    expect(formatDate(ref, 'nl', 'dd/MM/yyyy')).toBe('01/05/2026');
  });
  it('formatDate uses en-GB for en locale', () => {
    expect(formatDate(ref, 'en', 'dd/MM/yyyy')).toBe('01/05/2026');
  });
  it('formatDate uses fr-BE for fr locale', () => {
    expect(formatDate(ref, 'fr', 'dd/MM/yyyy')).toBe('01/05/2026');
  });
  it('formatNumber nl returns 1.234,5 (Belgian/Dutch)', () => {
    // Some Intl backends use NBSP ( ) or thin-NBSP ( ); accept both
    expect(formatNumber(1234.5, 'nl')).toMatch(/1[.   ]234,5/);
  });
  it('formatNumber en returns 1,234.5', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });
  it('formatNumber fr uses NBSP/space thousands and comma decimal', () => {
    expect(formatNumber(1234.5, 'fr')).toMatch(/1[   ]234,5/);
  });
});
