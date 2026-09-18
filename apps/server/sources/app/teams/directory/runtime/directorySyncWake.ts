type Nudge = () => void;

let activeNudge: Nudge | null = null;

/**
 * Registers the one in-process wake owned by the running directory worker.
 * Durable `manualSyncRequestedAt` remains the source of truth when the worker
 * lives in another process; this callback only shortens local poll latency.
 */
export function registerEnterpriseIdentitySyncNudge(nudge: Nudge): () => void {
    activeNudge = nudge;
    return () => {
        if (activeNudge === nudge) activeNudge = null;
    };
}

export function requestEnterpriseIdentitySyncNudge(): void {
    activeNudge?.();
}
