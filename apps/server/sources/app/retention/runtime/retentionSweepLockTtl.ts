import type { RetentionPolicy } from '@/app/retention/config/retentionPolicyTypes';

const RETENTION_SWEEP_LOCK_TTL_FLOOR_MS = 30 * 60 * 1000;

/**
 * How long a sweep (the worker's or a console dry run) may hold the retention sweep lock before
 * another replica may take it: the sweep interval, and at least 30 minutes.
 */
export function retentionSweepLockTtlMs(policy: Pick<RetentionPolicy, 'intervalMs'>): number {
    return Math.max(RETENTION_SWEEP_LOCK_TTL_FLOOR_MS, policy.intervalMs);
}
