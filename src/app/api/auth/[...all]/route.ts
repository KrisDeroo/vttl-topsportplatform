/**
 * Better Auth catch-all Next.js route handler.
 *
 * Mounts every Better Auth endpoint under `/api/auth/*`:
 *   - /api/auth/sign-up/email
 *   - /api/auth/sign-in/email
 *   - /api/auth/sign-out
 *   - /api/auth/forget-password
 *   - /api/auth/reset-password
 *   - /api/auth/verify-email
 *   - /api/auth/get-session
 *   - /api/auth/admin/* (from the admin plugin — AUTH-04/05)
 *
 * The handler delegates everything to `auth.handler` (a Web `Request -> Response`
 * function). Better Auth applies its own CSRF / SameSite / rate-limit checks
 * before any DB write — see `src/server/auth/auth.ts` for the locked config.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Better Auth Integration
 */
import { auth } from '@/server/auth/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth.handler);
