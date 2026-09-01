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
    const adapter: LoopbackTunnelAdapter<IrohHomeTunnelRequest, IrohNativeHomeTunnelLease> = {
        async startLoopbackTunnel(request) {
            const nativeAdapter = createBoundNativeAdapter(params.native);
            // Carries homeServerIdentityId, endpointId, relay URLs, direct
            // addresses, descriptor revision, and the relay policy verbatim into
            // the native request. The verification token never enters native config.
            const nativeLease = await nativeAdapter.ensureHomeTunnel({
                homeServerIdentityId: request.homeServerIdentityId,
                endpointId: request.endpointId,
                policy: request.policy,
                relayUrls: request.relayUrls,
                directAddresses: request.directAddresses,
                descriptorRevision: request.descriptorRevision,
            });
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
    supervisor.subscribe((event) => {
        const current = diagnosticsByHomeIdentity.get(event.lease.homeServerIdentityId);
        if (!current) return;
        diagnosticsByHomeIdentity.set(
            event.lease.homeServerIdentityId,
            projectIrohHomeTransportDiagnosticsEvent(current, event),
        );
    });

    return {
        ...supervisor,
        async ensureTunnel(request) {
            const atMs = Date.now();
            if (!diagnosticsByHomeIdentity.has(request.homeServerIdentityId) && diagnosticsByHomeIdentity.size >= 64) {
                const oldest = [...diagnosticsByHomeIdentity.entries()].sort(
                    ([, left], [, right]) => (left.lastTransitionAtMs ?? 0) - (right.lastTransitionAtMs ?? 0),
                )[0];
                if (oldest) diagnosticsByHomeIdentity.delete(oldest[0]);
            }
            const initial = createInitialIrohHomeTransportDiagnostics({
                homeServerIdentityId: request.homeServerIdentityId,
                policy: request.policy,
                relayUrls: request.relayUrls,
                directAddresses: request.directAddresses,
                atMs,
            });
            diagnosticsByHomeIdentity.set(request.homeServerIdentityId, initial);
            try {
                const lease = await supervisor.ensureTunnel(request);
                diagnosticsByHomeIdentity.set(
                    request.homeServerIdentityId,
                    projectIrohHomeTransportDiagnosticsReady(initial, {
                        observedPath: lease.observedPath,
                        atMs: Date.now(),
                    }),
                );
                return lease;
            } catch (error) {
                diagnosticsByHomeIdentity.set(
                    request.homeServerIdentityId,
                    projectIrohHomeTransportDiagnosticsFailure(initial, {
                        ...readDiagnosticError(error),
                        atMs: Date.now(),
                    }),
                );
                throw error;
            }
        },
        readDiagnostics: () => [...diagnosticsByHomeIdentity.values()]
            .sort((left, right) => left.homeServerIdentityId.localeCompare(right.homeServerIdentityId)),
    };
}
