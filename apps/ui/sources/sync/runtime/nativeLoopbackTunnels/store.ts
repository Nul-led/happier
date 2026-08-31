import type {
    LoopbackTunnelLease,
    LoopbackTunnelLimitation,
    LoopbackTunnelRequest,
    LoopbackTunnelSnapshot,
    LoopbackTunnelStatus,
} from './types';

export type StoredLoopbackTunnel<
    Lease extends LoopbackTunnelLease,
    Limitation extends LoopbackTunnelLimitation,
    Request extends LoopbackTunnelRequest = LoopbackTunnelRequest,
> = Readonly<{
    lease: Lease;
    nativeTunnelId: string | null;
    referenceCount: number;
    /** Request retained so foreground re-probes can re-verify with the original facts. */
    request: Request;
}>;

export function createLoopbackTunnelStore<
    Lease extends LoopbackTunnelLease,
    Limitation extends LoopbackTunnelLimitation,
    Request extends LoopbackTunnelRequest = LoopbackTunnelRequest,
>(params: Readonly<{ foregroundLimitation?: Limitation | null; suspendedLimitation?: Limitation | null }>) {
    const leasesByKey = new Map<string, StoredLoopbackTunnel<Lease, Limitation, Request>>();
    const runtimeLimitationsByReason = new Map<string, Limitation>();
    let suspended = false;
    return {
        getByKey(key: string) {
            return leasesByKey.get(key) ?? null;
        },
        put(key: string, stored: StoredLoopbackTunnel<Lease, Limitation, Request>): void {
            leasesByKey.set(key, stored);
        },
        retain(key: string) {
            const stored = leasesByKey.get(key);
            if (!stored) return null;
            const next = { ...stored, referenceCount: stored.referenceCount + 1 };
            leasesByKey.set(key, next);
            return next;
        },
        deleteByKey(key: string) {
            const stored = leasesByKey.get(key) ?? null;
            leasesByKey.delete(key);
            return stored;
        },
        releaseByLeaseId(leaseId: string) {
            for (const [key, stored] of leasesByKey) {
                if (stored.lease.leaseId !== leaseId) continue;
                if (stored.referenceCount > 1) {
                    leasesByKey.set(key, { ...stored, referenceCount: stored.referenceCount - 1 });
                    return { stored, released: false as const };
                }
                return { stored, released: true as const };
            }
            return null;
        },
        removeReleasedLease(leaseId: string): void {
            for (const [key, stored] of leasesByKey) {
                if (stored.lease.leaseId === leaseId) leasesByKey.delete(key);
            }
        },
        updateStatus(leaseId: string, status: LoopbackTunnelStatus): void {
            for (const [key, stored] of leasesByKey) {
                if (stored.lease.leaseId === leaseId) leasesByKey.set(key, { ...stored, lease: { ...stored.lease, status } as Lease });
            }
        },
        markSuspended(): void {
            suspended = true;
            for (const [key, stored] of leasesByKey) leasesByKey.set(key, { ...stored, lease: { ...stored.lease, status: 'degraded' } as Lease });
        },
        markForeground(): void { suspended = false; },
        isSuspended(): boolean { return suspended; },
        setRuntimeLimitation(limitation: Limitation): void { runtimeLimitationsByReason.set(limitation.reason, limitation); },
        clearRuntimeLimitation(reason: string): void { runtimeLimitationsByReason.delete(reason); },
        clearRuntimeLimitations(): void { runtimeLimitationsByReason.clear(); },
        snapshot(): LoopbackTunnelSnapshot<Lease, Limitation> {
            return {
                leases: [...leasesByKey.values()].map((stored) => stored.lease),
                platformLimitations: [
                    ...(params.foregroundLimitation ? [params.foregroundLimitation] : []),
                    ...(suspended && params.suspendedLimitation ? [params.suspendedLimitation] : []),
                    ...runtimeLimitationsByReason.values(),
                ],
            };
        },
    };
}
