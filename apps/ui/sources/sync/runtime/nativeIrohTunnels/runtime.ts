import type { IrohRelayPolicy } from '@happier-dev/iroh-native';

import {
    captureActiveServerRuntimeTarget,
    publishActiveServerRuntimeOrigin,
    releaseActiveServerRuntimeOrigin,
    type ActiveServerRuntimeTarget,
} from '@/sync/domains/server/serverProfiles';

import { IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR, IROH_HOME_TUNNEL_STALE_FOCUS_ERROR } from './fallback';
import { createIrohHomeTunnelSupervisor, type IrohHomeTunnelSupervisor, type IrohNativeLifecycleModule } from './supervisor';
import type {
    IrohHomeTunnelAcquireInput,
    IrohHomeTunnelRequest,
    IrohHomeRuntimeOriginLease,
    IrohHomeTunnelRuntime,
} from './types';

export const DEFAULT_IROH_RELAY_POLICY: IrohRelayPolicy = 'automatic';

type PublishedIrohHomeLease = Readonly<{
    target: ActiveServerRuntimeTarget;
    policy: IrohRelayPolicy;
    release: () => Promise<void>;
}>;

function resolveEffectiveRelayPolicy(input: IrohHomeTunnelAcquireInput): IrohRelayPolicy {
    const requestedPolicy = input.policy ?? DEFAULT_IROH_RELAY_POLICY;
    return requestedPolicy === 'automatic' && (input.endpoint.relayUrls?.length ?? 0) > 0
        ? 'automatic'
        : 'disabled';
}

/**
 * UI lifecycle runtime for the native Iroh Home tunnel. Acquires/releases the
 * native lease through the shared loopback supervisor, publishes the runtime
 * origin only after the full verification chain succeeds, and keeps every
 * publication target-scoped so a stale lifecycle event can never clear or
 * overwrite another Home's origin.
 */
