/**
 * BullMQ queue registry — single source of truth for queue names (T-01-JOB-INJECTION mitigation).
 *
 * Queue names are enumerated as a const so request handlers cannot enqueue
 * arbitrary string-named jobs. Phase 5 (medical-read-audit) and Phase 6
 * (group-message fan-out) extend QUEUES with their own entries; Phase 1
 * provides only the consent-notify primitive.
 *
 * Default job options:
 *  - attempts=3             → 1 immediate try + 2 retries
 *  - backoff.type='custom'  → workers/index.ts supplies the capped exponential
 *                             backoff strategy via Worker `settings.backoffStrategy`
 *  - removeOnComplete=1000  → keep last 1000 successful jobs for observability
 *  - removeOnFail=5000      → retain failed jobs longer for diagnosis (BullMQ docs)
 */
import { Queue, QueueEvents } from 'bullmq';
import { connection } from './connection';

export const QUEUES = {
  CONSENT_NOTIFY: 'consent-notify',
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
