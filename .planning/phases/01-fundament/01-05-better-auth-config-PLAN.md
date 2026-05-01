---phase: 01-fundament
plan: 05
type: execute
wave: 3
depends_on: [02]
files_modified:
  - src/server/auth/auth.ts
  - src/server/auth/client.ts
  - src/server/auth/permissions.ts
  - src/app/api/auth/[...all]/route.ts
  - src/server/trpc/middleware/csrf.ts
  - tests/unit/auth-config.test.ts
  - tests/integration/lockout.test.ts
  - tests/integration/fresh-session.test.ts
  - tests/integration/csrf.test.ts
  - tests/unit/log-redact.test.ts
autonomous: true
requirements:
  - AUTH-01
  - SEC-01
  - SEC-02
  - SEC-04
  - SEC-05
  - SEC-06
requirements_supports:  # informational — primary owners listed below
  - AUTH-02
  - AUTH-03
  - SEC-03
threat_refs:
  - T-01-01
  - T-01-05
  - T-01-06
tags:
  - phase-1
  - auth
  - better-auth
  - sec

must_haves:
  truths:
    - "betterAuth() configured with drizzleAdapter, emailAndPassword.enabled=true, requireEmailVerification=true"
    - "session.expiresIn = 60 * 60 * 24 * 30 (30d for AUTH-01); session.freshAge = 60 * 60 (1h for SEC-03)"
    - "rateLimit: enabled=true, window=60*15, max=5 (SEC-06: 5 failed/15min lockout)"
    - "resetPasswordTokenExpiresIn = 60*60 (1h, SEC-05); emailVerification.expiresIn = 60*60*24 (24h)"
    - "Cookies httpOnly + Secure + SameSite=Lax verified by Better Auth defaults (SEC-01)"
    - "trustedOrigins=[NEXT_PUBLIC_APP_URL] for CSRF (SEC-02)"
    - "Route handler at src/app/api/auth/[...all]/route.ts via toNextJsHandler"
    - "Better Auth admin plugin enabled with adminRoles=['technical_director'] for AUTH-04/05 path"
    - "Permissions matrix exported from src/server/auth/permissions.ts (Plan 11 + 15 consume)"
    - "freshSession middleware exists for SEC-03 (parent-child link, medical view, export, erasure)"
  artifacts:
    - path: "src/server/auth/auth.ts"
      provides: "betterAuth() instance + Session/User type exports"
      contains: "betterAuth"
    - path: "src/server/auth/permissions.ts"
      provides: "Role → permission matrix (single source of truth, CRIT-3)"
      contains: "ROLE_PERMISSIONS"
    - path: "src/server/auth/client.ts"
      provides: "createAuthClient (browser-side)"
      contains: "createAuthClient"
    - path: "src/app/api/auth/[...all]/route.ts"
      provides: "GET + POST handlers for Better Auth"
      contains: "toNextJsHandler"
    - path: "src/server/trpc/middleware/csrf.ts"
      provides: "CSRF helper that validates Origin header against trustedOrigins (SEC-02)"
      exports: ["csrfMiddleware"]
  key_links:
    - from: "src/server/auth/auth.ts"
      to: "src/server/db/schema/auth.ts"
      via: "drizzleAdapter schema mapping (user/session/account/verification)"
      pattern: "drizzleAdapter"
    - from: "src/server/auth/auth.ts"
      to: "src/server/email/send.ts (Plan 06)"
      via: "sendResetPassword + sendVerificationEmail hooks"
      pattern: "sendEmailLocalized"
---

<objective>
Configure Better Auth as the single auth layer: email+password login, password reset, session cookies, fresh-session window for sensitive ops, CSRF via trustedOrigins, and the lockout (5 failed/15 min — SEC-06). Wire the Drizzle adapter against Plan 02's `users` / `sessions` / `accounts` / `verifications` tables.

This plan does NOT yet localize email content (Plan 06 does that — overrides the hooks); the auth.ts file leaves `sendResetPassword` calling a stub that Plan 06 replaces with `sendEmailLocalized`.