export function createIrohHomeTunnelRuntime(params: Readonly<{
    native?: IrohNativeLifecycleModule | null;
    createSupervisor?: () => IrohHomeTunnelSupervisor;
}> = {}): IrohHomeTunnelRuntime {
    const supervisor = params.createSupervisor?.() ?? createIrohHomeTunnelSupervisor({ native: params.native });
    const publicationsByLeaseId = new Map<string, PublishedIrohHomeLease>();

    // Native events carry transport facts only. This UI owner attaches the
    // existing Home/active-generation publication target and is the sole
    // place where a carrier event can affect runtimeOrigin.
    let unsubscribeLifecycle = supervisor.subscribe((event) => {
        const published = publicationsByLeaseId.get(event.lease.leaseId);
        if (!published) return;
        if ((event.type === 'ready' || event.type === 'path_changed') && event.lease.localUrl) {
            publishActiveServerRuntimeOrigin({
                target: published.target,
                leaseId: event.lease.leaseId,
                runtimeOrigin: event.lease.localUrl,
                carrier: 'iroh',
                irohObservedPath: event.lease.observedPath,
                irohRelayPolicy: published.policy,
            });
            return;
        }
        if (event.type === 'degraded' || event.type === 'closed' || event.type === 'error') {
            releaseActiveServerRuntimeOrigin({ target: published.target, leaseId: event.lease.leaseId });
        }
    });

    function validateAcquireInput(input: IrohHomeTunnelAcquireInput): void {
        if (!input.homeServerIdentityId.trim() || !input.endpoint.endpointId.trim() || !input.canonicalServerUrl.trim()) {
            throw new Error(IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR);
        }
    }

    /** Releases native leases (and their scoped publications) for prior Home/focus generations. */
    async function releaseStalePublicationLeases(target: ActiveServerRuntimeTarget): Promise<void> {
        for (const [leaseId, published] of [...publicationsByLeaseId]) {
            if (published.target.serverId === target.serverId && published.target.generation === target.generation) continue;
            // Scoped unpublish first: a stale event must never clear another Home's origin.
            releaseActiveServerRuntimeOrigin({ target: published.target, leaseId });
            try {
                await published.release();
                if (publicationsByLeaseId.get(leaseId) === published) {
                    publicationsByLeaseId.delete(leaseId);
                }
            } catch {
                // Keep ownership so the existing switch/logout/dispose cleanup
                // paths can retry the failed native stop.
            }
        }
    }

    async function releaseActiveHomeTunnels(): Promise<void> {
        for (const [leaseId, published] of [...publicationsByLeaseId]) {
            releaseActiveServerRuntimeOrigin({ target: published.target, leaseId });
            await published.release();
            if (publicationsByLeaseId.get(leaseId) === published) {
                publicationsByLeaseId.delete(leaseId);
            }
        }
    }

    async function acquireHomeRuntimeOrigin(
        input: IrohHomeTunnelAcquireInput,
    ): Promise<IrohHomeRuntimeOriginLease> {
        validateAcquireInput(input);
        const request: IrohHomeTunnelRequest = {
            // The reusable transport lease is scoped to the Home identity, not
            // whichever local profile happens to be focused by this caller.
            remoteHostId: input.homeServerIdentityId.trim(),
            purpose: 'home',
            homeServerIdentityId: input.homeServerIdentityId,
            endpointId: input.endpoint.endpointId,
            canonicalServerUrl: input.canonicalServerUrl,
            policy: input.policy ?? DEFAULT_IROH_RELAY_POLICY,
            ...(input.endpoint.relayUrls ? { relayUrls: input.endpoint.relayUrls } : {}),
            ...(input.endpoint.directAddresses ? { directAddresses: input.endpoint.directAddresses } : {}),
            ...(input.descriptorRevision === undefined ? {} : { descriptorRevision: input.descriptorRevision }),
            verification: input.verification,
        };
        const lease = await supervisor.ensureTunnel(request);
        const runtimeOrigin = lease.localUrl?.trim() ?? '';
        if (!runtimeOrigin) {
            await supervisor.releaseTunnel(lease.leaseId);
            throw new Error(`${IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR}:runtime-origin-missing`);
        }
        let releasePromise: Promise<void> | null = null;
        return {
            ...lease,
            runtimeOrigin,
            release: () => {
                releasePromise ??= supervisor.releaseTunnel(lease.leaseId).catch((error: unknown) => {
                    // Concurrent callers still share one attempt, but a failed
                    // native stop remains retryable through the runtime owner.
                    releasePromise = null;
                    throw error;
                });
                return releasePromise;
            },
        };
    }

    return {
        acquireHomeRuntimeOrigin,

        async ensureHomeTunnel(input) {
            const target = captureActiveServerRuntimeTarget();
            const effectiveRelayPolicy = resolveEffectiveRelayPolicy(input);
            // A lease belonging to the prior Home/generation is released as part of this switch.
            await releaseStalePublicationLeases(target);
            // Resolves only after the shared supervisor verified health, authenticated
            // reachability, and Home identity against the lease's exact runtime origin.
            const lease = await acquireHomeRuntimeOrigin(input);
            const published = publishActiveServerRuntimeOrigin({
                target,
                leaseId: lease.leaseId,
                runtimeOrigin: lease.runtimeOrigin,
                carrier: 'iroh',
                irohObservedPath: lease.observedPath,
                irohRelayPolicy: effectiveRelayPolicy,
            });
            if (!published) {
                const rejectedPublication: PublishedIrohHomeLease = {
                    target,
                    policy: effectiveRelayPolicy,
                    release: lease.release,
                };
                publicationsByLeaseId.set(lease.leaseId, rejectedPublication);
                try {
                    await rejectedPublication.release();
                    if (publicationsByLeaseId.get(lease.leaseId) === rejectedPublication) {
                        publicationsByLeaseId.delete(lease.leaseId);
                    }
                } catch {
                    // Fail closed regardless. Keep cleanup ownership so the
                    // existing switch/logout/dispose paths can retry it.
                }
                throw new Error(IROH_HOME_TUNNEL_STALE_FOCUS_ERROR);
            }
            // The active publication owns exactly one supervisor reference.
            // Replacing it (including with a retained lease carrying the same
            // leaseId) releases the superseded active reference without
            // disturbing independent enrollment/secondary-Home references.
            const superseded = [...publicationsByLeaseId.entries()].filter(([, prior]) => (
                prior.target.serverId === target.serverId
                && prior.target.generation === target.generation
            ));
            publicationsByLeaseId.set(lease.leaseId, {
                target,
                policy: effectiveRelayPolicy,
                release: lease.release,
            });
            for (const [priorLeaseId, prior] of superseded) {
                if (priorLeaseId !== lease.leaseId) {
                    releaseActiveServerRuntimeOrigin({ target: prior.target, leaseId: priorLeaseId });
                }
                try {
                    await prior.release();
                    if (priorLeaseId !== lease.leaseId && publicationsByLeaseId.get(priorLeaseId) === prior) {
                        publicationsByLeaseId.delete(priorLeaseId);
                    }
                } catch {
                    // The verified replacement remains authoritative. Retain
                    // failed cleanup ownership for the next ensure/logout/dispose.
                }
            }
            return lease;
        },

        async releaseHomeTunnel(leaseId) {
            const published = publicationsByLeaseId.get(leaseId) ?? null;
            if (published) await published.release();
            else await supervisor.releaseTunnel(leaseId);
            publicationsByLeaseId.delete(leaseId);
            if (published) releaseActiveServerRuntimeOrigin({ target: published.target, leaseId });
        },

        releaseActiveHomeTunnels,

        async dispose() {
            unsubscribeLifecycle();
            unsubscribeLifecycle = () => undefined;
            await releaseActiveHomeTunnels();
        },

        async releaseLeasesForStaleTargets() {
            await releaseStalePublicationLeases(captureActiveServerRuntimeTarget());
        },

        markSuspended(): void {
            supervisor.markSuspended();
            // Degrade the native leases and unpublish every origin so requests
            // fail back to the stable canonical carrier while suspended.
            for (const [leaseId, published] of publicationsByLeaseId) {
                releaseActiveServerRuntimeOrigin({ target: published.target, leaseId });
            }
        },

        async markForeground(): Promise<void> {
            // The shared supervisor re-probes stored leases with their original
            // request facts; only verified-ready leases are republished here.
            await supervisor.markForeground();
            const target = captureActiveServerRuntimeTarget();
            for (const lease of supervisor.listTunnels().leases) {
                if (lease.status !== 'ready' || !lease.localUrl) continue;
                const published = publicationsByLeaseId.get(lease.leaseId);
                if (!published || published.target.serverId !== target.serverId) continue;
                if (publishActiveServerRuntimeOrigin({
                    target,
                    leaseId: lease.leaseId,
                    runtimeOrigin: lease.localUrl,
                    carrier: 'iroh',
                    irohObservedPath: lease.observedPath,
                    irohRelayPolicy: published.policy,
                })) {
                    publicationsByLeaseId.set(lease.leaseId, { ...published, target });
                }
            }
        },

        listTunnels: () => supervisor.listTunnels(),
    };
}

let singletonRuntime: IrohHomeTunnelRuntime | null = null;

export function getIrohHomeTunnelRuntime(params: Readonly<{
    native?: IrohNativeLifecycleModule | null;
    createSupervisor?: () => IrohHomeTunnelSupervisor;
}> = {}): IrohHomeTunnelRuntime {
    if (!singletonRuntime) {
        singletonRuntime = createIrohHomeTunnelRuntime(params);
    }
    return singletonRuntime;
}

export async function disposeIrohHomeTunnelRuntime(): Promise<void> {
    const runtime = singletonRuntime;
    singletonRuntime = null;
    await runtime?.dispose();
}

/** Stable lifecycle-neutral production seam consumed by enrollment/secondary Home owners. */
export async function acquireIrohHomeRuntimeOrigin(
    input: IrohHomeTunnelAcquireInput,
): Promise<IrohHomeRuntimeOriginLease> {
    return await getIrohHomeTunnelRuntime().acquireHomeRuntimeOrigin(input);
}
