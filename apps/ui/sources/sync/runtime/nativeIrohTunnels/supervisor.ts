import {
    createIrohNativeAdapter,
    createOptionalIrohNativeAdapter,
    type IrohHomeTunnelLease as IrohNativeHomeTunnelLease,
    type IrohNativeAdapter,
} from '@happier-dev/iroh-native';
import type { DoctorSnapshotHomeTransportDiagnostics } from '@happier-dev/protocol';

import { createLoopbackTunnelSupervisor } from '@/sync/runtime/nativeLoopbackTunnels/supervisor';
import type {
    LoopbackTunnelAdapter,
    LoopbackTunnelNativeEvent,
    LoopbackTunnelProbeResult,
    LoopbackTunnelSupervisor,
} from '@/sync/runtime/nativeLoopbackTunnels/types';

import { createDesktopIrohLifecycleModule } from './desktopLifecycle';
import {
    IROH_HOME_TUNNEL_PROBE_FAILED_ERROR,
    IROH_HOME_TUNNEL_STALE_GENERATION_ERROR,
    IROH_HOME_TUNNEL_SUSPENDED_ERROR,
} from './fallback';
import { probeIrohHomeTunnelOrigin, type IrohHomeTunnelProbeFailureReason } from './probe';
import {
    createInitialIrohHomeTransportDiagnostics,
    projectIrohHomeTransportDiagnosticsEvent,
    projectIrohHomeTransportDiagnosticsFailure,
    projectIrohHomeTransportDiagnosticsReady,
} from './diagnostics';
import type { IrohHomeTunnelLease, IrohHomeTunnelRequest } from './types';
import { publishIrohHomeTransportDiagnostics } from '@/sync/runtime/irohHomeTransportDiagnostics';

/**
 * Recent-history bound for Homes with no live lease. Homes that still hold a
 * lease are always retained, so this never evicts an active Home.
 */
const MAX_INACTIVE_HOME_TRANSPORT_DIAGNOSTICS = 64;

/** Lifecycle-only native boundary consumed by the supervisor (see `createIrohNativeAdapter`). */
export type IrohNativeLifecycleModule = NonNullable<Parameters<typeof createIrohNativeAdapter>[0]>;

export type IrohHomeTunnelSupervisor = LoopbackTunnelSupervisor<IrohHomeTunnelRequest, IrohHomeTunnelLease, never> & Readonly<{
    /** Pull-only Home-scoped projection; reading it never starts native runtime work. */
    readDiagnostics: () => readonly DoctorSnapshotHomeTransportDiagnostics[];
}>;

function readDiagnosticError(error: unknown): Readonly<{ code: string; message?: string }> {
    if (error && typeof error === 'object') {
        const record = error as { code?: unknown; message?: unknown };
        const message = typeof record.message === 'string' && record.message.trim() ? record.message : undefined;
        if (typeof record.code === 'string' && record.code.trim()) {
            return { code: record.code, ...(message ? { message } : {}) };
        }
        if (message) return { code: message.split(':', 1)[0] || 'unknown', message };
    }
    return { code: 'unknown' };
}

/**
 * `undefined` resolves the platform lifecycle module per start: the desktop
 * host command bridge in a desktop shell, otherwise the optional Expo native
 * module (the SSH adapter's convention); `null` means explicitly none.
 * Resolving per start keeps lifecycle supervision working when the native
 * module appears mid-session.
 */
function createBoundNativeAdapter(native?: IrohNativeLifecycleModule | null): IrohNativeAdapter {
    if (native === undefined) {
        const desktopModule = createDesktopIrohLifecycleModule();
        if (desktopModule !== null) return createIrohNativeAdapter(desktopModule);
        return createOptionalIrohNativeAdapter();
    }
    return createIrohNativeAdapter(native ?? undefined);
}

/** Normalized Iroh lease identity: Home/endpoint/descriptor facts, never the verification token. */
export function buildIrohHomeTunnelKey(request: IrohHomeTunnelRequest): string {
    return JSON.stringify({
        remoteHostId: request.remoteHostId.trim(),
        purpose: request.purpose,
        homeServerIdentityId: request.homeServerIdentityId.trim(),
        endpointId: request.endpointId.trim(),
        canonicalServerUrl: request.canonicalServerUrl.trim().replace(/\/+$/, ''),
        policy: request.policy,
        descriptorRevision: request.descriptorRevision ?? null,
        relayUrls: request.relayUrls ? [...request.relayUrls] : null,
        directAddresses: request.directAddresses ? [...request.directAddresses] : null,
    });
}