Output: working `/api/auth/*` route handler + permissions matrix + freshSession middleware foundation.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: betterAuth() config + Drizzle adapter + permissions matrix + route handler</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Better Auth Integration (lines 1534–1666)
    - .planning/phases/01-fundament/01-RESEARCH.md §`auth.ts` (lines 1538–1634) — exact config object
    - src/server/db/schema/auth.ts (Plan 02) — table shapes
    - .planning/phases/01-fundament/01-CONTEXT.md (D-08, D-09 — CallerContext + revocation; D-15/16 — async jobs)
  </read_first>
  <files>
    src/server/auth/auth.ts
    src/server/auth/client.ts
    src/server/auth/permissions.ts
    src/app/api/auth/[...all]/route.ts
    tests/unit/auth-config.test.ts
  </files>
  <behavior>
    - Test 1 (unit): auth instance has emailAndPassword.minPasswordLength === 12, requireEmailVerification === true
    - Test 2 (unit): session.expiresIn === 60*60*24*30 (30d), session.freshAge === 60*60 (1h)
    - Test 3 (unit): rateLimit window === 60*15 and max === 5 (SEC-06)
    - Test 4 (unit): emailVerification.expiresIn === 60*60*24 (24h)
    - Test 5 (unit): resetPasswordTokenExpiresIn === 60*60 (1h, SEC-05)
  </behavior>
  <action>
    Create `src/server/auth/auth.ts` exactly per RESEARCH lines 1538–1634:
    ```ts
    import { betterAuth } from 'better-auth';
    import { drizzleAdapter } from 'better-auth/adapters/drizzle';
    import { admin } from 'better-auth/plugins';
    import { db } from '@/server/db/client';
    import * as schema from '@/server/db/schema';
    import { env } from '@/lib/env';

    // Plan 06 replaces these stub email hooks with sendEmailLocalized().
    async function sendResetPasswordStub(args: { user: { email: string; preferredLocale?: string }; url: string }) {
      // Replaced by Plan 06: src/server/email/send.ts → sendEmailLocalized()
      // For now: log to console (dev only — must NOT ship to prod)
      console.warn('[auth] sendResetPassword stub — Plan 06 overrides:', args.user.email, args.url);
    }
    async function sendVerificationEmailStub(args: { user: { email: string; preferredLocale?: string }; url: string }) {
      console.warn('[auth] sendVerificationEmail stub — Plan 06 overrides:', args.user.email, args.url);
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
        autoSignIn: false,
        requireEmailVerification: true,
        minPasswordLength: 12,
        maxPasswordLength: 128,
        sendResetPassword: async ({ user, url }) => {
          await sendResetPasswordStub({ user, url });
        },
        resetPasswordTokenExpiresIn: 60 * 60,           // SEC-05: 1h
      },

      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: false,
        expiresIn: 60 * 60 * 24,                         // 24h
        sendVerificationEmail: async ({ user, url }) => {
          await sendVerificationEmailStub({ user, url });
        },
      },

      session: {
        expiresIn: 60 * 60 * 24 * 30,                    // AUTH-01: 30d (survives browser restart)
        updateAge: 60 * 60 * 24,                         // refresh cookie every 24h of activity
        cookieCache: { enabled: true, maxAge: 60 * 5 },  // 5 min in-memory cache
        freshAge: 60 * 60,                               // SEC-03: 1h fresh window
      },

      trustedOrigins: [env.NEXT_PUBLIC_APP_URL],         // SEC-02: CSRF

      rateLimit: {
        enabled: true,
        window: 60 * 15,                                 // 15 min
        max: 5,                                          // SEC-06: 5 attempts
      },

      logger: { disabled: env.NODE_ENV === 'production' ? false : false, level: env.LOG_LEVEL },

      plugins: [
        admin({ defaultRole: 'player', adminRoles: ['technical_director'] }),
      ],
    });

    export type Session = typeof auth.$Infer.Session;
    export type User = Session['user'];
    ```

    Create `src/server/auth/client.ts`:
    ```ts
    import { createAuthClient } from 'better-auth/react';
    import { adminClient } from 'better-auth/client/plugins';

    export const authClient = createAuthClient({
      baseURL: typeof window !== 'undefined' ? window.location.origin : '',
      plugins: [adminClient()],
    });

    export const { signIn, signUp, signOut, useSession } = authClient;
    ```

    Create `src/server/auth/permissions.ts` — single source of truth (CRIT-3):
    ```ts
    /**
     * Role → permission matrix. Single source of truth.
     * Imported by tRPC middleware (Plan 11), admin UI (Plan 15), and consent flow (Plan 12).
     * NEVER hard-code role checks elsewhere — always import a permission name from here.
     */

    export type Role =
      | 'technical_director'
      | 'academy_manager'
      | 'trainer'
      | 'player'
      | 'parent'
      | 'sparring_partner'
      | 'medical_staff';

    export type Permission =
      | 'user.create'        | 'user.activate'      | 'user.deactivate'    | 'user.assign_role'
      | 'user.link_parent'   | 'user.link_academy'
      | 'consent.give_self'  | 'consent.give_for_minor' | 'consent.withdraw_self'
      | 'consent.read_own'   | 'consent.read_any'
      | 'medical.read_own'   | 'medical.read_assigned' | 'medical.read_any'
      | 'medical.write'      | 'medical.read_traffic_light'
      | 'audit.read_any'     | 'audit.read_self_actions'
      | 'lookup.write';

    export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
      technical_director: [
        'user.create', 'user.activate', 'user.deactivate', 'user.assign_role',
        'user.link_parent', 'user.link_academy',
        'consent.read_any', 'consent.give_self', 'consent.withdraw_self',
        'medical.read_any', 'medical.write',
        'audit.read_any', 'lookup.write',
      ],
      academy_manager: [
        'consent.give_self', 'consent.withdraw_self', 'consent.read_own',
        'audit.read_self_actions',
      ],
      trainer: [
        'consent.give_self', 'consent.withdraw_self', 'consent.read_own',
        'medical.read_traffic_light',
        'audit.read_self_actions',
      ],
      player: [
        'consent.give_self', 'consent.withdraw_self', 'consent.read_own',
        'medical.read_own',
      ],
      parent: [
        'consent.give_self', 'consent.give_for_minor', 'consent.withdraw_self', 'consent.read_own',
        'medical.read_assigned',
      ],
      sparring_partner: [
        'consent.give_self', 'consent.withdraw_self', 'consent.read_own',
      ],
      medical_staff: [
        'medical.read_any', 'medical.write',
        'consent.give_self', 'consent.withdraw_self', 'consent.read_own',
      ],
    };

    export function hasPermission(role: Role, perm: Permission): boolean {
      return ROLE_PERMISSIONS[role].includes(perm);
    }
    ```

    Create `src/app/api/auth/[...all]/route.ts`:
    ```ts
    import { auth } from '@/server/auth/auth';
    import { toNextJsHandler } from 'better-auth/next-js';

    export const { GET, POST } = toNextJsHandler(auth.handler);
    ```

    Write `tests/unit/auth-config.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';

    describe('Better Auth config — SEC-01..06', () => {
      it('emailAndPassword settings (SEC-05, SEC-06)', async () => {
        const { auth } = await import('@/server/auth/auth');
        const opts = (auth as any).options;
        expect(opts.emailAndPassword.enabled).toBe(true);
        expect(opts.emailAndPassword.requireEmailVerification).toBe(true);
        expect(opts.emailAndPassword.minPasswordLength).toBe(12);
        expect(opts.emailAndPassword.resetPasswordTokenExpiresIn).toBe(60 * 60);  // 1h
      });

      it('session settings (AUTH-01, SEC-03)', async () => {
        const { auth } = await import('@/server/auth/auth');
        const opts = (auth as any).options;
        expect(opts.session.expiresIn).toBe(60 * 60 * 24 * 30);  // 30d
        expect(opts.session.freshAge).toBe(60 * 60);             // 1h
      });

      it('rateLimit settings (SEC-06: 5 attempts / 15 min)', async () => {
        const { auth } = await import('@/server/auth/auth');
        const opts = (auth as any).options;
        expect(opts.rateLimit.enabled).toBe(true);
        expect(opts.rateLimit.window).toBe(60 * 15);
        expect(opts.rateLimit.max).toBe(5);
      });

      it('admin plugin maps technical_director as admin (AUTH-04/05)', async () => {
        const { auth } = await import('@/server/auth/auth');
        const opts = (auth as any).options;
        const adminPlugin = (opts.plugins as any[]).find((p) => p.id === 'admin');
        expect(adminPlugin).toBeDefined();
        expect(adminPlugin.options?.adminRoles ?? adminPlugin.adminRoles).toContain('technical_director');
      });

      it('emailVerification expiresIn = 24h', async () => {
        const { auth } = await import('@/server/auth/auth');
        const opts = (auth as any).options;
        expect(opts.emailVerification.expiresIn).toBe(60 * 60 * 24);
      });
    });
    ```

    NOTE on assumption A8 (RESEARCH line 2540): Better Auth admin plugin's `adminRoles` accepts arbitrary strings. If actual installation reveals it requires specific role names, the executor must adapt — pass the correct role identifier and document the deviation in the plan SUMMARY. This is Claude's discretion per plan_organization.
  </action>
  <verify>
    <automated>test -f src/server/auth/auth.ts && test -f src/server/auth/client.ts && test -f src/server/auth/permissions.ts && test -f src/app/api/auth/\[...all\]/route.ts && grep -q "drizzleAdapter" src/server/auth/auth.ts && grep -q "expiresIn: 60 \* 60 \* 24 \* 30" src/server/auth/auth.ts && grep -q "freshAge: 60 \* 60" src/server/auth/auth.ts && grep -q "max: 5" src/server/auth/auth.ts && grep -q "minPasswordLength: 12" src/server/auth/auth.ts && grep -q "resetPasswordTokenExpiresIn: 60 \* 60" src/server/auth/auth.ts && grep -q "trustedOrigins: \[env.NEXT_PUBLIC_APP_URL\]" src/server/auth/auth.ts && grep -q "ROLE_PERMISSIONS" src/server/auth/permissions.ts && grep -q "technical_director" src/server/auth/permissions.ts && grep -q "medical.read_any" src/server/auth/permissions.ts && grep -q "toNextJsHandler" src/app/api/auth/\[...all\]/route.ts && npx tsc --noEmit && npx vitest run tests/unit/auth-config.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/auth/auth.ts` configures Better Auth exactly per RESEARCH §Better Auth Integration
    - All 5 tests in `tests/unit/auth-config.test.ts` pass
    - `src/server/auth/permissions.ts` exports `Role`, `Permission`, `ROLE_PERMISSIONS`, `hasPermission`
    - 7 roles × N permissions = matrix is exhaustive (every Role key appears in ROLE_PERMISSIONS)
    - Route handler `src/app/api/auth/[...all]/route.ts` exports GET + POST
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Better Auth wired with locked SEC-01..06 settings; permissions matrix is the CRIT-3 single source of truth.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CSRF middleware (SEC-02) + integration tests (lockout, fresh-session, csrf, log-redact)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §CSRF (lines 1654–1658)
    - .planning/phases/01-fundament/01-RESEARCH.md §Re-auth flow (lines 1660–1666)
    - .planning/phases/01-fundament/01-VALIDATION.md (per-task verification map for SEC-* requirements)
    - tests/helpers/db.ts (Plan 17)
  </read_first>
  <files>
    src/server/trpc/middleware/csrf.ts
    tests/integration/lockout.test.ts
    tests/integration/fresh-session.test.ts
    tests/integration/csrf.test.ts
    tests/unit/log-redact.test.ts
  </files>
  <behavior>
    - Test 1 (integration): 6th login attempt within 15 min for same email returns 429 (SEC-06)
    - Test 2 (integration): tRPC `requireFreshSession` procedure returns FORBIDDEN: re_auth_required when freshUntil expired (SEC-03)
    - Test 3 (integration): POST mutation from foreign Origin returns CSRF error (SEC-02)
    - Test 4 (unit): pino redact filters `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.email`, `*.medical_*` (SEC-04, OPS-01)
  </behavior>
  <action>
    Create `src/server/trpc/middleware/csrf.ts` (origin validation as belt for Better Auth's SameSite=Lax):
    ```ts
    import { TRPCError } from '@trpc/server';
    import { env } from '@/lib/env';

    /** Validates request Origin against trustedOrigins. Better Auth's SameSite=Lax is the primary CSRF defense
     *  for browser clients; this middleware is a belt for non-browser clients (curl, native apps) that bypass
     *  cookie SameSite rules. */
    export function csrfMiddleware(getOrigin: () => string | null) {
      return ({ next }: { next: () => Promise<unknown> }) => {
        const origin = getOrigin();
        if (origin && origin !== env.NEXT_PUBLIC_APP_URL) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'csrf_origin_mismatch' });
        }
        return next();
      };
    }
    ```

    Write `tests/integration/lockout.test.ts`:
    ```ts
    import { describe, it, expect, beforeAll, afterAll } from 'vitest';
    import { freshDb } from '../helpers/db';

    describe('SEC-06 lockout — 5 failed/15 min', () => {
      let h: Awaited<ReturnType<typeof freshDb>>;
      beforeAll(async () => { h = await freshDb(); });
      afterAll(async () => { await h[Symbol.asyncDispose](); });

      it('6th attempt with wrong password returns 429 / TOO_MANY_REQUESTS', async () => {
        const { auth } = await import('@/server/auth/auth');
        // Seed user with verified email
        // Try 6 sign-ins with wrong password
        const email = `lockout-${Date.now()}@vttl.test`;
        await auth.api.signUpEmail({ body: { email, password: 'CorrectHorseBattery!', name: 'X' } });

        for (let i = 0; i < 5; i++) {
          await expect(auth.api.signInEmail({ body: { email, password: 'wrongpw1' } })).rejects.toBeDefined();
        }
        await expect(auth.api.signInEmail({ body: { email, password: 'wrongpw1' } }))
          .rejects.toMatchObject({ status: 429 });
      });
    });
    ```

    Write `tests/integration/fresh-session.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';

    describe('SEC-03 freshSession middleware', () => {
      it('returns FORBIDDEN: re_auth_required when freshUntil expired', async () => {
        // Plan 11 wires the requireFreshSession middleware; this test validates the contract.
        // Stub a session with freshUntil = 1h ago.
        const { requireFreshSession } = await import('@/server/trpc/middleware/freshSession');
        const ctx = { scope: { fresh: false, userId: 'u1', role: 'player', academyIds: [], linkedPlayerIds: [], locale: 'nl', issuedAt: Date.now() } } as any;
        await expect((requireFreshSession as any)({ ctx, next: async () => {} }))
          .rejects.toMatchObject({ code: 'FORBIDDEN', message: 're_auth_required' });
      });
    });
    ```

    Write `tests/integration/csrf.test.ts`:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { csrfMiddleware } from '@/server/trpc/middleware/csrf';

    describe('SEC-02 CSRF — Origin validation', () => {
      it('rejects request with foreign Origin', async () => {
        const mw = csrfMiddleware(() => 'http://evil.example');
        await expect((mw as any)({ next: async () => 'ok' }))
          .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'csrf_origin_mismatch' });
      });

      it('passes request with matching Origin', async () => {
        process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
        const mw = csrfMiddleware(() => 'http://localhost:3000');
        await expect((mw as any)({ next: async () => 'ok' })).resolves.toBe('ok');
      });

      it('passes request with no Origin (server-to-server)', async () => {
        const mw = csrfMiddleware(() => null);
        await expect((mw as any)({ next: async () => 'ok' })).resolves.toBe('ok');
      });
    });
    ```

    Write `tests/unit/log-redact.test.ts` (SEC-04 + OPS-01 — note: full pino instance lives in Plan 13; this test asserts the redact contract):
    ```ts
    import { describe, it, expect, beforeEach, vi } from 'vitest';

    describe('SEC-04 + OPS-01 — pino redact', () => {
      it('redacts authorization, cookie, password, email, dateOfBirth, medical_* paths', async () => {
        // Plan 13 creates @/lib/log; this test asserts the contract.
        const captured: any[] = [];
        vi.doMock('pino', () => ({
          default: (opts: any) => {
            const child = (b: any) => ({
              info: (rec: any) => captured.push({ ...rec, redact: opts.redact?.paths }),
              child,
            });
            return child(opts.base);
          },
        }));
        const mod = await import('@/lib/log');
        mod.log.info({ req: { headers: { authorization: 'Bearer x', cookie: 'sid=y' } }, user: { password: 'p', email: 'a@b', medical_x: 'sensitive' } }, 'test');
        const last = captured.at(-1);
        const redactPaths: string[] = last.redact ?? [];
        expect(redactPaths).toEqual(expect.arrayContaining([
          'req.headers.authorization', 'req.headers.cookie',
          '*.password', '*.email', '*.dateOfBirth',
          expect.stringContaining('medical_'),
        ]));
      });
    });
    ```
    NOTE: this test stays RED until Plan 13. Tag with `it.skip` if Plan 13 incomplete; or have it import pino-redact-paths from a constants module (Plan 13 creates `src/lib/log-redact-paths.ts`). Decision: put redact paths in a shared constants file `src/lib/log-redact-paths.ts` so this test can import them without depending on the runtime pino instance.

    Add `src/lib/log-redact-paths.ts`:
    ```ts
    /** Single source of truth for pino redact paths. Imported by Plan 13 (log.ts) AND by tests. */
    export const REDACT_PATHS = [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.email',
      '*.phone',
      '*.dateOfBirth',
      '*.ipAddress',
      '*.medical_*',
      '*.eventDescriptionCipher',
      '*.doctorCipher',
      '*.consentTextSnapshot',
    ] as const;
    ```

    Replace the test body to import this constant directly:
    ```ts
    import { describe, it, expect } from 'vitest';
    import { REDACT_PATHS } from '@/lib/log-redact-paths';

    describe('SEC-04 + OPS-01 redact paths constant', () => {
      it('includes auth headers, password, cookie, email, medical_*', () => {
        expect(REDACT_PATHS).toEqual(expect.arrayContaining([
          'req.headers.authorization', 'req.headers.cookie',
          '*.password', '*.email', '*.medical_*',
        ]));
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/trpc/middleware/csrf.ts && test -f src/lib/log-redact-paths.ts && test -f tests/integration/csrf.test.ts && test -f tests/unit/log-redact.test.ts && grep -q "csrf_origin_mismatch" src/server/trpc/middleware/csrf.ts && grep -q "REDACT_PATHS" src/lib/log-redact-paths.ts && grep -q "req.headers.authorization" src/lib/log-redact-paths.ts && grep -q "\*.medical_\*" src/lib/log-redact-paths.ts && npx vitest run tests/unit/log-redact.test.ts tests/integration/csrf.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/trpc/middleware/csrf.ts` exports `csrfMiddleware(getOrigin)` that throws TRPCError FORBIDDEN with message `csrf_origin_mismatch` on mismatch
    - `src/lib/log-redact-paths.ts` exports `REDACT_PATHS` containing at least 14 paths including all required PII patterns
    - `tests/unit/log-redact.test.ts` passes
    - `tests/integration/csrf.test.ts` passes (3 cases)
    - `tests/integration/lockout.test.ts` and `tests/integration/fresh-session.test.ts` exist (RED until Plan 16 push + Plan 11 freshSession middleware land)
  </acceptance_criteria>
  <done>CSRF + lockout + fresh-session + log-redact tests exist; redact paths centralised for Plan 13.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser ↔ Better Auth handler | httpOnly + Secure + SameSite=Lax cookies; trustedOrigins for CSRF |
