import { afterEach, describe, expect, it, vi } from 'vitest';

import { IrohError } from '@happier-dev/iroh-native';

function createIrohRuntimeMock() {
    return {
        getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        ensureHomeTunnel: vi.fn(async () => ({
            leaseId: 'iroh-home:test',
            key: 'test',
            remoteHostId: 'srv_home_a',
            localUrl: 'http://127.0.0.1:46101',
            channelMode: 'loopback-port',
            purpose: 'home',
            status: 'ready',
            startedAt: '2026-08-30T00:00:00.000Z',
            homeServerIdentityId: 'srv_home_a',
            endpointId: 'endpoint-a',
            carrier: 'iroh',
            observedPath: 'direct',
        })),
        releaseHomeTunnel: vi.fn(async () => undefined),
        releaseActiveHomeTunnels: vi.fn(async () => undefined),
        releaseLeasesForStaleTargets: vi.fn(async () => undefined),
        markSuspended: vi.fn(),
        markForeground: vi.fn(async () => undefined),
        listTunnels: vi.fn(() => ({ leases: [], platformLimitations: [] })),
        subscribeRecoveryRequired: vi.fn((listener: typeof recoveryRequiredListener) => {
            recoveryRequiredListener = listener;
            return () => {
                if (recoveryRequiredListener === listener) recoveryRequiredListener = null;
            };
        }),
    };
}

const irohRuntimeMock = createIrohRuntimeMock();

const startLifecycleSpy = vi.fn();
const publishActiveServerRuntimeOriginSpy = vi.fn(() => true);
let recoveryRequiredListener: ((event: Readonly<{
    leaseId: string;
    homeServerIdentityId: string;
    reason: 'terminal' | 'foreground_probe_failed';
    activePublication: boolean;
}>) => void) | null = null;

function mockActiveSnapshot(snapshot: Record<string, unknown>): void {
    vi.doMock('@/sync/domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: () => snapshot,
        captureActiveServerRuntimeTarget: () => ({
            serverId: String(snapshot.serverId ?? ''),
            generation: Number(snapshot.generation ?? 0),
        }),
        getActiveServerHomeCarrier: () => undefined,
        publishActiveServerRuntimeOrigin: publishActiveServerRuntimeOriginSpy,
        releaseActiveServerRuntimeOrigin: vi.fn(),
    }));
}

function buildExactIrohProfileFixture(profile: Record<string, unknown>): Record<string, unknown> {
    if (!profile.irohEndpoint) return profile;
    const canonicalServerUrl = String(profile.canonicalServerUrl ?? profile.serverUrl ?? '');
    const publicServerUrl = typeof profile.publicServerUrl === 'string' && profile.publicServerUrl.trim()
        ? (() => {
            const url = new URL(profile.publicServerUrl.trim());
            url.search = '';
            url.hash = '';
            return url.toString().replace(/\/+$/u, '');
        })()
        : null;
    return {
        ...profile,
        canonicalServerUrl,
        homeConnectionDescriptor: {
            v: 1,
            homeServerIdentityId: String(profile.serverIdentityId ?? ''),
            canonicalServerUrl,
            revision: Number(profile.connectionDescriptorRevision ?? 1),
            endpoints: [
                ...(publicServerUrl ? [{ kind: 'https', url: publicServerUrl }] : []),
                { kind: 'iroh', ...(profile.irohEndpoint as Record<string, unknown>) },
            ],
        },
    };
}

function mockProfile(profile: Record<string, unknown> | null): void {
    const normalizedProfile = profile ? buildExactIrohProfileFixture(profile) : null;
    vi.doMock('@/sync/domains/server/serverProfiles', () => ({
        getServerProfileById: (_id: string) => normalizedProfile,
    }));
}

function mockTokenStorage(credentials: { token: string; secret: string } | null): void {
    vi.doMock('@/auth/storage/tokenStorage', () => ({
        TokenStorage: {
            getCredentials: vi.fn(async () => credentials),
            getCredentialsForServerUrl: vi.fn(async () => credentials),
        },
    }));
}

