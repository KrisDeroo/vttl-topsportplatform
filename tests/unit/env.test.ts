/**
 * Unit tests for src/lib/env.ts — typed env validation gate.
 *
 * NOTE: vitest globalSetup (tests/setup.ts) populates process.env with the
 * testcontainer DATABASE_URL/DIRECT_DATABASE_URL/MEDICAL_ENCRYPTION_KEY before
 * any test module loads. We supplement with the remaining required keys per
 * test, then dynamic-import @/lib/env so @t3-oss/env-nextjs validation runs
 * against the in-test environment (no module-cache leakage between tests).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const REQUIRED_SERVER_KEYS = [
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'REDIS_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'MEDICAL_ENCRYPTION_KEY',
] as const;

const REQUIRED_CLIENT_KEYS = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_DEFAULT_LOCALE'] as const;

const VALID_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://u:p@host:6543/db',
  DIRECT_DATABASE_URL: 'postgres://u:p@host:5432/db',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  UPSTASH_REDIS_REST_URL: 'https://upstash.example/api',
  UPSTASH_REDIS_REST_TOKEN: 'b'.repeat(20),
  REDIS_URL: 'rediss://default:pw@host:6379',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'noreply@vttl.be',
  MEDICAL_ENCRYPTION_KEY: 'c'.repeat(32),
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

describe('env validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('exposes typed env when all required vars present', async () => {
    for (const [k, v] of Object.entries(VALID_ENV)) process.env[k] = v;
    delete process.env.NEXT_PUBLIC_DEFAULT_LOCALE; // exercise the default
    const mod = await import('@/lib/env');
    expect(mod.env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(mod.env.MEDICAL_ENCRYPTION_KEY).toBe(VALID_ENV.MEDICAL_ENCRYPTION_KEY);
  });

  it('reads NEXT_PUBLIC_DEFAULT_LOCALE default of nl when unset', async () => {
    for (const [k, v] of Object.entries(VALID_ENV)) process.env[k] = v;
    delete process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
    const mod = await import('@/lib/env');
    expect(mod.env.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('nl');
  });

  it('.env.example documents every required key', async () => {
    const examplePath = path.resolve(__dirname, '../../.env.example');
    const example = await fs.readFile(examplePath, 'utf-8');
    for (const key of [...REQUIRED_SERVER_KEYS, ...REQUIRED_CLIENT_KEYS]) {
      expect(example, `missing ${key} in .env.example`).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });
});
