/**
 * Typed env validation gate.
 *
 * Validates every server/client env var at module-load time using
 * @t3-oss/env-nextjs. Build fails (and `import { env }` throws at runtime)
 * if any required key is missing — eliminates "deployed without DATABASE_URL"
 * foot-guns (Threat T-01-CFG, mitigated via this file + .env.example contract).
 *
 * Two database URLs:
 *  - DATABASE_URL: Supabase pooler (port 6543) — used by application code at runtime
 *  - DIRECT_DATABASE_URL: non-pooler (port 5432) — used by Drizzle Kit for migrations
 *    (pooler does not support `CREATE INDEX CONCURRENTLY` and other DDL primitives)
 *
 * Two Redis URLs (D-12 + D-15):
 *  - UPSTASH_REDIS_REST_URL/TOKEN: REST API for ratelimit + JWT revocation list
 *    (stateless HTTP, works in Node + Edge runtime)
 *  - REDIS_URL: ioredis-compatible TCP/TLS endpoint for BullMQ workers
 *    (BullMQ requires Lua scripts + blocking commands — REST cannot do this)
 *
 * Phase 2 additions (file pipeline — FILE-01 / VALID-04):
 *  - SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (D-22, FILE-01): server-only
 *    Supabase Storage client used by file.upload + signed URL generation.
 *    NEVER bundle into client — see src/server/storage/client.ts header.
 *  - CLAMAV_HOST/CLAMAV_PORT (D-22): TCP socket for clamd; default
 *    'clamav':3310 matches the Coolify sidecar service name.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Environment variables
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Runtime State Inventory
 */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DIRECT_DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(20),
    REDIS_URL: z.string().url(),
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().email(),
    SENTRY_DSN: z.string().url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    MEDICAL_ENCRYPTION_KEY: z.string().min(32),
    LOGFLARE_API_KEY: z.string().optional(),
    LOGFLARE_SOURCE: z.string().optional(),
    // Phase 2 — Supabase Storage (FILE-01) + ClamAV (VALID-04); D-22
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
    CLAMAV_HOST: z.string().min(1).default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['nl', 'en', 'fr']).default('nl'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SENTRY_DSN: process.env.SENTRY_DSN,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    MEDICAL_ENCRYPTION_KEY: process.env.MEDICAL_ENCRYPTION_KEY,
    LOGFLARE_API_KEY: process.env.LOGFLARE_API_KEY,
    LOGFLARE_SOURCE: process.env.LOGFLARE_SOURCE,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CLAMAV_HOST: process.env.CLAMAV_HOST,
    CLAMAV_PORT: process.env.CLAMAV_PORT,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  },
  // Treat empty strings as undefined so missing-but-set-to-"" still fails validation.
  emptyStringAsUndefined: true,
  // Allow tests to skip validation when supplemental keys are not present.
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
});
