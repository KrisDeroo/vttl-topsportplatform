/**
 * RED stub — appCaller is provided by Plan 11 (CallerContext + tRPC middleware).
 *
 * Until Plan 11 lands, calling appCaller(...) at runtime throws and the dependent
 * tests (tests/integration/rbac-matrix.test.ts) are RED. This stub exists only so
 * Vitest can collect and parse the test files without "cannot find module" errors.
 *
 * Once Plan 11 is implemented, replace this file with a real factory that returns a
 * tRPC caller bound to a CallerContext built from the given userId + role.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const appCaller: any = (..._args: unknown[]) => {
  throw new Error('appCaller not implemented yet — Plan 11 (CallerContext + tRPC middleware)');
};