function mockSyncInfra(): {
    syncSwitchServer: ReturnType<typeof vi.fn>;
    retryNow: ReturnType<typeof vi.fn>;
    abortServerFetches: ReturnType<typeof vi.fn>;
} {
    const syncSwitchServer = vi.fn(async (
        _credentials: { token: string; secret: string } | null,
        _target?: Readonly<{ serverId: string; serverUrl: string; generation: number }>,
    ) => {});
    const retryNow = vi.fn();
    const abortServerFetches = vi.fn();
    vi.doMock('@/sync/sync', () => ({ syncSwitchServer, sync: { retryNow } }));
    vi.doMock('@/sync/http/client', () => ({ abortServerFetches }));
    return { syncSwitchServer, retryNow, abortServerFetches };
}

describe('switchConnectionToActiveServer Iroh lease acquisition', () => {
    afterEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        irohRuntimeMock.ensureHomeTunnel.mockClear();
        irohRuntimeMock.releaseLeasesForStaleTargets.mockClear();
        irohRuntimeMock.releaseActiveHomeTunnels.mockClear();
        startLifecycleSpy.mockClear();
        publishActiveServerRuntimeOriginSpy.mockClear();
        recoveryRequiredListener = null;
    });

    it('acquires and verifies the Iroh lease for an Iroh Home before syncSwitchServer', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'https://iroh-home.example.test',
            kind: 'custom',
            generation: 42,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'https://iroh-home.example.test',
            irohEndpoint: { endpointId: 'endpoint-a', relayUrls: ['https://relay.example.test'] },
            connectionDescriptorRevision: 7,
        });
        mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(irohRuntimeMock.ensureHomeTunnel).toHaveBeenCalledTimes(1);
        expect(irohRuntimeMock.ensureHomeTunnel).toHaveBeenCalledWith({
            homeServerIdentityId: 'srv_home_a',
            endpoint: { kind: 'iroh', endpointId: 'endpoint-a', relayUrls: ['https://relay.example.test'] },
            canonicalServerUrl: 'https://iroh-home.example.test',
            verification: { kind: 'authenticated', token: 'scoped-token' },
        });
        expect(startLifecycleSpy).toHaveBeenCalled();
        // The verified lease exists before the sync switch so HTTP and Socket.IO
        // resolve the published runtime origin for this same active generation.
        expect(irohRuntimeMock.ensureHomeTunnel.mock.invocationCallOrder[0])
            .toBeLessThan(syncSwitchServer.mock.invocationCallOrder[0]);
        expect(irohRuntimeMock.releaseLeasesForStaleTargets).not.toHaveBeenCalled();
        expect(syncSwitchServer).toHaveBeenCalledWith(
            { token: 'scoped-token', secret: 'scoped-secret' },
            expect.objectContaining({
                serverId: 'srv_home_a',
                serverUrl: 'https://iroh-home.example.test',
                generation: 42,
            }),
        );
    });

    it.each(['terminal', 'foreground_probe_failed'] as const)(
        'reacquires a dead focused lease through the one active-connection retry owner for %s recovery',
        async (reason) => {
            mockActiveSnapshot({
                serverId: 'srv_home_a',
                serverUrl: 'https://iroh-home.example.test',
                kind: 'custom',
                generation: 42,
            });
            mockProfile({
                id: 'profile-a',
                serverIdentityId: 'srv_home_a',
                serverUrl: 'https://iroh-home.example.test',
                irohEndpoint: { endpointId: 'endpoint-a' },
                connectionDescriptorRevision: 7,
            });
            mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
            const { syncSwitchServer, retryNow } = mockSyncInfra();
            vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
                getIrohHomeTunnelRuntime: () => irohRuntimeMock,
            }));
            vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
                startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
            }));

            const { switchConnectionToActiveServer } = await import('./connectionManager');
            await switchConnectionToActiveServer();
            irohRuntimeMock.ensureHomeTunnel.mockClear();
            syncSwitchServer.mockClear();

            recoveryRequiredListener?.({
                leaseId: 'iroh-home:test',
                homeServerIdentityId: 'srv_home_a',
                reason,
                activePublication: true,
            });

            await vi.waitFor(() => expect(irohRuntimeMock.ensureHomeTunnel).toHaveBeenCalledTimes(1));
            expect(retryNow).toHaveBeenCalledTimes(1);
            expect(syncSwitchServer).not.toHaveBeenCalled();
        },
    );

    it('acquires and verifies the Iroh lease before cold restore initializes Sync', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            generation: 42,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            irohEndpoint: { endpointId: 'endpoint-a' },
            connectionDescriptorRevision: 7,
        });
        const credentials = { token: 'scoped-token', secret: 'scoped-secret' };
        mockTokenStorage(credentials);
        const { syncSwitchServer } = mockSyncInfra();
        const syncRestore = vi.fn(async () => undefined);
        vi.doMock('@/sync/sync', () => ({ syncSwitchServer, syncRestore }));
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { restoreConnectionToActiveServer } = await import('./connectionManager');
        await restoreConnectionToActiveServer(credentials);

        expect(irohRuntimeMock.ensureHomeTunnel.mock.invocationCallOrder[0])
            .toBeLessThan(syncRestore.mock.invocationCallOrder[0]);
        expect(syncRestore).toHaveBeenCalledWith(
            credentials,
            expect.objectContaining({
                serverId: 'srv_home_a',
                serverUrl: 'http://127.0.0.1:3010',
                generation: 42,
            }),
        );
        expect(syncSwitchServer).not.toHaveBeenCalled();
    });

    it('keeps a non-Iroh Home on the established path and releases stale Iroh leases', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_plain',
            serverUrl: 'https://plain.example.test',
            kind: 'custom',
            generation: 8,
        });
        mockProfile({
            id: 'profile-plain',
            serverIdentityId: 'srv_home_plain',
            serverUrl: 'https://plain.example.test',
        });
        mockTokenStorage({ token: 'plain-token', secret: 'plain-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(irohRuntimeMock.ensureHomeTunnel).not.toHaveBeenCalled();
        expect(startLifecycleSpy).not.toHaveBeenCalled();
        expect(irohRuntimeMock.releaseLeasesForStaleTargets).toHaveBeenCalledTimes(1);
        expect(syncSwitchServer).toHaveBeenCalledWith(
            { token: 'plain-token', secret: 'plain-secret' },
            expect.objectContaining({
                serverId: 'srv_home_plain',
                serverUrl: 'https://plain.example.test',
                generation: 8,
            }),
        );
    });

    // Lane-06 fallback matrix: identity, auth, descriptor/integrity, protocol
    // (ALPN/preamble), endpoint-config, and stale-target failures must fail
    // closed so the stale/unsafe target never reaches `syncSwitchServer`.
    const failClosedFailures: ReadonlyArray<Readonly<{ name: string; failure: unknown }>> = [
        { name: 'authenticated ping denial', failure: new Error('iroh_home_tunnel_probe_failed:auth-failed') },
        { name: 'probe identity mismatch', failure: new Error('iroh_home_tunnel_probe_failed:identity-mismatch') },
        { name: 'unverified identity (features probe unavailable)', failure: new Error('iroh_home_tunnel_probe_failed:features-unavailable') },
        { name: 'native identity mismatch', failure: new IrohError('identity_mismatch', 'native lease does not match the requested Home identity') },
        { name: 'invalid descriptor', failure: new IrohError('invalid_descriptor', 'descriptor rejected') },
        { name: 'invalid preamble', failure: new IrohError('invalid_preamble', 'bad preamble byte') },
        { name: 'unsupported ALPN', failure: new IrohError('unsupported_alpn', 'ALPN rejected') },
        { name: 'endpoint config conflict', failure: new IrohError('endpoint_config_conflict', 'endpoint config conflict') },
        { name: 'invalid endpoint input', failure: new Error('iroh_home_tunnel_invalid_endpoint') },
        { name: 'stale generation', failure: new Error('iroh_home_tunnel_stale_generation') },
        { name: 'stale focus', failure: new Error('iroh_home_tunnel_stale_focus') },
        { name: 'relay auth or unknown native failure', failure: new Error('iroh relay admission rejected') },
    ];

    it.each(failClosedFailures)('fails closed on $name and never switches to the unsafe target', async ({ failure }) => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'https://iroh-fail.example.test',
            kind: 'custom',
            generation: 9,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'https://iroh-fail.example.test',
            irohEndpoint: { endpointId: 'endpoint-a' },
            connectionDescriptorRevision: 2,
        });
        mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        const ensureHomeTunnel = vi.fn(async () => {
            throw failure;
        });
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => ({
                ...irohRuntimeMock,
                ensureHomeTunnel,
            }),
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await expect(switchConnectionToActiveServer()).rejects.toBe(failure);

        expect(ensureHomeTunnel).toHaveBeenCalledTimes(1);
        expect(syncSwitchServer).not.toHaveBeenCalled();
    });

    // Transport/native availability and bounded health-reachability failures are
    // the only classes that may hand the switch to descriptor-proven HTTPS ingress.
    const fallbackAllowedFailures: ReadonlyArray<Readonly<{ name: string; failure: unknown }>> = [
        { name: 'native unavailability', failure: new IrohError('unavailable', 'Native Iroh transport is unavailable.') },
        { name: 'native transport loss', failure: new IrohError('transport', 'transport closed') },
        { name: 'health unreachability', failure: new Error('iroh_home_tunnel_probe_failed:health-unavailable') },
        { name: 'bounded probe timeout', failure: new Error('iroh_home_tunnel_probe_failed:probe-timeout') },
        { name: 'suspended runtime', failure: new Error('iroh_home_tunnel_suspended') },
    ];

    it.each(fallbackAllowedFailures)('uses descriptor-proven HTTPS ingress for $name', async ({ failure }) => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'https://iroh-fail.example.test',
            kind: 'custom',
            generation: 9,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'https://iroh-fail.example.test',
            publicServerUrl: 'https://public-iroh-fail.example.test',
            irohEndpoint: { endpointId: 'endpoint-a' },
            connectionDescriptorRevision: 2,
        });
        mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        const ensureHomeTunnel = vi.fn(async () => {
            throw failure;
        });
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => ({
                ...irohRuntimeMock,
                ensureHomeTunnel,
            }),
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await expect(switchConnectionToActiveServer()).resolves.toEqual({ token: 'scoped-token', secret: 'scoped-secret' });

        expect(ensureHomeTunnel).toHaveBeenCalledTimes(1);
        expect(syncSwitchServer).toHaveBeenCalledTimes(1);
        expect(syncSwitchServer).toHaveBeenCalledWith(
            { token: 'scoped-token', secret: 'scoped-secret' },
            expect.objectContaining({
                serverId: 'srv_home_a',
                serverUrl: 'https://iroh-fail.example.test',
                generation: 9,
            }),
        );
    });

    it('publishes the canonical independent HTTPS fallback origin', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'https://iroh-fail.example.test',
            kind: 'custom',
            generation: 9,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'https://iroh-fail.example.test',
            publicServerUrl: ' HTTPS://Public.Example.test:443/api///?token=secret#fragment ',
            irohEndpoint: { endpointId: 'endpoint-a' },
            connectionDescriptorRevision: 2,
        });
        mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
        mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => ({
                ...irohRuntimeMock,
                ensureHomeTunnel: vi.fn(async () => {
                    throw new IrohError('unavailable', 'Native Iroh transport is unavailable.');
                }),
            }),
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(publishActiveServerRuntimeOriginSpy).toHaveBeenCalledWith(expect.objectContaining({
            runtimeOrigin: 'https://public.example.test/api',
            carrier: 'https',
        }));
    });

    it('fails typed when Iroh is unavailable and the descriptor proves no independent HTTPS ingress', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            kind: 'custom',
            generation: 10,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            publicServerUrl: null,
            irohEndpoint: { endpointId: 'endpoint-a' },
            connectionDescriptorRevision: 2,
        });
        mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => ({
                ...irohRuntimeMock,
                ensureHomeTunnel: vi.fn(async () => {
                    throw new IrohError('unavailable', 'Native Iroh transport is unavailable.');
                }),
            }),
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await expect(switchConnectionToActiveServer()).rejects.toMatchObject({
            name: 'ServerScopedTransportUnavailableError',
        });
        expect(syncSwitchServer).not.toHaveBeenCalled();
    });

    it('never switches to a stale target while a later explicitly requested current generation switches normally', async () => {
        let generation = 9;
        let ensureOutcome: 'stale' | 'verified' = 'stale';
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'srv_home_a',
                serverUrl: 'https://iroh-stale.example.test',
                kind: 'custom',
                generation,
            }),
            captureActiveServerRuntimeTarget: () => ({
                serverId: 'srv_home_a',
                generation,
            }),
            getActiveServerHomeCarrier: () => undefined,
            publishActiveServerRuntimeOrigin: publishActiveServerRuntimeOriginSpy,
            releaseActiveServerRuntimeOrigin: vi.fn(),
        }));
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'https://iroh-stale.example.test',
            irohEndpoint: { endpointId: 'endpoint-a' },
            connectionDescriptorRevision: 2,
        });
        mockTokenStorage({ token: 'scoped-token', secret: 'scoped-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        const ensureHomeTunnel = vi.fn(async () => {
            if (ensureOutcome === 'stale') throw new Error('iroh_home_tunnel_stale_focus');
            return {
                leaseId: 'iroh-home:test',
                key: 'test',
                remoteHostId: 'srv_home_a',
                localUrl: 'http://127.0.0.1:46103',
                channelMode: 'loopback-port',
                purpose: 'home',
                status: 'ready',
                startedAt: '2026-08-30T00:00:00.000Z',
                homeServerIdentityId: 'srv_home_a',
                endpointId: 'endpoint-a',
                carrier: 'iroh',
                observedPath: 'direct',
            };
        });
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => ({
                ...irohRuntimeMock,
                ensureHomeTunnel,
            }),
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');

        // The stale/unsafe target is rejected before `syncSwitchServer` runs.
        await expect(switchConnectionToActiveServer()).rejects.toThrow('iroh_home_tunnel_stale_focus');
        expect(syncSwitchServer).not.toHaveBeenCalled();

        // A later explicit request for the now-current generation runs through
        // the normal owner path; no switch retry machinery exists or is needed.
        ensureOutcome = 'verified';
        generation = 10;
        await expect(switchConnectionToActiveServer()).resolves.toEqual({ token: 'scoped-token', secret: 'scoped-secret' });
        expect(syncSwitchServer).toHaveBeenCalledTimes(1);
        expect(syncSwitchServer).toHaveBeenCalledWith(
            { token: 'scoped-token', secret: 'scoped-secret' },
            expect.objectContaining({
                serverId: 'srv_home_a',
                serverUrl: 'https://iroh-stale.example.test',
                generation: 10,
            }),
        );
    });

    it('does not acquire or retry through Home A after focus changes while its credentials are loading', async () => {
        let activeSnapshot = {
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            kind: 'custom',
            generation: 11,
        };
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => activeSnapshot,
            captureActiveServerRuntimeTarget: () => ({
                serverId: activeSnapshot.serverId,
                generation: activeSnapshot.generation,
            }),
            getActiveServerHomeCarrier: () => undefined,
            publishActiveServerRuntimeOrigin: publishActiveServerRuntimeOriginSpy,
            releaseActiveServerRuntimeOrigin: vi.fn(),
        }));
        vi.doMock('@/sync/domains/server/serverProfiles', () => ({
            getServerProfileById: (serverId: string) => serverId === 'srv_home_a'
                ? buildExactIrohProfileFixture({
                    id: 'profile-a',
                    serverIdentityId: 'srv_home_a',
                    serverUrl: 'https://home-a.example.test',
                    irohEndpoint: { endpointId: 'endpoint-a' },
                    connectionDescriptorRevision: 2,
                })
                : buildExactIrohProfileFixture({
                    id: 'profile-b',
                    serverIdentityId: 'srv_home_b',
                    serverUrl: 'https://home-b.example.test',
                    irohEndpoint: { endpointId: 'endpoint-b' },
                    connectionDescriptorRevision: 1,
                }),
        }));
        let resolveCredentials: ((value: { token: string; secret: string }) => void) | null = null;
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentialsForServerUrl: vi.fn(async () => await new Promise((resolve) => {
                    resolveCredentials = resolve;
                })),
            },
        }));
        const { retryNow } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { retryActiveServerConnection } = await import('./connectionManager');
        const retry = retryActiveServerConnection();
        await vi.waitFor(() => expect(resolveCredentials).toBeTypeOf('function'));
        activeSnapshot = {
            serverId: 'srv_home_b',
            serverUrl: 'https://home-b.example.test',
            kind: 'custom',
            generation: 12,
        };
        resolveCredentials!({ token: 'token-a', secret: 'secret-a' });

        await expect(retry).resolves.toBeUndefined();
        expect(irohRuntimeMock.ensureHomeTunnel).not.toHaveBeenCalled();
        expect(publishActiveServerRuntimeOriginSpy).not.toHaveBeenCalled();
        expect(retryNow).not.toHaveBeenCalled();
    });

    it('does not acquire Iroh without an endpoint-scoped credential to verify with', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'https://iroh-noauth.example.test',
            kind: 'custom',
            generation: 10,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'https://iroh-noauth.example.test',
            irohEndpoint: { endpointId: 'endpoint-a' },
        });
        mockTokenStorage(null);
        const { syncSwitchServer } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(irohRuntimeMock.ensureHomeTunnel).not.toHaveBeenCalled();
        expect(startLifecycleSpy).not.toHaveBeenCalled();
        expect(syncSwitchServer).toHaveBeenCalledTimes(1);
    });

    it('releases the focused Iroh publication before disconnecting Sync', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            generation: 10,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            irohEndpoint: { endpointId: 'endpoint-a' },
        });
        mockTokenStorage(null);
        const { syncSwitchServer } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(irohRuntimeMock.releaseActiveHomeTunnels).toHaveBeenCalledTimes(1);
        expect(irohRuntimeMock.releaseActiveHomeTunnels.mock.invocationCallOrder[0])
            .toBeLessThan(syncSwitchServer.mock.invocationCallOrder[0]);
        expect(syncSwitchServer).toHaveBeenCalledWith(
            null,
            expect.objectContaining({
                serverId: 'srv_home_a',
                serverUrl: 'http://127.0.0.1:3010',
                generation: 10,
            }),
        );
    });

    it('disconnects explicitly after first-key authority is cleared even while recovery storage retains credentials', async () => {
        mockActiveSnapshot({
            serverId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            generation: 11,
        });
        mockProfile({
            id: 'profile-a',
            serverIdentityId: 'srv_home_a',
            serverUrl: 'http://127.0.0.1:3010',
            irohEndpoint: { endpointId: 'endpoint-a' },
        });
        mockTokenStorage({ token: 'recovery-custody-token', secret: 'recovery-secret' });
        const { syncSwitchServer } = mockSyncInfra();
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
            getIrohHomeTunnelRuntime: () => irohRuntimeMock,
        }));
        vi.doMock('@/sync/runtime/nativeSshTunnels/runtime', () => ({
            startNativeSshTunnelRuntimeAppStateLifecycle: startLifecycleSpy,
        }));

        const { disconnectActiveServerConnection } = await import('./connectionManager');
        await disconnectActiveServerConnection();

        expect(irohRuntimeMock.ensureHomeTunnel).not.toHaveBeenCalled();
        expect(irohRuntimeMock.releaseActiveHomeTunnels).toHaveBeenCalledTimes(1);
        expect(irohRuntimeMock.releaseActiveHomeTunnels.mock.invocationCallOrder[0])
            .toBeLessThan(syncSwitchServer.mock.invocationCallOrder[0]);
        expect(syncSwitchServer).toHaveBeenCalledWith(null);
    });
});
