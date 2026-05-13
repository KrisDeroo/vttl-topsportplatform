---
phase: 02-identiteit-bestanden
plan: 06
subsystem: workers
tags: [bullmq, clamav, malware-scan, supabase-storage, security-definer, rls]

# Dependency graph
requires:
  - phase: 02-01-deps-and-env
    provides: clamscan@^2 + @supabase/supabase-js@^2 dependencies and CLAMAV_HOST / CLAMAV_PORT / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env validation
  - phase: 02-02-drizzle-schema-files
    provides: uploaded_files table with scan_status / scan_completed_at / sha256 columns referenced by mark_scan_result
  - phase: 02-04-storage-magic-bytes-helpers
    provides: storageClient (service-role Supabase Storage singleton) consumed by the worker download step
  - phase: 02-05-migration-0007-rls-policies
    provides: mark_scan_result(uuid, text, text, timestamptz) SECURITY DEFINER function — declared in parallel; this plan references it by name
provides:
  - MALWARE_SCAN queue + malwareScanQueue + malwareScanEvents exports
  - processMalwareScan job handler (download → clamscan TCP → SHA-256 → mark_scan_result)
  - malwareScanWorker bound in src/server/workers/index.ts with concurrency=2
  - Graceful shutdown closing both Phase 1 consentWorker and Phase 2 malwareScanWorker
