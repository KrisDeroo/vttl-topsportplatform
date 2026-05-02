/**
 * Better Auth React client (browser-side).
 *
 * Imported by client components — never by Server Components or tRPC routers
 * (those import the server `auth` instance from `./auth`). The base URL is
 * resolved lazily from `window.location.origin` so the same bundle works in
 * dev (localhost), staging, and production without rebuilds.
 *
 * Plugins mirror the server config:
 *   - adminClient: enables `authClient.admin.*` calls (createUser, listUsers,
 *     setRole, etc.) for the technical_director admin UI (Plan 15).
 *
 * Public hooks re-exported here are the only API surface the rest of the app
 * uses — components must import `signIn` / `signOut` / `useSession` from this
 * file, never reach into `better-auth/react` directly.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Better Auth Integration
 */
import { createAuthClient } from 'better-auth/react';
import { adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  plugins: [adminClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
