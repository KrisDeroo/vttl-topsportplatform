/**
 * tRPC root router (Plan 11) — composition point for every sub-router.
 *
 * Sub-routers attached:
 *   - consent.*        — Plan 12 (give / withdraw / status / listForUser
 *                                  / listMyParentLinks / _enqueueVersionBump)
 *   - admin.user.*     — Plan 15 (TD admin UI for user create/activate/role)
 *   - admin.user.auditLog.* — Plan 15 surface stub (TD audit log viewer
 *                              ships in Phase 7)
 *   - file.*           — Phase 2 (upload / getSignedUrl / getScanStatus / delete)
 *
 * Sub-routers added by later plans:
 *   - player.* / trainer.* — Phase 2 (Plan 02-10; kept separate from this plan
 *                             to bound the blast radius of file.* changes)
 *   - medical.*        — Phase 5 (medical events read/write — `medicalProcedure`)
 *
 * The `ping` procedure is the canonical anonymous health check — it lets the
 * Next.js route handler smoke-test tRPC end-to-end without authentication.
 *
 * Type re-export `AppRouter` is consumed by the typed React client
 * (`src/lib/trpc-client.ts`) to derive the typed call surface (no codegen
 * — pure TypeScript inference).
 */
import { publicProcedure, router } from '../trpc';
import { adminRouter } from './admin';
import { consentRouter } from './consent';
import { fileRouter } from './file';

export const appRouter = router({
  ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  consent: consentRouter,
  admin: adminRouter,
  file: fileRouter, // Phase 2 (Plan 02-09)
});

export type AppRouter = typeof appRouter;
