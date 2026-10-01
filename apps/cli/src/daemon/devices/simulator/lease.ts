import type { MachineLiveStreamControlLeaseV1 } from '@happier-dev/protocol';

export type SimulatorInputLeaseManager = Readonly<{
    acquire: (input: Readonly<{
        streamId: string;
        sourceId: string;
        holderId: string;
        nowMs: number;
    }>) => Readonly<{ ok: true; lease: MachineLiveStreamControlLeaseV1 } | { ok: false; reasonCode: 'lease_already_held' }>;
    release: (input: Readonly<{
        streamId: string;
        sourceId: string;
        leaseId: string;
    }>) => Readonly<{ ok: true } | { ok: false; reasonCode: 'input_lease_mismatch' }>;
    read: (input: Readonly<{ streamId: string; sourceId: string; nowMs: number }>) => MachineLiveStreamControlLeaseV1 | null;
}>;

export function createSimulatorInputLeaseManager(input: Readonly<{ ttlMs: number }>): SimulatorInputLeaseManager {
    const leasesBySource = new Map<string, MachineLiveStreamControlLeaseV1>();
    const ttlMs = Math.max(1, Math.floor(input.ttlMs));

    // Viewer streams share physical input. The source owns exclusivity; the
    // stream and holder identify the one controller allowed to renew or release.
    const readActive = (sourceId: string, nowMs: number): MachineLiveStreamControlLeaseV1 | null => {
        const existing = leasesBySource.get(sourceId) ?? null;
        if (!existing) return null;
        if (existing.expiresAtMs <= nowMs) {
            leasesBySource.delete(sourceId);
            return null;
        }
        return existing;
    };

    return {
        acquire: (request) => {
            const existing = readActive(request.sourceId, request.nowMs);
            if (existing && (existing.streamId !== request.streamId || existing.holderId !== request.holderId)) {
                return { ok: false, reasonCode: 'lease_already_held' };
            }
            const lease: MachineLiveStreamControlLeaseV1 = {
                v: 1,
                leaseId: `${request.streamId}:${request.sourceId}:${request.holderId}:${request.nowMs}`,
                streamId: request.streamId,
                sourceId: request.sourceId,
                holderId: request.holderId,
                mode: 'exclusive',
                acquiredAtMs: request.nowMs,
                expiresAtMs: request.nowMs + ttlMs,
            };
            leasesBySource.set(request.sourceId, lease);
            return { ok: true, lease };
        },
        release: (request) => {
            const existing = leasesBySource.get(request.sourceId);
            if (!existing || existing.streamId !== request.streamId || existing.leaseId !== request.leaseId) {
                return { ok: false, reasonCode: 'input_lease_mismatch' };
            }
            leasesBySource.delete(request.sourceId);
            return { ok: true };
        },
        read: (request) => {
            const existing = readActive(request.sourceId, request.nowMs);
            return existing?.streamId === request.streamId ? existing : null;
        },
    };
}
