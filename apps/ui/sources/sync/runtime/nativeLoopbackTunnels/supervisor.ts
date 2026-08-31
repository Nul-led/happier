import { createLoopbackTunnelStore } from './store';
import type {
    LoopbackTunnelAdapter,
    LoopbackTunnelFailureCodes,
    LoopbackTunnelLease,
    LoopbackTunnelLimitation,
    LoopbackTunnelLifecycleEvent,
    LoopbackTunnelNativeEvent,
    LoopbackTunnelProbeResult,
    LoopbackTunnelRequest,
    LoopbackTunnelSupervisor,
    LoopbackTunnelSupervisorOptions,
} from './types';

const DEFAULT_FAILURE_CODES: LoopbackTunnelFailureCodes = {
    suspended: 'loopback_tunnel_suspended',
    probeFailed: 'loopback_tunnel_probe_failed',
    staleGeneration: 'loopback_tunnel_stale_generation',
};

/**
 * Lifecycle-only owner for every native loopback tunnel (SSH, Iroh). Native
 * adapters retain all socket and byte-copy ownership; this owner provides lease
 * keying, in-flight dedupe with reference counts, bounded probes, failed-start
 * diagnostics, degrade/restart, foreground recovery, and scoped release.
 */
export function createLoopbackTunnelSupervisor<
    Request extends LoopbackTunnelRequest,
    Lease extends LoopbackTunnelLease,
    Limitation extends LoopbackTunnelLimitation = LoopbackTunnelLimitation,
    Native = unknown,
