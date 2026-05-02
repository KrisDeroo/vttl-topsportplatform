/**
 * tRPC root router (Plan 11) — composition point for every sub-router.
 *
 * Sub-routers (added by later plans) attach here:
 *   - admin.user.*     — Plan 15 (TD admin UI for user create/activate/role)
 *   - admin.auditLog.* — Plan 15 (TD audit log viewer)
 *   - consent.*        — Plan 12 (give / withdraw / list consent)
 *   - medical.*        — Phase 5 (medical events read/write — `medicalProcedure`)
 *
 * The `ping` procedure is the canonical anonymous health check — it lets the
 * Next.js route handler smoke-test tRPC end-to-end without authentication.
 *
 * Type re-export `AppRouter` is consumed by the client builder in Plan 17 to
 * derive the typed call surface (no codegen — pure TypeScript inference).
 */
import { publicProcedure, router } from '../trpc';

export const appRouter = router({
  ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
});

export type AppRouter = typeof appRouter;