| Auth handler ↔ Drizzle DB | drizzleAdapter pg provider; secret signs session tokens |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Spoofing / Tampering | CSRF on state-changing mutations | mitigate | SameSite=Lax + trustedOrigins + csrfMiddleware Origin check (belt-and-braces) |
| T-01-05 | Spoofing | Brute-force login | mitigate | Better Auth rateLimit window=15min max=5 (SEC-06); IP rate limit 1000/min (Plan 09) |
| T-01-06 | Information Disclosure | PII in logs | mitigate | REDACT_PATHS centralised in `src/lib/log-redact-paths.ts`; Plan 13 wires pino instance to use it |
</threat_model>

<verification>
- `auth.ts` imports compile without circular dep errors
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/unit/auth-config.test.ts tests/unit/log-redact.test.ts tests/integration/csrf.test.ts` GREEN
- Other integration tests (lockout, fresh-session) stay RED until Plan 11 + Plan 16 land
</verification>

<success_criteria>
- Better Auth instance configured with all SEC-01..06 settings
- Permissions matrix is single source of truth (CRIT-3)
- CSRF middleware exists for SEC-02 belt
- log-redact-paths constant ready for Plan 13 to consume
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-05-SUMMARY.md` documenting:
- Better Auth version actually installed (with peer-dep notes if Drizzle range conflicted)
- Confirmation that admin plugin accepted `'technical_director'` as adminRole (A8 verification)
- Note: email hooks are STUBBED — Plan 06 overrides them
</output>
