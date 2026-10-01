import { acquireGlobalLock } from '@/storage/globalLock';

const RETENTION_SWEEP_LOCK_KEY = 'server.retention.sweep';

/**
 * The one lock that serializes retention sweeps across replicas: the worker's scheduled sweeps and
 * the console's dry run (plan §3.6) both take it, so they never run at once.
 */
export async function acquireRetentionSweepLock(params: {
    ttlMs: number;
    now?: Date;
}): Promise<{ release: () => Promise<void> } | null> {
    return acquireGlobalLock({
        key: RETENTION_SWEEP_LOCK_KEY,
        ttlMs: params.ttlMs,
        now: params.now,
    });
}
