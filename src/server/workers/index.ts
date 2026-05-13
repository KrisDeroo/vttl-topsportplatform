/**
 * BullMQ worker entrypoint — Coolify runs this as the `worker` service (D-15).
 *
 * Coolify two-service pattern:
 *  - `web`    → `npm run start`                       → Next.js HTTP server
 *  - `worker` → `npm run worker` (= tsx this file)    → BullMQ consumer
 *
 * Both services share the same git repo and env vars. Only the worker needs
 * `REDIS_URL` (BullMQ TCP/TLS), but both services receive it because Coolify
 * does not differentiate per-service env at the moment we deploy.
 *
 * Concurrency + retry policy (D-15 sensible defaults):
 *  - concurrency=5         → process up to 5 jobs in parallel per worker;
 *                            tune after Phase 5/6 produce real metrics.
 *  - attempts=3 (queue)    → 1 immediate + 2 retries (set in queues.ts).
 *  - backoffStrategy       → exponential: 2^n seconds, capped at 30s. After
 *                            attempt 5 the cap is reached so subsequent
 *                            retries fire every 30s instead of doubling
 *                            unbounded (avoids Phase-5 medical-write storms).
 *
 * Graceful shutdown:
 *  - SIGTERM (Coolify deploy signal) + SIGINT (manual Ctrl-C) → close worker
 *    so in-flight jobs complete or are released back to the queue cleanly.
 */
import { Worker } from 'bullmq';
import { connection } from './connection';
import { QUEUES } from './queues';
import { processConsentVersionBump } from './jobs/consent-version-bump';
import { processMalwareScan } from './jobs/malware-scan';
import { log } from '@/lib/log';

const consentWorker = new Worker(
  QUEUES.CONSENT_NOTIFY,
  async (job) => processConsentVersionBump(job.data),
  {
    connection,
    concurrency: 5,
    autorun: true,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        Math.min(Math.pow(2, attemptsMade) * 1000, 30_000),
    },
  },
);

consentWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, queue: QUEUES.CONSENT_NOTIFY, err: err.message },
    'job.failed',
  );
});

consentWorker.on('completed', (job) => {
  log.info({ jobId: job.id, queue: QUEUES.CONSENT_NOTIFY }, 'job.completed');
});

/**
 * Phase 2 (D-21, D-22, VALID-04) — async malware scan worker.
 *
 * concurrency=2 (NOT 5): clamd is largely single-threaded; running 5 parallel
 * scans queues at the daemon and burns worker memory holding 5 file buffers
 * simultaneously. 2 gives headroom without saturation. WARNING-10 in
 * 02-PLAN-CHECK pins this value. Raise after Phase 8 load profile establishes
 * a realistic concurrency budget against the deployed clamd sizing.
 */
const malwareScanWorker = new Worker(
  QUEUES.MALWARE_SCAN,
  async (job) => processMalwareScan(job.data),
  {
    connection,
    concurrency: 2,
    autorun: true,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        Math.min(Math.pow(2, attemptsMade) * 1000, 30_000),
    },
  },
);

malwareScanWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.id, queue: QUEUES.MALWARE_SCAN, err: err.message },
    'job.failed',
  );
});

malwareScanWorker.on('completed', (job) => {
  log.info({ jobId: job.id, queue: QUEUES.MALWARE_SCAN }, 'job.completed');
});

async function shutdown(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  log.info({ signal }, 'worker.shutdown');
  await Promise.all([
    consentWorker.close(),
    malwareScanWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
