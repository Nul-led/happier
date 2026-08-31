import { createLoopbackTunnelSupervisor } from '@/sync/runtime/nativeLoopbackTunnels/supervisor';

import { buildNativeSshTunnelKey } from './store';
import { DEFAULT_NATIVE_SSH_TUNNEL_PROBE_TIMEOUT_MS, probeNativeSshTunnel } from './probe';
import type {
    NativeSshTunnelAdapter,
    NativeSshTunnelLimitation,
    NativeSshTunnelLease,
    NativeSshTunnelProbe,
    NativeSshTunnelRequest,
    NativeSshTunnelSupervisor,
} from './types';

const DEFAULT_ADAPTER: NativeSshTunnelAdapter = {
    async startLoopbackTunnel() {
        throw new Error('native_ssh_tunnel_unavailable');
    },
    async stopLoopbackTunnel() {},
};

const FOREGROUND_LIMITATION: NativeSshTunnelLimitation = {
    id: 'native-ssh.foreground-only',
    severity: 'info',
    reason: 'foreground-only',
    message: 'settings.accessEndpoints.limitation.foreground-only',
};

const SUSPENDED_LIMITATION: NativeSshTunnelLimitation = {
    id: 'native-ssh.platform-suspended',
    severity: 'warning',
    reason: 'platform-suspended',
    message: 'settings.accessEndpoints.limitation.platform-suspended',
};

function nowIso(): string {
    return new Date().toISOString();
}

function createLeaseId(key: string): string {
    return `native-ssh:${key}`;
}

function isNativeSshTunnelLimitationReason(
    value: string,
): value is NativeSshTunnelLimitation['reason'] {
    return value === 'authentication-failed'
        || value === 'host-key-mismatch'
        || value === 'host-key-rejected'
        || value === 'host-key-untrusted'
        || value === 'loopback-bind-failed'
        || value === 'network-captive-portal'
        || value === 'remote-service-unreachable';
}

function limitationForFailureReason(reason: string): NativeSshTunnelLimitation | null {
    if (!isNativeSshTunnelLimitationReason(reason)) {
        return null;
    }
    return {
        id: `native-ssh.${reason}`,
        severity: 'error',
        reason,
        message: `settings.accessEndpoints.limitation.${reason}`,
    };
}

function readNativeSshErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
        return null;
    }
    const candidate = error as { code?: unknown; userInfo?: unknown; nativeErrorCode?: unknown };
    if (typeof candidate.code === 'string') {
        return candidate.code;
    }
    if (typeof candidate.nativeErrorCode === 'string') {
        return candidate.nativeErrorCode;
    }
    if (candidate.userInfo && typeof candidate.userInfo === 'object') {
        const userInfo = candidate.userInfo as { code?: unknown };
        if (typeof userInfo.code === 'string') {
            return userInfo.code;
        }
    }
    return null;
}

function limitationForStartError(error: unknown): NativeSshTunnelLimitation | null {
    const code = readNativeSshErrorCode(error);
    if (!code || !isNativeSshTunnelLimitationReason(code)) {
        return null;
    }
    return limitationForFailureReason(code);
}

/**
 * SSH is a thin specialization of the shared loopback tunnel lifecycle owner:
 * it supplies the SSH keying, probe, lease shape, platform limitations, and
 * native diagnostic mapping. All lease, reference-count, probe, degrade,
 * foreground, and release semantics are owned by `createLoopbackTunnelSupervisor`.
 */
export function createNativeSshTunnelSupervisor(params: Readonly<{
    adapter?: NativeSshTunnelAdapter;
    probe?: NativeSshTunnelProbe;
    probeTimeoutMs?: number;
}> = {}): NativeSshTunnelSupervisor {
    const adapter = params.adapter ?? DEFAULT_ADAPTER;
    return createLoopbackTunnelSupervisor<NativeSshTunnelRequest, NativeSshTunnelLease, NativeSshTunnelLimitation>({
        adapter,
        probe: params.probe ?? probeNativeSshTunnel,
        probeTimeoutMs: params.probeTimeoutMs ?? DEFAULT_NATIVE_SSH_TUNNEL_PROBE_TIMEOUT_MS,
        // The bounded probe timeout is reported with the same reason a failed
        // health check produces so consumers see one diagnostic identity.
        probeTimeoutReason: 'remote-service-unreachable',
        buildKey: buildNativeSshTunnelKey,
        createLease: ({ key, request, localPort }) => ({
            leaseId: createLeaseId(key),
            key,
            remoteHostId: request.remoteHostId,
            localUrl: `http://127.0.0.1:${localPort}`,
            channelMode: 'loopback-port',
            purpose: request.purpose,
            status: 'ready',
            startedAt: nowIso(),
        }),
        platformLimitations: {
            foreground: FOREGROUND_LIMITATION,
            suspended: SUSPENDED_LIMITATION,
        },
        failureCodes: {
            suspended: 'native_ssh_tunnel_suspended',
            probeFailed: 'native_ssh_tunnel_probe_failed',
            staleGeneration: 'native_ssh_tunnel_stale_generation',
        },
        limitationForStartError: limitationForStartError,
        limitationForProbeFailure: (reason) => limitationForFailureReason(reason),
    });
}

export { buildNativeSshTunnelKey };
