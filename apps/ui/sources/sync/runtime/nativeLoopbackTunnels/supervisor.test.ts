import { describe, expect, it, vi } from 'vitest';

import type {
    LoopbackTunnelAdapter,
    LoopbackTunnelLease,
    LoopbackTunnelProbe,
    LoopbackTunnelRequest,
} from './types';

type Request = LoopbackTunnelRequest & Readonly<{
    destinationHost: '127.0.0.1';
    destinationPort: number;
    verificationToken?: string;
}>;

function createRequest(): Request {
    return {
        remoteHostId: 'home-a',
        destinationHost: '127.0.0.1',
        destinationPort: 3005,
        purpose: 'home',
    };
}

function createLeaseFactory() {
    return ({ key, request, localPort }: { key: string; request: Request; localPort: number }) => ({
        leaseId: `loopback:${key}`,
        key,
        remoteHostId: request.remoteHostId,
        localUrl: `http://127.0.0.1:${localPort}`,
        channelMode: 'loopback-port' as const,
        purpose: request.purpose,
        status: 'ready' as const,
        startedAt: '2026-08-30T00:00:00.000Z',
    });
}

describe('provider-neutral loopback tunnel supervisor', () => {
    it('coalesces starts and releases the native tunnel after the final lease', async () => {
        const loaded = await import('./supervisor').catch(() => null);
        expect(loaded).not.toBeNull();

        const adapter: LoopbackTunnelAdapter<Request> = {
            startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
            stopLoopbackTunnel: vi.fn(async () => undefined),
        };
        const probe: LoopbackTunnelProbe<Request> = vi.fn(async () => ({ ok: true as const }));
        const supervisor = loaded!.createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter,
            probe,
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
        });

        const first = supervisor.ensureTunnel(createRequest());
        const second = supervisor.ensureTunnel(createRequest());
        const [firstLease, secondLease] = await Promise.all([first, second]);

        expect(firstLease).toEqual(secondLease);
        expect(adapter.startLoopbackTunnel).toHaveBeenCalledTimes(1);

        await supervisor.releaseTunnel(firstLease.leaseId);
        expect(adapter.stopLoopbackTunnel).not.toHaveBeenCalled();
        await supervisor.releaseTunnel(secondLease.leaseId);
        expect(adapter.stopLoopbackTunnel).toHaveBeenCalledWith('native-1');
        expect(supervisor.listTunnels().leases).toEqual([]);
    });

    it('discards a tunnel that finishes after the active server generation changes', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        let generation = 1;
        let resolveStart: ((value: { nativeTunnelId: string; localPort: number }) => void) | undefined;
        const adapter: LoopbackTunnelAdapter<Request> = {
            startLoopbackTunnel: vi.fn(() => new Promise<{ nativeTunnelId: string; localPort: number }>((resolve) => { resolveStart = resolve; })),
            stopLoopbackTunnel: vi.fn(async () => undefined),
        };
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter,
            probe: vi.fn(async () => ({ ok: true as const })),
            buildKey: () => 'home-key',
            getGeneration: () => generation,
            createLease: ({ key, request, localPort, generation: leaseGeneration }) => ({
                leaseId: `loopback:${key}`,
                key,
                remoteHostId: request.remoteHostId,
                localUrl: `http://127.0.0.1:${localPort}`,
                channelMode: 'loopback-port' as const,
                purpose: request.purpose,
                status: 'ready' as const,
                startedAt: '2026-08-30T00:00:00.000Z',
                ...(leaseGeneration === undefined ? {} : { generation: leaseGeneration }),
            }),
        });
        const pending = supervisor.ensureTunnel(createRequest());
        generation = 2;
        resolveStart?.({ nativeTunnelId: 'native-stale', localPort: 49153 });
        await expect(pending).rejects.toThrow('loopback_tunnel_stale_generation');
        expect(adapter.stopLoopbackTunnel).toHaveBeenCalledWith('native-stale');
        expect(supervisor.listTunnels().leases).toEqual([]);
    });

    it('does not expose undefined platform limitations', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter: { startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'n', localPort: 1 })), stopLoopbackTunnel: vi.fn(async () => undefined) },
            probe: vi.fn(async () => ({ ok: true as const })),
            buildKey: () => 'k',
            createLease: createLeaseFactory(),
        });
        await supervisor.ensureTunnel(createRequest());
        expect(supervisor.listTunnels().platformLimitations).toEqual([]);
    });

    it('keeps failed-lease bookkeeping when probe-cleanup stop fails and lets release retry the stop', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        const stopLoopbackTunnel = vi.fn(async () => undefined)
            .mockRejectedValueOnce(new Error('native_stop_failed'))
            .mockResolvedValueOnce(undefined);
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter: {
                startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
                stopLoopbackTunnel,
            },
            probe: vi.fn(async () => ({ ok: false as const, reason: 'remote-service-unreachable' })),
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
        });

        await expect(supervisor.ensureTunnel(createRequest())).rejects.toThrow('native_stop_failed');

        const failedLease = supervisor.listTunnels().leases[0];
        expect(failedLease).toEqual(expect.objectContaining({
            leaseId: 'loopback:home-key',
            localUrl: 'http://127.0.0.1:49152',
            status: 'failed',
        }));

        await supervisor.releaseTunnel(failedLease!.leaseId);
        expect(stopLoopbackTunnel).toHaveBeenCalledTimes(2);
        expect(supervisor.listTunnels().leases).toEqual([]);
    });

    it('applies consumer failure codes, probe diagnostics, and platform limitation configuration', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter: {
                startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
                stopLoopbackTunnel: vi.fn(async () => undefined),
            },
            probe: vi.fn(async () => ({ ok: false as const, reason: 'remote-service-unreachable' })),
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
            failureCodes: {
                suspended: 'custom_tunnel_suspended',
                probeFailed: 'custom_tunnel_probe_failed',
                staleGeneration: 'custom_tunnel_stale_generation',
            },
            platformLimitations: {
                foreground: { id: 'fg-only', severity: 'info', reason: 'foreground-only', message: 'limitation.foreground-only' },
            },
            limitationForProbeFailure: (reason) => ({
                id: `consumer.${reason}`,
                severity: 'error',
                reason,
                message: `limitation.${reason}`,
            }),
        });

        await expect(supervisor.ensureTunnel(createRequest())).rejects.toThrow('custom_tunnel_probe_failed');

        const snapshot = supervisor.listTunnels();
        expect(snapshot.platformLimitations).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'foreground-only', severity: 'info' }),
            expect.objectContaining({ reason: 'remote-service-unreachable', severity: 'error' }),
        ]));

        supervisor.markSuspended();
        await expect(supervisor.ensureTunnel(createRequest())).rejects.toThrow('custom_tunnel_suspended');
    });

    it('passes the tunnel request to probes and re-probes stored leases with the retained request', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        const probe = vi.fn(async () => ({ ok: true as const }));
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter: {
                startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
                stopLoopbackTunnel: vi.fn(async () => undefined),
            },
            probe,
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
        });
        const request = createRequest();

        await supervisor.ensureTunnel(request);
        expect(probe).toHaveBeenCalledWith('http://127.0.0.1:49152', request);

        await supervisor.markForeground();
        expect(probe).toHaveBeenLastCalledWith('http://127.0.0.1:49152', request);
        expect(supervisor.listTunnels().leases[0]).toEqual(expect.objectContaining({ status: 'ready' }));
    });

    it('retains the newest successfully verified request when a healthy lease is reused', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        const probe = vi.fn(async () => ({ ok: true as const }));
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter: {
                startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
                stopLoopbackTunnel: vi.fn(async () => undefined),
            },
            probe,
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
        });
        const firstRequest = { ...createRequest(), verificationToken: 'token-old' };
        const rotatedRequest = { ...createRequest(), verificationToken: 'token-new' };

        await supervisor.ensureTunnel(firstRequest);
        await supervisor.ensureTunnel(rotatedRequest);
        supervisor.markSuspended();
        await supervisor.markForeground();

        expect(probe).toHaveBeenLastCalledWith('http://127.0.0.1:49152', rotatedRequest);
    });

    it('consumes native lifecycle facts through the shared supervisor and detaches a closed tunnel once', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        let nativeListener: (event: {
            type: 'ready' | 'path_changed' | 'degraded' | 'closed' | 'error';
            tunnelHandle: string;
            status: 'ready' | 'degraded' | 'closed' | 'error';
            observedPath?: string;
            errorCode?: string;
            atMs: number;
        }) => void = () => {
            throw new Error('native listener was not subscribed');
        };
        const stopLoopbackTunnel = vi.fn(async () => undefined);
        const unsubscribeNative = vi.fn();
        const adapter: LoopbackTunnelAdapter<Request> = {
            startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
            stopLoopbackTunnel,
            subscribeLoopbackTunnelEvents: (_nativeTunnelId, listener) => {
                nativeListener = listener;
                return unsubscribeNative;
            },
        };
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter,
            probe: vi.fn(async () => ({ ok: true as const })),
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
        });
        const observed: unknown[] = [];
        supervisor.subscribe((event) => observed.push(event));
        const lease = await supervisor.ensureTunnel(createRequest());

        nativeListener({
            type: 'path_changed',
            tunnelHandle: 'native-1',
            status: 'ready',
            observedPath: 'relay',
            atMs: 10,
        });
        expect(supervisor.listTunnels().leases[0]?.status).toBe('ready');
        expect(observed).toEqual([
            expect.objectContaining({ type: 'path_changed', lease: expect.objectContaining({ leaseId: lease.leaseId }), observedPath: 'relay' }),
        ]);

        nativeListener({
            type: 'closed',
            tunnelHandle: 'native-1',
            status: 'closed',
            errorCode: 'transport_closed',
            atMs: 11,
        });
        await vi.waitFor(() => expect(stopLoopbackTunnel).toHaveBeenCalledTimes(1));
        expect(unsubscribeNative).toHaveBeenCalledTimes(1);
        expect(supervisor.listTunnels().leases[0]?.status).toBe('stopped');
        expect(observed).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'closed', lease: expect.objectContaining({ leaseId: lease.leaseId }), errorCode: 'transport_closed' }),
        ]));
    });

    it('stops native observation while suspended and resubscribes only after the foreground probe succeeds', async () => {
        const { createLoopbackTunnelSupervisor } = await import('./supervisor');
        let activeListener: ((event: never) => void) | null = null;
        const unsubscribe = vi.fn(() => { activeListener = null; });
        const subscribeLoopbackTunnelEvents = vi.fn((_nativeTunnelId: string, listener: (event: never) => void) => {
            activeListener = listener;
            return unsubscribe;
        });
        const supervisor = createLoopbackTunnelSupervisor<Request, LoopbackTunnelLease>({
            adapter: {
                startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
                stopLoopbackTunnel: vi.fn(async () => undefined),
                subscribeLoopbackTunnelEvents,
            },
            probe: vi.fn(async () => ({ ok: true as const })),
            buildKey: () => 'home-key',
            createLease: createLeaseFactory(),
        });
        const lease = await supervisor.ensureTunnel(createRequest());
        expect(subscribeLoopbackTunnelEvents).toHaveBeenCalledTimes(1);
        expect(activeListener).not.toBeNull();

        supervisor.markSuspended();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(activeListener).toBeNull();
        expect(supervisor.listTunnels().leases[0]).toEqual(expect.objectContaining({ status: 'degraded' }));

        await supervisor.markForeground();

        expect(subscribeLoopbackTunnelEvents).toHaveBeenCalledTimes(2);
        expect(activeListener).not.toBeNull();
        expect(supervisor.listTunnels().leases[0]).toEqual(expect.objectContaining({ leaseId: lease.leaseId, status: 'ready' }));
    });
});
