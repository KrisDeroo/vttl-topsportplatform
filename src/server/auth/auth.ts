/**
 * Better Auth instance — single auth layer (Plan 05).
 *
 * Locks the SEC-01..06 contract:
 *   - SEC-01: cookies httpOnly + Secure (in production) + SameSite=Lax (Better Auth defaults)
 *   - SEC-02: trustedOrigins = [NEXT_PUBLIC_APP_URL] for CSRF (Origin/Sec-Fetch checks)
 *   - SEC-03: session.freshAge = 1h re-auth window for sensitive ops
 *             (parent-child link, medical view, GDPR export, erasure)
 *   - SEC-04: secrets are NEVER logged here; pino redact handles app-level (Plan 13)
 *   - SEC-05: resetPasswordTokenExpiresIn = 1h
 *   - SEC-06: rateLimit window 15min / max 5 attempts (lockout)
 *   - AUTH-01: session.expiresIn = 30 days (survives browser restart)
 *   - AUTH-04/05: admin plugin maps `technical_director` as adminRole
 *
 * Uses the Drizzle adapter against Plan 02's `users` / `sessions` / `accounts` /
 * `verifications` tables. Better Auth manages id/email/emailVerified/name/image;
 * VTTL extension columns (role, preferred_locale, active, deactivatedAt,
 * dateOfBirth) live alongside and are populated by VTTL flows.
 *
 * Email hooks are STUBBED — Plan 06 replaces sendResetPasswordStub +
 * sendVerificationEmailStub with `sendEmailLocalized` (React Email + Resend,
 * EU region, locale-aware). Until then, both stubs log to the console with a
 * loud `[auth] STUB` prefix so any production deploy flagged by ops is obvious.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Better Auth Integration (lines 1530-1666)
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import {
  defaultStatements,
  adminAc,
  userAc,
} from 'better-auth/plugins/admin/access';
import { db } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { env } from '@/lib/env';

/**
 * Custom access-control statements + role grants for the Better Auth admin plugin.
 *
 * DEVIATION (A8 — RESEARCH line 2540): Better Auth 1.6.9 enforces at runtime that
 * every entry in `adminRoles` is a key of the `roles` configuration (or one of
 * the defaults `admin` / `user`). To pass `'technical_director'` as an admin role
 * we must register it via `createAccessControl({...}).newRole({...})`.
 *
 * The seven VTTL roles map onto Better Auth's permission statements:
 *   - technical_director: full admin access (extends `adminAc`)
 *   - all other roles:    no platform-admin powers (extends `userAc`)
 *
 * VTTL's domain authorization (medical, consent, audit) is enforced by the
 * tRPC middleware via `ROLE_PERMISSIONS` (Plan 11), NOT by this access-control
 * matrix. The Better Auth statements only gate the admin plugin's user-management
 * endpoints (createUser, listUsers, setRole, ban, etc. — AUTH-04/05).
 */
const ac = createAccessControl(defaultStatements);

const vttlRoles = {
  technical_director: ac.newRole(adminAc.statements),
  academy_manager: ac.newRole(userAc.statements),
  trainer: ac.newRole(userAc.statements),
  player: ac.newRole(userAc.statements),
  parent: ac.newRole(userAc.statements),
  sparring_partner: ac.newRole(userAc.statements),
  medical_staff: ac.newRole(userAc.statements),
};

/**
 * Map pino-style log levels to Better Auth's narrower LogLevel union.
 *
 *  pino:        fatal | error | warn | info | debug | trace
 *  Better Auth:         error | warn | info | debug
 *
 * `fatal` is mapped to `error` (the closest practical equivalent — Better Auth
 * does not surface fatal as a separate severity), `trace` is mapped to `debug`.
 */
function normalizeLogLevel(
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
): 'error' | 'warn' | 'info' | 'debug' {
  switch (level) {
    case 'fatal':
      return 'error';
    case 'trace':
      return 'debug';
    default:
      return level;
  }
}

/**
 * Plan 06 replaces this stub with `sendEmailLocalized({ template: 'password-reset' })`.
 * Until then, log the URL so dev flows can manually click it. In production this is
 * a no-op (the warning is visible in deployment logs and triggers ops review).
 */
async function sendResetPasswordStub(args: {
  user: { email: string; preferredLocale?: string };
  url: string;
}): Promise<void> {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] STUB sendResetPassword — Plan 06 overrides:',
    args.user.email,
    args.url,
  );
}

/**
 * Plan 06 replaces this stub with `sendEmailLocalized({ template: 'verify-email' })`.
 */
async function sendVerificationEmailStub(args: {
  user: { email: string; preferredLocale?: string };
  url: string;
}): Promise<void> {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] STUB sendVerificationEmail — Plan 06 overrides:',
    args.user.email,
    args.url,
  );
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: false, // require email verification before first login
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordStub({ user, url });
    },
    resetPasswordTokenExpiresIn: 60 * 60, // SEC-05: 1h
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60 * 24, // 24h
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmailStub({ user, url });
    },
  },

  // SEC-01: Better Auth defaults set httpOnly + Secure (in production) + SameSite=Lax
  // on the session cookie. The defaults are NOT overridden here — any change here
  // weakens SEC-01 unless explicitly justified.
  session: {
    expiresIn: 60 * 60 * 24 * 30, // AUTH-01: 30 days (survives browser restart)
    updateAge: 60 * 60 * 24, // refresh cookie every 24h of activity
    cookieCache: { enabled: true, maxAge: 60 * 5 }, // 5-minute in-memory cache
    freshAge: 60 * 60, // SEC-03: 1h fresh re-auth window
  },

  // SEC-02: CSRF — trustedOrigins limits cross-site Origin headers and validates
  // callbackURL/redirectTo so an attacker can't bounce a verified user to evil.com.
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],

  // SEC-06: lockout — 5 failed attempts within 15 minutes.
  // Better Auth tracks per-IP (or per-userId for authenticated routes) automatically.
  rateLimit: {
    enabled: true,
    window: 60 * 15, // 15-minute window
    max: 5, // 5 attempts before lockout
  },

  // SEC-04: Better Auth's own logger inherits LOG_LEVEL; secret values are
  // NEVER passed through here. Pino's redact paths (Plan 13 + log-redact-paths.ts)
  // catch any accidental PII at the app boundary.
  // Better Auth's Logger.level union is narrower than pino's (no 'trace'/'fatal'),
  // so the wider env value is normalised to the closest accepted level.
  logger: { level: normalizeLogLevel(env.LOG_LEVEL) },

  plugins: [
    // AUTH-04/05: technical_director is the only VTTL role with platform-admin
    // powers. Better Auth 1.6.9 validates at runtime that every entry in
    // `adminRoles` is a key of `roles` — see DEVIATION note above the
    // `vttlRoles` declaration for why `ac` + `roles` are required.
    admin({
      defaultRole: 'player',
      adminRoles: ['technical_director'],
      ac,
      roles: vttlRoles,
    }),
  ],
});

export type Session = (typeof auth.$Infer.Session)['session'];
export type User = (typeof auth.$Infer.Session)['user'];