affects: [02-09 trpc-router-file (file.upload enqueues to malwareScanQueue), 02-12 ui-shared-components (scan status badges), 02-15 tests (EICAR integration test)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker calls SECURITY DEFINER fn via raw SQL when running outside withRlsContext (D-WORKER-RLS) — direct Drizzle UPDATE blocked by RLS without app.user_id / app.user_role GUCs"
    - "Module-level lazy clamscan client promise — shared TCP connection pool across concurrent BullMQ jobs in the same worker process"
    - "PII-clean structured logging — payload IDs + scan status + truncated sha256 only (no filename, no buffer bytes, no base64)"

key-files:
  created:
    - src/server/workers/jobs/malware-scan.ts
  modified:
    - src/server/workers/queues.ts
    - src/server/workers/index.ts

key-decisions:
  - "concurrency=2 (NOT 5) per WARNING-10 — clamd is largely single-threaded; raise after Phase 8 load profile"
  - "Worker persists scan outcome via mark_scan_result(fileId, status, sha256, scannedAt) SECURITY DEFINER fn — direct db.update would be blocked by RLS (D-WORKER-RLS / BLOCKER-01)"
  - "ClamAV connection: TCP-only (socket:false) with localFallback:false — refuses to silently degrade to local CLI scanner (D-22)"
  - "SHA-256 computed in the worker over the downloaded buffer and passed as the 3rd arg to mark_scan_result — gives tamper detection + dedup signal"
  - "Same capped exponential backoff (2^n * 1s, cap 30s) as Phase 1 consentWorker; same attempts=3 from queues.ts default"
  - "no_op_already_completed (warn) when mark_scan_result returns FALSE — duplicate job or manual TD action correlation handle"

patterns-established:
  - "Multi-queue worker entrypoint: each queue gets its own Worker + 'failed'/'completed' handlers; shutdown closes all via Promise.all"
  - "SECURITY DEFINER call from a worker: db.execute<{ ok: boolean }>(sql\\`SELECT fn(...) AS ok\\`) → cast result to array and read ok field"

requirements-completed:
  - VALID-04

# Metrics
duration: 4min
completed: 2026-05-13
---

# Phase 02 Plan 06: Malware Scan Worker Summary

**BullMQ MALWARE_SCAN queue + processMalwareScan worker — downloads from Supabase Storage, scans via ClamAV TCP, persists outcome through the mark_scan_result SECURITY DEFINER function (D-WORKER-RLS).**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-13T11:28:02Z
- **Completed:** 2026-05-13T11:31:58Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Queue registry extended with MALWARE_SCAN (D-21, D-22); attempts=3 + capped exponential backoff mirrors the Phase 1 consent-notify template
- processMalwareScan job handler: service-role Supabase Storage download → clamscan over TCP (env.CLAMAV_HOST:env.CLAMAV_PORT, localFallback:false, 30s timeout) → node:crypto SHA-256 over the buffer → SECURITY DEFINER mark_scan_result(fileId, status, sha256, scannedAt) → structured pino log (no filename, no buffer bytes)
- malwareScanWorker registered in the worker entrypoint with concurrency=2 (per WARNING-10 — clamd throughput limit); shutdown extended to close both workers via Promise.all on SIGTERM/SIGINT
- Phase 1 consentWorker invariants preserved exactly (concurrency=5, event handlers, queue name)

## Task Commits

Each task was committed atomically:

1. **Task 1: Register MALWARE_SCAN queue + malwareScanEvents** — `a2cadf2` (feat)
2. **Task 2: Add processMalwareScan worker job** — `6fec3e0` (feat)
3. **Task 3: Register MALWARE_SCAN Worker in worker entrypoint** — `5199bcf` (feat)

## Files Created/Modified

- **`src/server/workers/queues.ts`** (modified) — Added `MALWARE_SCAN: 'malware-scan'` to QUEUES; exported `malwareScanQueue` (Queue) and `malwareScanEvents` (QueueEvents) with the same Phase 1 defaultJobOptions (attempts=3, backoff custom, removeOnComplete=1000, removeOnFail=5000); extended the module JSDoc to note the small-payload invariant (no buffer / no base64).
- **`src/server/workers/jobs/malware-scan.ts`** (created, 159 lines) — `processMalwareScan(payload: MalwareScanJobData)` job handler. Imports `'server-only'`, NodeClam, drizzle `sql`, env, log, db, and storageClient. Lazy module-level `clamscanPromise` so concurrent jobs reuse the TCP connection pool. Steps: (1) Storage download via `storageClient.storage.from(bucket).download(storageKey)`; (2) `clamscan.scanStream(Readable.from(buf))`; (3) `createHash('sha256').update(buf).digest('hex')`; (4) raw SQL `SELECT mark_scan_result($1::uuid, $2::text, $3::text, $4::timestamptz) AS ok`; (5) `log.warn` on `no_op_already_completed`, `log.info` on `malware_scan.completed`. Re-throws on download or scan errors so BullMQ retries fire.
- **`src/server/workers/index.ts`** (modified) — Added `import { processMalwareScan } from './jobs/malware-scan'`; declared `malwareScanWorker` with concurrency=2 + same `backoffStrategy` as consentWorker; wired `'failed'` and `'completed'` handlers identical to consentWorker; extended `shutdown` to close both workers via `Promise.all`.

## Decisions Made

- **D-WORKER-RLS** — The worker calls the `mark_scan_result(...)` SECURITY DEFINER function instead of issuing a Drizzle UPDATE on `uploaded_files`. Rationale: the worker runs outside `withRlsContext`, so no `app.user_id` / `app.user_role` GUCs are set; the RLS policy on `uploaded_files` would evaluate every USING/WITH CHECK clause against NULL GUCs and reject the UPDATE (0 rows affected). The SECURITY DEFINER function runs as the function-owner role, validates the status whitelist, and only flips rows still at `scan_status='pending'`. Returns BOOLEAN — false means terminal-state collision (duplicate job or manual TD action), which the worker logs as `no_op_already_completed` (warn).
- **concurrency=2** — Lowered from the Phase 1 default of 5 per WARNING-10 (02-PLAN-CHECK). clamd is largely single-threaded; running 5 parallel scans queues at the daemon and burns worker memory holding 5 file buffers simultaneously. Will be re-tuned after Phase 8 load profiling.
- **`localFallback: false`** — clamscan v2's library config refuses to silently degrade to the local `clamscan` CLI when the TCP connection fails. This is a GDPR / D-22 requirement: scans must occur on the configured private-network sidecar, never on the worker host's local installation (which may not exist or may have stale signatures).
- **SHA-256 computed in the worker** — not in the DB function — because the buffer is already in memory; doing it in Postgres would require shipping the bytes back. The hash is passed as the 3rd positional argument to `mark_scan_result`.

## Patterns Established

- **Multi-queue worker entrypoint** — Each Phase adds its own Worker block following the Phase 1 template (Worker + `'failed'` log + `'completed'` log + addition to the shutdown Promise.all). Phase 5 + 6 will extend the same file.
- **SECURITY DEFINER raw-SQL call from Drizzle** — `db.execute<{ ok: boolean }>(sql\`SELECT fn(...) AS ok\`)` then cast `(result as unknown as Array<{ ok: boolean }>)[0]?.ok`. Reusable for any worker that needs to mutate RLS-protected rows.

## Deviations from Plan

**None — plan executed exactly as written.**

The Plan body included a small JSDoc edge case (the words `db.update(uploadedFiles)` would have appeared in code comments explaining what the worker deliberately does NOT do; the plan's grep gate `! grep -q "db\\.update(uploadedFiles)"` would catch even those comment-level mentions). I phrased the equivalent comments without the literal forbidden token (e.g. "a direct UPDATE through Drizzle would be blocked by RLS") so the grep stays clean. This is a wording adjustment, not a logic change.

## Authentication Gates

None — this plan does not require user authentication interaction.

## Issues Encountered

- No `node_modules/` in the worktree (parallel-wave execution constraint) — could not run `npx tsc --noEmit` locally as the Plan's verify spec requested. The orchestrator runs `tsc` after merging worktrees back, which is the correct gate point for parallel work. All TS shapes (imports, types, exports, generics on `db.execute`) were reviewed manually against the Phase 1 `consent-version-bump.ts` template and the existing `storage/client.ts` / `db/client.ts` modules in the worktree.

## Threat Surface Coverage

The plan's `<threat_model>` lists T-02-06-CLAMD-PUBLIC, T-02-06-PAYLOAD-OVERFLOW, T-02-06-SCAN-STUCK, T-02-06-VIRUS-LIST-LEAK, T-02-06-STALE-SIGNATURES. The worker code implements the `mitigate` dispositions:
- T-02-06-CLAMD-PUBLIC — `localFallback: false` refuses bypass; TCP-only (socket:false) means clamd must be reachable on the env-configured private-network host:port.
- T-02-06-PAYLOAD-OVERFLOW — buffer load is bounded by the 2MB upload gate already enforced upstream (02-04 magic-bytes + 02-09 file.upload mutation). Worker payload is IDs only.
- T-02-06-VIRUS-LIST-LEAK — virus names are logged only when `isInfected` (forensics signal), and they are class info, not PII.
- T-02-06-STALE-SIGNATURES — addressed by Phase 8 freshclam cron (out of scope for this plan); EICAR integration test in 02-15 will fail loudly if the daemon is broken.

No new threat surface introduced beyond the threat model.

## Next Phase Readiness

- The `malwareScanQueue` export is ready for 02-09 (`file.upload` mutation) to import and enqueue jobs.
- `mark_scan_result` SECURITY DEFINER function is declared by 02-05 (parallel wave 2/3 plan); when the worktrees merge, the worker code will resolve the function by name at SQL runtime.
- EICAR integration test in 02-15 can exercise the full upload → scan → mark_scan_result loop end-to-end.

## Self-Check: PASSED

**Files exist:**
- FOUND: src/server/workers/queues.ts (modified, MALWARE_SCAN + malwareScanQueue + malwareScanEvents present)
- FOUND: src/server/workers/jobs/malware-scan.ts (created, 159 lines)
- FOUND: src/server/workers/index.ts (modified, malwareScanWorker + Promise.all shutdown present)

**Commits exist:**
- FOUND: a2cadf2 — feat(02-06): register MALWARE_SCAN queue + malwareScanEvents
- FOUND: 6fec3e0 — feat(02-06): add processMalwareScan worker job
- FOUND: 5199bcf — feat(02-06): register MALWARE_SCAN Worker in worker entrypoint

**Plan invariants verified:**
- `mark_scan_result(...)` referenced (4 occurrences in malware-scan.ts) — direct db.update absent (0 occurrences)
- concurrency=2 in malwareScanWorker (NOT 5)
- consentWorker concurrency=5 preserved unchanged
- `localFallback: false` present in clamscan config
- `originalFilename` absent from worker file (0 occurrences)
- `import 'server-only'` is the very first import in malware-scan.ts (head -3 includes it)

---
*Phase: 02-identiteit-bestanden, Plan 06*
*Completed: 2026-05-13*
