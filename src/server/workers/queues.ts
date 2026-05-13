/**
 * BullMQ queue registry — single source of truth for queue names (T-01-JOB-INJECTION mitigation).
 *
 * Queue names are enumerated as a const so request handlers cannot enqueue
 * arbitrary string-named jobs. Phase 5 (medical-read-audit) and Phase 6
 * (group-message fan-out) extend QUEUES with their own entries; Phase 1
 * provides only the consent-notify primitive. Phase 2 adds MALWARE_SCAN
 * (D-21, D-22) for async ClamAV scans of every uploaded file.
 *
 * Default job options:
 *  - attempts=3             → 1 immediate try + 2 retries
 *  - backoff.type='custom'  → workers/index.ts supplies the capped exponential
 *                             backoff strategy via Worker `settings.backoffStrategy`
 *  - removeOnComplete=1000  → keep last 1000 successful jobs for observability
 *  - removeOnFail=5000      → retain failed jobs longer for diagnosis (BullMQ docs)
 *  - MALWARE_SCAN payload: { fileId, storageKey, bucket } — small, ASCII,
 *    safe to retain. NEVER include file bytes or base64 in payload (BullMQ
 *    Redis backing would balloon).
 */
import { Queue, QueueEvents } from 'bullmq';
import { connection } from './connection';

export const QUEUES = {
  CONSENT_NOTIFY: 'consent-notify',
  MALWARE_SCAN: 'malware-scan', // Phase 2 (D-21 + D-22)
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const consentNotifyQueue = new Queue(QUEUES.CONSENT_NOTIFY, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'custom' },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const consentNotifyEvents = new QueueEvents(QUEUES.CONSENT_NOTIFY, { connection });

/**
 * Phase 2 (D-21): async file malware scan via ClamAV daemon (D-22).
 *
 * Job payload: { fileId: string, storageKey: string, bucket: string }
 * Producer:    src/server/trpc/routers/file.ts (file.upload mutation — Plan 02-09)
 * Consumer:    src/server/workers/jobs/malware-scan.ts → processMalwareScan
 *
 * Retry: 3 attempts with capped exponential backoff (Phase 1 default from
 * src/server/workers/index.ts settings.backoffStrategy). After 3 failures
 * the job lands in removeOnFail retain bucket for diagnosis; the
 * uploaded_files row stays at scan_status='pending' (cron cleanup or
 * manual TD action handles persistently-stuck files — deferred to Phase 8).
 */
export const malwareScanQueue = new Queue(QUEUES.MALWARE_SCAN, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'custom' },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const malwareScanEvents = new QueueEvents(QUEUES.MALWARE_SCAN, { connection });
