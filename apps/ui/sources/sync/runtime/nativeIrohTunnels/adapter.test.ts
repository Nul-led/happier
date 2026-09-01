import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IrohHomeTunnelAcquireInput, IrohHomeTunnelLease, IrohHomeTunnelRequest } from './types';
import type { IrohHomeTunnelSupervisor } from './supervisor';
import type { LoopbackTunnelLifecycleEvent, LoopbackTunnelSnapshot } from '@/sync/runtime/nativeLoopbackTunnels/types';

function randomScope(): string {
    return `iroh_lifecycle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const HOME_IDENTITY_A = 'srv_home_a';
const HOME_IDENTITY_B = 'srv_home_b';

function nativeLease(
    leaseId: string,
    homeServerIdentityId: string,
    endpointId: string,
    port: number,
): {
    leaseId: string;
    homeServerIdentityId: string;
    homeEndpointId: string;
    runtimeOrigin: string;
    carrier: 'iroh';
    observedPath: 'direct';
    startedAtMs: number;
} {
    return {
        leaseId,
        homeServerIdentityId,
        homeEndpointId: endpointId,
        runtimeOrigin: `http://127.0.0.1:${port}`,
        carrier: 'iroh',
        observedPath: 'direct',
        startedAtMs: 1,
    };
}

function makeRequest(overrides: Partial<IrohHomeTunnelRequest> = {}): IrohHomeTunnelRequest {
    return {
        remoteHostId: 'profile-a',
        purpose: 'home',
        homeServerIdentityId: HOME_IDENTITY_A,
        endpointId: 'endpoint-a',
        canonicalServerUrl: 'https://order.example.test',
        policy: 'automatic',
        verification: { kind: 'authenticated', token: 'token-a' },
        ...overrides,
    };
}

