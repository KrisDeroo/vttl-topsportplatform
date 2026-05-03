import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'Use Date.now() or db.timestamptz default. Naive new Date() forbidden — see GDPR-08.',
        },
        {
          selector:
            "CallExpression[callee.name='timestamp'] ObjectExpression Property[key.name='withTimezone'][value.value=false]",
          message:
            'TIMESTAMPTZ required (GDPR-08). Use tstz() from @/server/db/helpers/timestamps. Never set withTimezone:false.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'moment', message: 'Use date-fns instead.' },
            {
              name: '@supabase/supabase-js',
              message:
                'Phase 1 stack lock: connect via postgres URL only — Drizzle ORM. No Supabase JS SDK in app code (RISK-SUPABASE-LOCK).',
            },
            {
              name: '@upstash/redis',
              importNames: ['Redis'],
              message: 'Use lib/cache.ts. Direct Upstash API forbidden by D-14.',
            },
          ],
          patterns: [
            {
              group: ['**/messages/*'],
              message:
                'Import message catalogs only via next-intl helpers (useTranslations, getTranslations).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/cache.ts', 'src/server/trpc/middleware/rateLimit.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/components/consent/consent-step.tsx'],
    rules: { 'react/no-danger': 'off' },
  },
  {
    files: ['src/server/db/helpers/timestamps.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