>(input: LoopbackTunnelSupervisorOptions<Request, Lease, Limitation, Native>): LoopbackTunnelSupervisor<Request, Lease, Limitation> {
    const store = createLoopbackTunnelStore<Lease, Limitation, Request>({
        foregroundLimitation: input.platformLimitations?.foreground ?? null,
        suspendedLimitation: input.platformLimitations?.suspended ?? null,
    });
    const failureCodes: LoopbackTunnelFailureCodes = {
        suspended: input.failureCodes?.suspended ?? DEFAULT_FAILURE_CODES.suspended,
        probeFailed: input.failureCodes?.probeFailed ?? DEFAULT_FAILURE_CODES.probeFailed,
        staleGeneration: input.failureCodes?.staleGeneration ?? DEFAULT_FAILURE_CODES.staleGeneration,
    };
    const pending = new Map<string, { promise: Promise<Lease>; referenceCount: number }>();
    const nativeSubscriptions = new Map<string, () => void>();
    const listeners = new Set<(event: LoopbackTunnelLifecycleEvent<Lease>) => void>();
    const probeTimeoutMs = input.probeTimeoutMs ?? 15_000;
    const probeTimeoutReason = input.probeTimeoutReason ?? 'probe-timeout';

    function removeNativeSubscription(nativeTunnelId: string | null): void {
        if (!nativeTunnelId) return;
        nativeSubscriptions.get(nativeTunnelId)?.();
        nativeSubscriptions.delete(nativeTunnelId);
    }

    function notifyNativeEvent(key: string, nativeTunnelId: string, event: LoopbackTunnelNativeEvent): void {
        const stored = store.getByKey(key);
        if (!stored || stored.nativeTunnelId !== nativeTunnelId || event.tunnelHandle !== nativeTunnelId) return;
        const nextLease = input.updateLeaseForNativeEvent?.(stored.lease, event) ?? stored.lease;
        const status = event.type === 'ready' || event.type === 'path_changed'
            ? 'ready'
            : event.type === 'degraded'
                ? 'degraded'
                : event.type === 'closed'
                    ? 'stopped'
                    : 'failed';
        const projected = { ...nextLease, status } as Lease;
        store.put(key, { ...stored, lease: projected });
        const lifecycleEvent: LoopbackTunnelLifecycleEvent<Lease> = { ...event, lease: projected };
        for (const listener of listeners) listener(lifecycleEvent);
        if (event.type === 'closed' || event.type === 'error') {
            // Observation is terminal for this native handle. The existing
            // supervisor performs the one teardown; reconnect/retry remains in
            // its established ensure/foreground paths.
            removeNativeSubscription(nativeTunnelId);
            void detachStoppedNativeTunnel(key).catch(() => {
                const current = store.getByKey(key);
                if (current) store.updateStatus(current.lease.leaseId, 'failed');
            });
        }
    }

    function subscribeToNativeEvents(key: string, nativeTunnelId: string): void {
        removeNativeSubscription(nativeTunnelId);
        const unsubscribe = input.adapter.subscribeLoopbackTunnelEvents?.(
            nativeTunnelId,
            (event) => notifyNativeEvent(key, nativeTunnelId, event),
        );
        if (unsubscribe) nativeSubscriptions.set(nativeTunnelId, unsubscribe);
    }

    async function runBoundedProbe(url: string, request: Request): Promise<LoopbackTunnelProbeResult> {
        let timeout: ReturnType<typeof setTimeout> | null = null;
        try {
            return await Promise.race([
                input.probe(url, request),
                new Promise<LoopbackTunnelProbeResult>((resolve) => {
                    timeout = setTimeout(() => resolve({ ok: false, reason: probeTimeoutReason }), probeTimeoutMs);
                }),
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    /** Marks a stale ready lease degraded, stops its native tunnel, and keeps the entry for replacement. */
    async function degradeStoredLease(key: string): Promise<void> {
        const stale = store.getByKey(key);
        if (!stale) return;
        store.updateStatus(stale.lease.leaseId, 'degraded');
        if (stale.nativeTunnelId) {
            removeNativeSubscription(stale.nativeTunnelId);
            await input.adapter.stopLoopbackTunnel(stale.nativeTunnelId);
            const degraded = store.getByKey(key);
            if (degraded) store.put(key, { ...degraded, nativeTunnelId: null });
        }
    }

    /** Stops a stored native tunnel and detaches it while preserving the lease entry. */
    async function detachStoppedNativeTunnel(key: string): Promise<void> {
        const stale = store.getByKey(key);
        if (!stale?.nativeTunnelId) return;
        removeNativeSubscription(stale.nativeTunnelId);
        await input.adapter.stopLoopbackTunnel(stale.nativeTunnelId);
        const current = store.getByKey(key);
        if (current?.nativeTunnelId === stale.nativeTunnelId) {
            store.put(key, { ...current, nativeTunnelId: null });
        }
    }

    return {
        async ensureTunnel(request) {
            if (store.isSuspended()) throw new Error(failureCodes.suspended);
            const key = input.buildKey(request);
            const inFlight = pending.get(key);
            if (inFlight) {
                inFlight.referenceCount += 1;
                return await inFlight.promise;
            }

            const generation = input.getGeneration?.();
            const startPromise = (async () => {
                const existing = store.getByKey(key);
                let retainedReferenceCount = 0;
                if (existing?.lease.status === 'ready' && existing.lease.localUrl) {
                    const existingProbe = await runBoundedProbe(existing.lease.localUrl, request);
                    if (existingProbe.ok) {
                        // A retained lease deliberately ignores verification-only
                        // facts in its key. Once the newest request verifies, it
                        // becomes the request used for later foreground probes.
                        // Keeping the original request here would resurrect an
                        // expired token after suspend/resume.
                        store.put(key, { ...existing, request });
                        let retained = store.getByKey(key) ?? existing;
                        const referencesToRetain = pending.get(key)?.referenceCount ?? 1;
                        for (let index = 0; index < referencesToRetain; index += 1) {
                            retained = store.retain(key) ?? retained;
                        }
                        return retained.lease;
                    }
                    retainedReferenceCount = existing.referenceCount;
                    await degradeStoredLease(key);
                }
                const stoppedExisting = store.getByKey(key);
                if (stoppedExisting && stoppedExisting.lease.status !== 'ready') {
                    retainedReferenceCount = Math.max(retainedReferenceCount, stoppedExisting.referenceCount);
                    await detachStoppedNativeTunnel(key);
                }

                let started: Awaited<ReturnType<LoopbackTunnelAdapter<Request, Native>['startLoopbackTunnel']>>;
                try {
                    started = await input.adapter.startLoopbackTunnel(request);
                } catch (error) {
                    const limitation = input.limitationForStartError?.(error) ?? null;
                    if (limitation) store.setRuntimeLimitation(limitation);
                    throw error;
                }
                const localUrl = `http://127.0.0.1:${started.localPort}`;
                const lease = input.createLease({
                    key,
                    request,
                    localPort: started.localPort,
                    ...(generation === undefined ? {} : { generation }),
                    ...(started.native === undefined ? {} : { native: started.native }),
                });
                // Probe the exact origin the lease publishes (carriers may report
                // their own loopback origin, e.g. the native Iroh lease origin).
                const probeResult = await runBoundedProbe(lease.localUrl ?? localUrl, request);
                if (!probeResult.ok) {
                    const limitation = input.limitationForProbeFailure?.(probeResult.reason) ?? null;
                    if (limitation) store.setRuntimeLimitation(limitation);
                    // Keep failed-lease bookkeeping (with the native id) so a cleanup stop that
                    // fails can be retried through releaseTunnel instead of leaking the tunnel.
                    const failedLease = { ...lease, status: 'failed' } as Lease;
                    store.put(key, {
                        lease: failedLease,
                        nativeTunnelId: started.nativeTunnelId,
                        referenceCount: retainedReferenceCount + (pending.get(key)?.referenceCount ?? 1),
                        request,
                    });
                    try {
                        await input.adapter.stopLoopbackTunnel(started.nativeTunnelId);
                        store.deleteByKey(key);
                    } catch (error) {
                        store.updateStatus(failedLease.leaseId, 'failed');
                        throw error;
                    }
                    throw new Error(`${failureCodes.probeFailed}:${probeResult.reason}`);
                }
                if (generation !== undefined && input.getGeneration?.() !== generation) {
                    await input.adapter.stopLoopbackTunnel(started.nativeTunnelId);
                    throw new Error(failureCodes.staleGeneration);
                }
                // A verified healthy lease invalidates stale failure diagnostics.
                store.clearRuntimeLimitations();
                store.put(key, {
                    lease,
                    nativeTunnelId: started.nativeTunnelId,
                    referenceCount: retainedReferenceCount + (pending.get(key)?.referenceCount ?? 1),
                    request,
                });
                subscribeToNativeEvents(key, started.nativeTunnelId);
                return lease;
            })();

            pending.set(key, { promise: startPromise, referenceCount: 1 });
            try {
                return await startPromise;
            } finally {
                pending.delete(key);
            }
        },
        listTunnels: () => store.snapshot(),
        async releaseTunnel(leaseId) {
            const release = store.releaseByLeaseId(leaseId);
            if (!release?.released) return;
            if (release.stored.nativeTunnelId) {
                try {
                    removeNativeSubscription(release.stored.nativeTunnelId);
                    await input.adapter.stopLoopbackTunnel(release.stored.nativeTunnelId);
                    store.removeReleasedLease(leaseId);
                } catch (error) {
                    store.updateStatus(leaseId, 'failed');
                    throw error;
                }
                return;
            }
            store.removeReleasedLease(leaseId);
        },
        markSuspended() {
            store.markSuspended();
            // The existing app-lifecycle owner suspends observation together
            // with lease publication. Native transports may remain allocated,
            // but no polling/timer stays active in the background.
            for (const nativeTunnelId of [...nativeSubscriptions.keys()]) {
                removeNativeSubscription(nativeTunnelId);
            }
        },
        async markForeground() {
            store.markForeground();
            for (const lease of store.snapshot().leases) {
                const stored = store.getByKey(lease.key);
                if (!stored || !stored.lease.localUrl) continue;
                const result = await runBoundedProbe(stored.lease.localUrl, stored.request);
                if (result.ok) {
                    store.updateStatus(stored.lease.leaseId, 'ready');
                    store.clearRuntimeLimitations();
                    if (stored.nativeTunnelId) subscribeToNativeEvents(lease.key, stored.nativeTunnelId);
                    continue;
                }
                const limitation = input.limitationForProbeFailure?.(result.reason) ?? null;
                if (limitation) store.setRuntimeLimitation(limitation);
                store.updateStatus(stored.lease.leaseId, 'failed');
                await detachStoppedNativeTunnel(lease.key);
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