export function createIrohHomeTunnelSupervisor(params: Readonly<{
    native?: IrohNativeLifecycleModule | null;
    probe?: (url: string, request: IrohHomeTunnelRequest) => Promise<LoopbackTunnelProbeResult<IrohHomeTunnelProbeFailureReason>>;
    probeTimeoutMs?: number;
}> = {}): IrohHomeTunnelSupervisor {
    const nativeAdaptersByTunnelId = new Map<string, IrohNativeAdapter>();
    /**
     * Native adapters whose disposal could not release every native lease they
     * own (a start rejected for identity mismatch whose cleanup also failed).
     * They stay owned here and are retried at this supervisor's own disposal.
     */
    const nativeAdaptersRetainingCustody = new Set<IrohNativeAdapter>();
    const adapter: LoopbackTunnelAdapter<IrohHomeTunnelRequest, IrohNativeHomeTunnelLease> = {
        async startLoopbackTunnel(request) {
            const nativeAdapter = createBoundNativeAdapter(params.native);
            // Carries homeServerIdentityId, endpointId, relay URLs, direct
            // addresses, descriptor revision, and the relay policy verbatim into
            // the native request. The verification token never enters native config.
            let nativeLease: IrohNativeHomeTunnelLease;
            try {
                nativeLease = await nativeAdapter.ensureHomeTunnel({
                    homeServerIdentityId: request.homeServerIdentityId,
                    endpointId: request.endpointId,
                    policy: request.policy,
                    relayUrls: request.relayUrls,
                    directAddresses: request.directAddresses,
                    descriptorRevision: request.descriptorRevision,
                });
            } catch (error) {
                // A rejected start can still leave this adapter owning a native
                // lease it refused to publish. Disposal is its terminal
                // boundary; keep it owned when disposal cannot finish.
                await nativeAdapter.dispose().catch(() => {
                    nativeAdaptersRetainingCustody.add(nativeAdapter);
                });
                throw error;
            }
            let localPort = 0;
            try {
                localPort = Number(new URL(nativeLease.runtimeOrigin).port) || 0;
            } catch {
                localPort = 0;
            }
            nativeAdaptersByTunnelId.set(nativeLease.leaseId, nativeAdapter);
            return { nativeTunnelId: nativeLease.leaseId, localPort, native: nativeLease };
        },
        async stopLoopbackTunnel(nativeTunnelId) {
            const nativeAdapter = nativeAdaptersByTunnelId.get(nativeTunnelId) ?? createBoundNativeAdapter(params.native);
            try {
                await nativeAdapter.releaseHomeTunnel(nativeTunnelId);
            } finally {
                nativeAdaptersByTunnelId.delete(nativeTunnelId);
            }
        },
        subscribeLoopbackTunnelEvents(nativeTunnelId, listener) {
            const nativeAdapter = nativeAdaptersByTunnelId.get(nativeTunnelId);
            return nativeAdapter?.subscribeEvents(nativeTunnelId, listener) ?? (() => undefined);
        },
    };

    const supervisor = createLoopbackTunnelSupervisor<IrohHomeTunnelRequest, IrohHomeTunnelLease, never, IrohNativeHomeTunnelLease>({
        adapter,
        probe: params.probe ?? probeIrohHomeTunnelOrigin,
        probeTimeoutMs: params.probeTimeoutMs,
        buildKey: buildIrohHomeTunnelKey,
        failureCodes: {
            suspended: IROH_HOME_TUNNEL_SUSPENDED_ERROR,
            probeFailed: IROH_HOME_TUNNEL_PROBE_FAILED_ERROR,
            staleGeneration: IROH_HOME_TUNNEL_STALE_GENERATION_ERROR,
        },
        createLease: ({ key, request, native }) => ({
            leaseId: `iroh-home:${key}`,
            key,
            remoteHostId: request.remoteHostId,
            // Preserve the actual native runtime origin; observedPath is the
            // native-reported path, never inferred in TypeScript.
            ...(native?.runtimeOrigin ? { localUrl: native.runtimeOrigin } : {}),
            channelMode: 'loopback-port',
            purpose: 'home',
            status: 'ready',
            startedAt: new Date().toISOString(),
            homeServerIdentityId: request.homeServerIdentityId,
            endpointId: request.endpointId,
            carrier: 'iroh',
            observedPath: native?.observedPath ?? 'unknown',
        }),
        updateLeaseForNativeEvent: (lease, event: LoopbackTunnelNativeEvent) => ({
            ...lease,
            ...(event.observedPath === 'direct' || event.observedPath === 'relay' || event.observedPath === 'unknown'
                ? { observedPath: event.observedPath }
                : {}),
        }),
    });
    const diagnosticsByHomeIdentity = new Map<string, DoctorSnapshotHomeTransportDiagnostics>();
    function publishDiagnostics(diagnostics: DoctorSnapshotHomeTransportDiagnostics): void {
        diagnosticsByHomeIdentity.set(diagnostics.homeServerIdentityId, diagnostics);
        publishIrohHomeTransportDiagnostics(diagnostics);
    }

    /** A Home is active while the existing lease store still owns a lease for it. */
    function isActiveHome(homeServerIdentityId: string): boolean {
        return supervisor.listTunnels().leases.some(
            (lease) => lease.homeServerIdentityId === homeServerIdentityId,
        );
    }

    /**
     * Bounds inactive recent history only. Every Home that still holds a lease
     * keeps its diagnostics, so an active Home can never be evicted by newer
     * Homes; released Homes age out oldest-transition first.
     */
    function boundInactiveDiagnosticsHistory(): void {
        const activeHomeIdentities = new Set(
            supervisor.listTunnels().leases.map((lease) => lease.homeServerIdentityId),
        );
        const inactive = [...diagnosticsByHomeIdentity.entries()]
            .filter(([homeServerIdentityId]) => !activeHomeIdentities.has(homeServerIdentityId))
            .sort(([, left], [, right]) => (left.lastTransitionAtMs ?? 0) - (right.lastTransitionAtMs ?? 0));
        for (let index = 0; index < inactive.length - MAX_INACTIVE_HOME_TRANSPORT_DIAGNOSTICS; index += 1) {
            diagnosticsByHomeIdentity.delete(inactive[index][0]);
        }
    }

    /** Ages a Home fact once its last lease is gone, through the existing release/disposal path. */
    function ageReleasedHomeDiagnostics(homeServerIdentityId: string): void {
        const current = diagnosticsByHomeIdentity.get(homeServerIdentityId);
        if (current && !isActiveHome(homeServerIdentityId)) {
            publishDiagnostics(projectIrohHomeTransportDiagnosticsEvent(current, { type: 'closed', atMs: Date.now() }));
        }
        boundInactiveDiagnosticsHistory();
    }

    supervisor.subscribe((event) => {
        const current = diagnosticsByHomeIdentity.get(event.lease.homeServerIdentityId);
        if (!current) return;
        publishDiagnostics(projectIrohHomeTransportDiagnosticsEvent(current, event));
    });

    return {
        ...supervisor,
        async ensureTunnel(request) {
            const atMs = Date.now();
            if (!diagnosticsByHomeIdentity.has(request.homeServerIdentityId)) {
                boundInactiveDiagnosticsHistory();
            }
            const initial = createInitialIrohHomeTransportDiagnostics({
                homeServerIdentityId: request.homeServerIdentityId,
                remoteEndpointId: request.endpointId,
                policy: request.policy,
                relayUrls: request.relayUrls,
                directAddresses: request.directAddresses,
                atMs,
            });
            publishDiagnostics(initial);
            try {
                const lease = await supervisor.ensureTunnel(request);
                publishDiagnostics(
                    projectIrohHomeTransportDiagnosticsReady(initial, {
                        observedPath: lease.observedPath,
                        atMs: Date.now(),
                    }),
                );
                return lease;
            } catch (error) {
                publishDiagnostics(
                    projectIrohHomeTransportDiagnosticsFailure(initial, {
                        ...readDiagnosticError(error),
                        atMs: Date.now(),
                    }),
                );
                throw error;
            }
        },
        async releaseTunnel(leaseId) {
            const released = supervisor.listTunnels().leases.find((lease) => lease.leaseId === leaseId);
            await supervisor.releaseTunnel(leaseId);
            if (released) ageReleasedHomeDiagnostics(released.homeServerIdentityId);
        },
        async dispose() {
            const ownedHomeIdentities = new Set(
                supervisor.listTunnels().leases.map((lease) => lease.homeServerIdentityId),
            );
            try {
                await supervisor.dispose();
                // Retry any native custody a rejected start could not release.
                // A successful disposal drops the adapter; a failing one stays
                // owned for the next disposal rather than being orphaned.
                for (const nativeAdapter of [...nativeAdaptersRetainingCustody]) {
                    await nativeAdapter.dispose()
                        .then(() => { nativeAdaptersRetainingCustody.delete(nativeAdapter); })
                        .catch(() => undefined);
                }
            } finally {
                // Disposal stops each owned handle once; failed stops stay owned
                // by the same supervisor, so only released Homes age here.
                for (const homeServerIdentityId of ownedHomeIdentities) {
                    ageReleasedHomeDiagnostics(homeServerIdentityId);
                }
            }
        },
        readDiagnostics: () => [...diagnosticsByHomeIdentity.values()]
            .sort((left, right) => left.homeServerIdentityId.localeCompare(right.homeServerIdentityId)),
    };
}
