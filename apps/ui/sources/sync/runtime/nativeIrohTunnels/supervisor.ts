import {
    createIrohNativeAdapter,
    createOptionalIrohNativeAdapter,
    type IrohHomeTunnelLease as IrohNativeHomeTunnelLease,
    type IrohNativeAdapter,
} from '@happier-dev/iroh-native';

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
import type { IrohHomeTunnelLease, IrohHomeTunnelRequest } from './types';

/** Lifecycle-only native boundary consumed by the supervisor (see `createIrohNativeAdapter`). */
export type IrohNativeLifecycleModule = NonNullable<Parameters<typeof createIrohNativeAdapter>[0]>;

export type IrohHomeTunnelSupervisor = LoopbackTunnelSupervisor<IrohHomeTunnelRequest, IrohHomeTunnelLease, never>;

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

    return createLoopbackTunnelSupervisor<IrohHomeTunnelRequest, IrohHomeTunnelLease, never, IrohNativeHomeTunnelLease>({
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
}