function makeLease(request: IrohHomeTunnelRequest, leaseId: string, localUrl: string): IrohHomeTunnelLease {
    return {
        leaseId,
        key: `test:${leaseId}`,
        remoteHostId: request.remoteHostId,
        localUrl,
        channelMode: 'loopback-port',
        purpose: 'home',
        status: 'ready',
        startedAt: '2026-08-30T00:00:00.000Z',
        homeServerIdentityId: request.homeServerIdentityId,
        endpointId: request.endpointId,
        carrier: 'iroh',
        observedPath: 'direct',
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function identityFeaturesPayload(serverIdentityId: string): unknown {
    return { features: {}, capabilities: { serverIdentity: { serverIdentityId } } };
}

function createSupervisorFake(): {
    supervisor: IrohHomeTunnelSupervisor;
    ensureTunnel: ReturnType<typeof vi.fn>;
    listTunnels: ReturnType<typeof vi.fn>;
    releaseTunnel: ReturnType<typeof vi.fn>;
    markSuspended: ReturnType<typeof vi.fn>;
    markForeground: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    emit: (event: LoopbackTunnelLifecycleEvent<IrohHomeTunnelLease>) => void;
} {
    const stored: { lease: IrohHomeTunnelLease | null } = { lease: null };
    const ensureTunnel = vi.fn(async (request: IrohHomeTunnelRequest) => {
        const lease = makeLease(request, `lease-${ensureTunnel.mock.calls.length}`, `http://127.0.0.1:${45800 + ensureTunnel.mock.calls.length}`);
        stored.lease = lease;
        return lease;
    });
    const listTunnels = vi.fn((): LoopbackTunnelSnapshot<IrohHomeTunnelLease, never> => ({
        leases: stored.lease ? [stored.lease] : [],
        platformLimitations: [],
    }));
    const releaseTunnel = vi.fn(async (_leaseId: string) => undefined);
    const dispose = vi.fn(async () => undefined);
    const markSuspended = vi.fn();
    const markForeground = vi.fn(async () => undefined);
    const readDiagnostics = vi.fn(() => []);
    const listeners = new Set<(event: LoopbackTunnelLifecycleEvent<IrohHomeTunnelLease>) => void>();
    const unsubscribe = vi.fn((listener: (event: LoopbackTunnelLifecycleEvent<IrohHomeTunnelLease>) => void) => {
        listeners.delete(listener);
    });
    const subscribe = vi.fn((listener: (event: LoopbackTunnelLifecycleEvent<IrohHomeTunnelLease>) => void) => {
        listeners.add(listener);
        return () => unsubscribe(listener);
    });
    const supervisor = {
        ensureTunnel,
        listTunnels,
        releaseTunnel,
        dispose,
        markSuspended,
        markForeground,
        subscribe,
        readDiagnostics,
    } as unknown as IrohHomeTunnelSupervisor;
    return {
        supervisor, ensureTunnel, listTunnels, releaseTunnel, markSuspended, markForeground, unsubscribe,
        emit: (event) => { for (const listener of listeners) listener(event); },
    };
}

describe('Iroh Home tunnel lifecycle runtime', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('publishes the runtime origin only after native acquire, health, authenticated ping, and identity proof', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://order.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const events: string[] = [];
        let publishedAtFeatures = false;
        const native = {
            ensureHomeTunnel: vi.fn(async (input: { homeServerIdentityId: string; endpointId: string }) => {
                events.push('native:start');
                return nativeLease('native-lease-1', input.homeServerIdentityId, input.endpointId, 45901);
            }),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async (input, init) => {
            const url = String(input);
            events.push(url.endsWith('/health') ? 'probe:health' : url.endsWith('/v1/auth/ping') ? 'probe:auth-ping' : 'probe:features');
            if (url === 'http://127.0.0.1:45901/health') return jsonResponse(200, { ok: true });
            if (url === 'http://127.0.0.1:45901/v1/auth/ping') {
                expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-a');
                return jsonResponse(200, { ok: true });
            }
            if (url === 'http://127.0.0.1:45901/v1/features') {
                // The final identity proof must run before any publication exists.
                publishedAtFeatures = profiles.getActiveServerSnapshot().runtimeOrigin !== undefined;
                return jsonResponse(200, identityFeaturesPayload(HOME_IDENTITY_A));
            }
            throw new Error(`unexpected request ${url}`);
        });

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: {
                endpointId: 'endpoint-a',
                relayUrls: ['https://relay.example.test'],
                directAddresses: ['192.168.1.10:4242'],
            },
            descriptorRevision: 4,
            canonicalServerUrl: 'https://order.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        expect(events[0]).toBe('native:start');
        expect(events.indexOf('probe:health')).toBeGreaterThan(-1);
        expect(events.indexOf('probe:auth-ping')).toBeGreaterThan(events.indexOf('probe:health'));
        expect(events.indexOf('probe:features')).toBeGreaterThan(events.indexOf('probe:auth-ping'));
        expect(publishedAtFeatures).toBe(false);

        const snapshot = profiles.getActiveServerSnapshot();
        expect(snapshot.runtimeOrigin).toBe('http://127.0.0.1:45901');
        expect(snapshot.carrier).toBe('iroh');
        expect(snapshot).not.toHaveProperty('irohObservedPath');
        expect(snapshot).not.toHaveProperty('irohRelayPolicy');
        expect(snapshot.serverUrl).toBe('https://order.example.test');
        expect(lease.observedPath).toBe('direct');
        expect(lease.carrier).toBe('iroh');

        // Descriptor/identity facts and the relay policy ride the native request;
        // the verification token never enters native configuration.
        expect(native.ensureHomeTunnel).toHaveBeenCalledWith({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpointId: 'endpoint-a',
            policy: 'automatic',
            relayUrls: ['https://relay.example.test'],
            directAddresses: ['192.168.1.10:4242'],
            descriptorRevision: 4,
        });
    });

    it('acquires a verified pre-token runtime origin without publishing active-profile state and returns a scoped release', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const active = profiles.upsertServerProfile({ serverUrl: 'https://active.example.test', source: 'manual' });
        profiles.setActiveServerId(active.id, { scope: 'device' });

        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const acquired = await runtime.acquireHomeRuntimeOrigin({
            homeServerIdentityId: HOME_IDENTITY_B,
            endpoint: { endpointId: 'endpoint-b' },
            canonicalServerUrl: 'https://enrollment.example.test',
            verification: { kind: 'enrollment' },
        });

        expect(acquired).toMatchObject({
            carrier: 'iroh',
            observedPath: 'direct',
            runtimeOrigin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/u),
        });
        expect(fake.ensureTunnel).toHaveBeenCalledWith(expect.objectContaining({
            remoteHostId: HOME_IDENTITY_B,
            homeServerIdentityId: HOME_IDENTITY_B,
            verification: { kind: 'enrollment' },
        }));
        expect(profiles.getActiveServerSnapshot().serverId).toBe(profiles.resolveServerProfileScopeId(active));
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
        expect(profiles.getActiveServerSnapshot().carrier).toBeUndefined();

        await acquired.release();
        expect(fake.releaseTunnel).toHaveBeenCalledWith(acquired.leaseId);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('fails closed without acquiring anything when the endpoint identity is missing', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://malformed.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const native = {
            ensureHomeTunnel: vi.fn(async () => nativeLease('native-lease-never', HOME_IDENTITY_A, 'endpoint-a', 45971)),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });

        await expect(runtime.ensureHomeTunnel({
            homeServerIdentityId: '   ',
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://malformed.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        })).rejects.toThrow('iroh_home_tunnel_invalid_endpoint');
        await expect(runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: '' },
            canonicalServerUrl: 'https://malformed.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        })).rejects.toThrow('iroh_home_tunnel_invalid_endpoint');

        expect(native.ensureHomeTunnel).not.toHaveBeenCalled();
        expect(native.releaseHomeTunnel).not.toHaveBeenCalled();
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('releases the native lease and never publishes when the Home identity mismatches', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://mismatch.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const native = {
            ensureHomeTunnel: vi.fn(async () => nativeLease('native-lease-mismatch', HOME_IDENTITY_A, 'endpoint-a', 45911)),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async (input) => {
            const url = String(input);
            if (url === 'http://127.0.0.1:45911/health') return jsonResponse(200, { ok: true });
            if (url === 'http://127.0.0.1:45911/v1/auth/ping') return jsonResponse(200, { ok: true });
            if (url === 'http://127.0.0.1:45911/v1/features') {
                return jsonResponse(200, identityFeaturesPayload('srv_home_other'));
            }
            throw new Error(`unexpected request ${url}`);
        });

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });

        await expect(runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://mismatch.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        })).rejects.toThrow('iroh_home_tunnel_probe_failed:identity-mismatch');

        expect(native.releaseHomeTunnel).toHaveBeenCalledWith('native-lease-mismatch');
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('releases the native lease and never publishes when the authenticated ping fails', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://authfail.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const native = {
            ensureHomeTunnel: vi.fn(async () => nativeLease('native-lease-authfail', HOME_IDENTITY_A, 'endpoint-a', 45921)),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async (input) => {
            const url = String(input);
            if (url === 'http://127.0.0.1:45921/health') return jsonResponse(200, { ok: true });
            if (url === 'http://127.0.0.1:45921/v1/auth/ping') return jsonResponse(403, { error: 'forbidden' });
            throw new Error(`unexpected request ${url}`);
        });

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });

        await expect(runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://authfail.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        })).rejects.toThrow('iroh_home_tunnel_probe_failed:auth-failed');

        expect(native.releaseHomeTunnel).toHaveBeenCalledWith('native-lease-authfail');
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('releases the native lease and never publishes when health is unreachable', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://unhealthy.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const native = {
            ensureHomeTunnel: vi.fn(async () => nativeLease('native-lease-health', HOME_IDENTITY_A, 'endpoint-a', 45931)),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async () => jsonResponse(503, { error: 'unavailable' }));

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });

        await expect(runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://unhealthy.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        })).rejects.toThrow('iroh_home_tunnel_probe_failed:health-unavailable');

        expect(native.releaseHomeTunnel).toHaveBeenCalledWith('native-lease-health');
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('retains failed-start cleanup custody and retries the exact native lease during runtime disposal', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();

        let rejectFirstStop = true;
        const native = {
            ensureHomeTunnel: vi.fn(async () => nativeLease('native-lease-failed-start', HOME_IDENTITY_A, 'endpoint-a', 45932)),
            releaseHomeTunnel: vi.fn(async () => {
                if (rejectFirstStop) {
                    rejectFirstStop = false;
                    throw new Error('native stop failed');
                }
            }),
        };

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const { createIrohHomeTunnelSupervisor } = await import('./supervisor');
        const runtime = createIrohHomeTunnelRuntime({
            createSupervisor: () => createIrohHomeTunnelSupervisor({
                native,
                probe: async () => ({ ok: false, reason: 'health-unavailable' }),
            }),
        });
        const input: IrohHomeTunnelAcquireInput = {
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://failed-start.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        };

        await expect(runtime.acquireHomeRuntimeOrigin(input)).rejects.toThrow('native stop failed');
        expect(native.ensureHomeTunnel).toHaveBeenCalledTimes(1);
        expect(native.releaseHomeTunnel).toHaveBeenCalledTimes(1);
        expect(native.releaseHomeTunnel).toHaveBeenLastCalledWith('native-lease-failed-start');

        await runtime.dispose();

        expect(native.releaseHomeTunnel).toHaveBeenCalledTimes(2);
        expect(native.releaseHomeTunnel).toHaveBeenLastCalledWith('native-lease-failed-start');
        expect(runtime.listTunnels().leases).toEqual([]);
    });

    it('releases the native lease and never publishes when focus changes during acquisition', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://stale-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://stale-second.example.test', source: 'manual' });
        profiles.setActiveServerId(first.id, { scope: 'device' });

        let resolveNative: ((value: ReturnType<typeof nativeLease>) => void) | undefined;
        const native = {
            ensureHomeTunnel: vi.fn(async () => await new Promise<ReturnType<typeof nativeLease>>((resolve) => { resolveNative = resolve; })),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async (input) => {
            const url = String(input);
            if (url === 'http://127.0.0.1:45941/health') return jsonResponse(200, { ok: true });
            if (url === 'http://127.0.0.1:45941/v1/auth/ping') return jsonResponse(200, { ok: true });
            if (url === 'http://127.0.0.1:45941/v1/features') {
                return jsonResponse(200, identityFeaturesPayload(HOME_IDENTITY_A));
            }
            throw new Error(`unexpected request ${url}`);
        });

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });

        const pending = runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://stale-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        await vi.waitFor(() => expect(resolveNative).toBeTypeOf('function'));
        profiles.setActiveServerId(second.id, { scope: 'device' });
        resolveNative!(nativeLease('native-lease-stale', HOME_IDENTITY_A, 'endpoint-a', 45941));

        await expect(pending).rejects.toThrow('iroh_home_tunnel_stale_focus');
        expect(native.releaseHomeTunnel).toHaveBeenCalledWith('native-lease-stale');
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('reports an honest typed outcome and never publishes when the native module is unavailable', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://nonative.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        const runtimeFetch = vi.fn(async () => jsonResponse(200, {}));
        setRuntimeFetch(runtimeFetch);

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native: null });

        await expect(runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://nonative.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        })).rejects.toThrow(/unavailable/i);

        expect(runtimeFetch).not.toHaveBeenCalled();
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('reuses one verified lease per Home identity and descriptor facts, not per request', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://reuse.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        let nativeStarts = 0;
        const native = {
            ensureHomeTunnel: vi.fn(async (input: { endpointId: string }) => {
                nativeStarts += 1;
                return nativeLease(`native-lease-reuse-${nativeStarts}`, HOME_IDENTITY_A, input.endpointId, 45950 + nativeStarts);
            }),
            releaseHomeTunnel: vi.fn(async () => undefined),
        };
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        let probeRound = 0;
        setRuntimeFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) return jsonResponse(200, { ok: true });
            if (url.endsWith('/v1/features')) {
                probeRound += 1;
                return jsonResponse(200, identityFeaturesPayload(HOME_IDENTITY_A));
            }
            throw new Error(`unexpected request ${url}`);
        });

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ native });
        const input: IrohHomeTunnelAcquireInput = {
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://reuse.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        };

        const firstLease = await runtime.ensureHomeTunnel(input);
        // Same key facts (the token is not a key fact): the retained lease is re-verified and reused.
        const secondLease = await runtime.ensureHomeTunnel({
            ...input,
            verification: { kind: 'authenticated', token: 'token-a-rotated' },
        });
        expect(secondLease.leaseId).toBe(firstLease.leaseId);
        expect(native.ensureHomeTunnel).toHaveBeenCalledTimes(1);
        expect(probeRound).toBe(2);

        // Different endpoint facts invalidate the lease and force a new native acquisition.
        const otherLease = await runtime.ensureHomeTunnel({
            ...input,
            endpoint: { endpointId: 'endpoint-a-rev2' },
        });
        expect(otherLease.leaseId).not.toBe(firstLease.leaseId);
        expect(native.ensureHomeTunnel).toHaveBeenCalledTimes(2);
        // The active publication owns one reference. Re-acquiring the same
        // lease replaces that reference, and changing descriptor facts releases
        // the superseded native tunnel rather than leaking it.
        expect(native.releaseHomeTunnel).toHaveBeenCalledTimes(1);
        expect(native.releaseHomeTunnel).toHaveBeenCalledWith('native-lease-reuse-1');
    });

    it('releases and rejects an acquisition whose publication loses a focus race', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://race-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://race-second.example.test', source: 'manual' });
        profiles.setActiveServerId(first.id, { scope: 'device' });

        let resolveEnsure: ((lease: IrohHomeTunnelLease) => void) | undefined;
        const fake = createSupervisorFake();
        fake.ensureTunnel.mockImplementationOnce(async (request: IrohHomeTunnelRequest) => {
            return await new Promise<IrohHomeTunnelLease>((resolve) => { resolveEnsure = resolve; });
        });

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        const pending = runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://race-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        await vi.waitFor(() => expect(resolveEnsure).toBeTypeOf('function'));
        profiles.setActiveServerId(second.id, { scope: 'device' });
        resolveEnsure!(makeLease(makeRequest(), 'lease-stale', 'http://127.0.0.1:45961'));

        await expect(pending).rejects.toThrow('iroh_home_tunnel_stale_focus');
        expect(fake.releaseTunnel).toHaveBeenCalledWith('lease-stale');
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('retains failed cleanup when a focus-race publication is rejected', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://retry-race-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://retry-race-second.example.test', source: 'manual' });
        profiles.setActiveServerId(first.id, { scope: 'device' });

        let resolveEnsure: ((lease: IrohHomeTunnelLease) => void) | undefined;
        const fake = createSupervisorFake();
        fake.ensureTunnel.mockImplementationOnce(async () => {
            return await new Promise<IrohHomeTunnelLease>((resolve) => { resolveEnsure = resolve; });
        });
        fake.releaseTunnel.mockRejectedValueOnce(new Error('native stop failed'));

        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const pending = runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://retry-race-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        await vi.waitFor(() => expect(resolveEnsure).toBeTypeOf('function'));
        profiles.setActiveServerId(second.id, { scope: 'device' });
        resolveEnsure!(makeLease(makeRequest(), 'lease-retry-race', 'http://127.0.0.1:45962'));

        await expect(pending).rejects.toThrow('iroh_home_tunnel_stale_focus');
        await runtime.releaseLeasesForStaleTargets();

        expect(fake.releaseTunnel.mock.calls.filter(([leaseId]) => leaseId === 'lease-retry-race')).toHaveLength(2);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('keeps the focused Home lease published when a stale Home lease is released late', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://ab-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://ab-second.example.test', source: 'manual' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        profiles.setActiveServerId(first.id, { scope: 'device' });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://ab-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        profiles.setActiveServerId(second.id, { scope: 'device' });
        const leaseB = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_B,
            endpoint: { endpointId: 'endpoint-b' },
            canonicalServerUrl: 'https://ab-second.example.test',
            verification: { kind: 'authenticated', token: 'token-b' },
        });

        // The stale Home A lease (from before the switch) is released late...
        await runtime.releaseHomeTunnel('lease-1');

        // ...and must not clear or overwrite the focused Home B publication.
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: profiles.resolveServerProfileScopeId(second),
            runtimeOrigin: leaseB.localUrl,
            carrier: 'iroh',
        });

        // Releasing the focused lease unpublishes only its own target-scoped origin.
        await runtime.releaseHomeTunnel(leaseB.leaseId);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
        expect(profiles.getActiveServerSnapshot().carrier).toBeUndefined();
    });

    it('keeps the newest Home A lease published when an old A lease is released after refocusing A', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://aba-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://aba-second.example.test', source: 'manual' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        profiles.setActiveServerId(first.id, { scope: 'device' });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://aba-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        profiles.setActiveServerId(second.id, { scope: 'device' });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_B,
            endpoint: { endpointId: 'endpoint-b' },
            canonicalServerUrl: 'https://aba-second.example.test',
            verification: { kind: 'authenticated', token: 'token-b' },
        });
        profiles.setActiveServerId(first.id, { scope: 'device' });
        const leaseANew = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://aba-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        // Releasing the superseded first A publication must not clear the newest A lease.
        await runtime.releaseHomeTunnel('lease-1');

        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: profiles.resolveServerProfileScopeId(first),
            runtimeOrigin: leaseANew.localUrl,
            carrier: 'iroh',
        });
    });

    it('releases leases from a prior Home/focus generation during the switch', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://reap-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://reap-second.example.test', source: 'manual' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        profiles.setActiveServerId(first.id, { scope: 'device' });
        const leaseA = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://reap-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        profiles.setActiveServerId(second.id, { scope: 'device' });

        await runtime.releaseLeasesForStaleTargets();

        expect(fake.releaseTunnel).toHaveBeenCalledWith(leaseA.leaseId);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('retains failed stale-generation cleanup so the existing lifecycle owner can retry it', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://retry-stale-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://retry-stale-second.example.test', source: 'manual' });
        const fake = createSupervisorFake();
        fake.releaseTunnel.mockRejectedValueOnce(new Error('native stop failed'));
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        profiles.setActiveServerId(first.id, { scope: 'device' });
        const staleLease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://retry-stale-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        profiles.setActiveServerId(second.id, { scope: 'device' });

        await runtime.releaseLeasesForStaleTargets();
        await runtime.releaseLeasesForStaleTargets();

        expect(fake.releaseTunnel.mock.calls.filter(([leaseId]) => leaseId === staleLease.leaseId)).toHaveLength(2);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('retains failed superseded cleanup so active shutdown can retry it', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://retry-superseded.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        fake.releaseTunnel.mockRejectedValueOnce(new Error('native stop failed'));
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        const supersededLease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://retry-superseded.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a-revision-2' },
            descriptorRevision: 2,
            canonicalServerUrl: 'https://retry-superseded.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        await runtime.releaseActiveHomeTunnels();

        expect(fake.releaseTunnel.mock.calls.filter(([leaseId]) => leaseId === supersededLease.leaseId)).toHaveLength(2);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('unpublishes while suspended and republishes only a lease the foreground re-probe verified', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://lifecycle.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });

        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://lifecycle.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBe(lease.localUrl);

        runtime.markSuspended();
        expect(fake.markSuspended).toHaveBeenCalledTimes(1);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();

        // Foreground with a verified-ready lease republishes for the still-focused Home.
        await runtime.markForeground();
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBe(lease.localUrl);

        // Foreground with a lease that failed its re-probe must not republish.
        runtime.markSuspended();
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
        fake.listTunnels.mockImplementationOnce(() => ({
            leases: [{ ...lease, status: 'failed' }],
            platformLimitations: [],
        }));
        await runtime.markForeground();
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('keeps a foreground-ready lease unpublished when its focused Home generation is stale', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://stale-foreground.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const recoveryEvents: unknown[] = [];
        runtime.subscribeRecoveryRequired((event) => recoveryEvents.push(event));
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://stale-foreground.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        runtime.markSuspended();
        profiles.renameServerProfile(home.id, 'Renamed without changing the Home');
        await runtime.markForeground();

        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
        expect(recoveryEvents).toEqual([
            expect.objectContaining({
                leaseId: lease.leaseId,
                homeServerIdentityId: HOME_IDENTITY_A,
                reason: 'stale_generation',
                activePublication: true,
            }),
        ]);
        expect(fake.releaseTunnel).not.toHaveBeenCalled();

        await runtime.releaseLeasesForStaleTargets();
        expect(fake.releaseTunnel).toHaveBeenCalledWith(lease.leaseId);
    });

    it('releases the focused native lease and publication on active-connection shutdown', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://logout.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://logout.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        await runtime.releaseActiveHomeTunnels();

        expect(fake.releaseTunnel).toHaveBeenCalledWith(lease.leaseId);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('attempts every active release, retains failed ownership, and retries only the failed lease', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const first = profiles.upsertServerProfile({ serverUrl: 'https://release-all-first.example.test', source: 'manual' });
        const second = profiles.upsertServerProfile({ serverUrl: 'https://release-all-second.example.test', source: 'manual' });
        const fake = createSupervisorFake();
        let failFirstLease = true;
        fake.releaseTunnel.mockImplementation(async (leaseId: string) => {
            if (leaseId === 'lease-1' && failFirstLease) throw new Error('first native stop failed');
        });
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });

        profiles.setActiveServerId(first.id, { scope: 'device' });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://release-all-first.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        profiles.setActiveServerId(second.id, { scope: 'device' });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_B,
            endpoint: { endpointId: 'endpoint-b' },
            canonicalServerUrl: 'https://release-all-second.example.test',
            verification: { kind: 'authenticated', token: 'token-b' },
        });

        fake.releaseTunnel.mockClear();
        await expect(runtime.releaseActiveHomeTunnels()).rejects.toThrow('first native stop failed');
        expect(fake.releaseTunnel).toHaveBeenCalledWith('lease-1');
        expect(fake.releaseTunnel).toHaveBeenCalledWith('lease-2');

        fake.releaseTunnel.mockClear();
        failFirstLease = false;
        await runtime.releaseActiveHomeTunnels();
        expect(fake.releaseTunnel).toHaveBeenCalledTimes(1);
        expect(fake.releaseTunnel).toHaveBeenCalledWith('lease-1');
    });

    it('disposes the singleton through its runtime owner and leaves no lifecycle subscription or active lease', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://dispose.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        const { disposeIrohHomeTunnelRuntime, getIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = getIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://dispose.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        await disposeIrohHomeTunnelRuntime();

        expect(fake.releaseTunnel).toHaveBeenCalledWith(lease.leaseId);
        expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
    });

    it('disposes lifecycle-neutral leases even when their consumer did not release them', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const fake = createSupervisorFake();
        const { disposeIrohHomeTunnelRuntime, getIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = getIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const lease = await runtime.acquireHomeRuntimeOrigin({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://neutral-dispose.example.test',
            verification: { kind: 'enrollment' },
        });

        await disposeIrohHomeTunnelRuntime();

        expect(fake.releaseTunnel).toHaveBeenCalledWith(lease.leaseId);
        expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('keeps the singleton and lifecycle owner when disposal fails, then retries cleanup through that same owner', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://dispose-retry.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        fake.releaseTunnel.mockRejectedValueOnce(new Error('native stop failed'));
        const { disposeIrohHomeTunnelRuntime, getIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = getIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://dispose-retry.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        await expect(disposeIrohHomeTunnelRuntime()).rejects.toThrow('native stop failed');
        expect(fake.unsubscribe).not.toHaveBeenCalled();
        expect(getIrohHomeTunnelRuntime({ createSupervisor: () => createSupervisorFake().supervisor })).toBe(runtime);

        await disposeIrohHomeTunnelRuntime();
        expect(fake.releaseTunnel).toHaveBeenCalledTimes(2);
        expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
        expect(getIrohHomeTunnelRuntime({ createSupervisor: () => createSupervisorFake().supervisor })).not.toBe(runtime);
    });

    it('unpublishes the matching generation when the native owner reports transport closure', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://event.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            descriptorRevision: 7,
            canonicalServerUrl: 'https://event.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });
        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBe(lease.localUrl);

        fake.emit({
            type: 'closed', tunnelHandle: 'native-event', status: 'closed',
            errorCode: 'transport_closed', atMs: 10, lease: { ...lease, status: 'stopped' },
        });

        expect(profiles.getActiveServerSnapshot().runtimeOrigin).toBeUndefined();
        expect(profiles.getActiveServerSnapshot().carrier).toBeUndefined();
    });

    it('requests replacement for a terminal native lease and a foreground probe failure', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://recover.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const recoveryEvents: unknown[] = [];
        runtime.subscribeRecoveryRequired((event) => recoveryEvents.push(event));
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://recover.example.test',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        fake.emit({
            type: 'closed', tunnelHandle: 'native-event', status: 'closed',
            errorCode: 'transport_closed', atMs: 10, lease: { ...lease, status: 'stopped' },
        });
        expect(recoveryEvents).toEqual([
            expect.objectContaining({ leaseId: lease.leaseId, homeServerIdentityId: HOME_IDENTITY_A, reason: 'terminal' }),
        ]);

        recoveryEvents.length = 0;
        runtime.markSuspended();
        fake.listTunnels.mockImplementationOnce(() => ({
            leases: [{ ...lease, status: 'failed' }],
            platformLimitations: [],
        }));
        await runtime.markForeground();
        expect(recoveryEvents).toEqual([
            expect.objectContaining({ leaseId: lease.leaseId, homeServerIdentityId: HOME_IDENTITY_A, reason: 'foreground_probe_failed' }),
        ]);
    });

    it('keeps native path telemetry diagnostic-only without republishing the active Home snapshot', async () => {
        vi.resetModules();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await import('../../domains/server/serverProfiles');
        const home = profiles.upsertServerProfile({ serverUrl: 'https://path.example.test', source: 'manual' });
        profiles.setActiveServerId(home.id, { scope: 'device' });
        const fake = createSupervisorFake();
        const { createIrohHomeTunnelRuntime } = await import('./runtime');
        const runtime = createIrohHomeTunnelRuntime({ createSupervisor: () => fake.supervisor });
        const lease = await runtime.ensureHomeTunnel({
            homeServerIdentityId: HOME_IDENTITY_A,
            endpoint: { endpointId: 'endpoint-a' },
            canonicalServerUrl: 'https://path.example.test',
            policy: 'automatic',
            verification: { kind: 'authenticated', token: 'token-a' },
        });

        const publishedSnapshot = profiles.getActiveServerSnapshot();
        expect(publishedSnapshot).toMatchObject({ carrier: 'iroh' });
        expect(publishedSnapshot).not.toHaveProperty('irohObservedPath');
        expect(publishedSnapshot).not.toHaveProperty('irohRelayPolicy');

        fake.emit({
            type: 'path_changed',
            tunnelHandle: 'native-path',
            status: 'ready',
            observedPath: 'relay',
            atMs: 11,
            lease: { ...lease, observedPath: 'relay' },
        });

        expect(profiles.getActiveServerSnapshot()).toBe(publishedSnapshot);
    });
});
