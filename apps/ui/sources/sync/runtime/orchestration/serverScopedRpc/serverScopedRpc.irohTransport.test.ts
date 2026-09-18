import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Composed transport authority gate: a non-focused Iroh-only Home must serve scoped
 * HTTP and Socket.IO/RPC through its verified loopback runtime origin while stable
 * identity, auth audience, and reachability stay keyed by the canonical Home URL.
 * Fail-closed Iroh verification failures never degrade to another carrier; pure
 * availability failures may fall back only to a descriptor-proven HTTPS endpoint.
 */

const TOKEN_B = `hdr.${btoa(JSON.stringify({ sub: 'account-b' }))}.sig`;

const acquireIrohSpy = vi.hoisted(() => vi.fn());
const releaseLeaseSpy = vi.hoisted(() => vi.fn(async () => {}));
const listServerProfilesSpy = vi.hoisted(() => vi.fn());
const getActiveServerSnapshotSpy = vi.hoisted(() => vi.fn());
const runtimeFetchSpy = vi.hoisted(() => vi.fn());
const ioSpy = vi.hoisted(() => vi.fn());

type ServerProfileRecord = Record<string, unknown> & { id: string };

function buildIrohOnlyProfile(overrides: Record<string, unknown> = {}): ServerProfileRecord {
    return {
        id: 'srv_home_b',
        name: 'Home B',
        serverUrl: 'http://127.0.0.1:3010',
        canonicalServerUrl: 'http://127.0.0.1:3010',
        serverIdentityId: 'srv_home_b',
        legacyServerIds: [],
        createdAt: 0,
        updatedAt: 0,
        lastUsedAt: 0,
        homeConnectionDescriptor: {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://127.0.0.1:3010',
            revision: 3,
            endpoints: [{ kind: 'iroh', endpointId: 'ep-home-b', relayUrls: ['https://relay.example.test'] }],
        },
        ...overrides,
    } as ServerProfileRecord;
}

let irohProfile: ServerProfileRecord | null = buildIrohOnlyProfile();

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async (serverUrl: string) => (
            serverUrl === 'http://127.0.0.1:3010' ? { token: TOKEN_B, secret: 'secret-b' } : null
        )),
    },
    subscribeHomeCredentialMutations: () => () => {},
    isTokenOnlyAuthCredentials: (credentials: unknown) => (
        Boolean(credentials && typeof credentials === 'object' && !('secret' in credentials) && !('encryption' in credentials))
    ),
    isLegacyAuthCredentials: (credentials: unknown) => (
        Boolean(credentials && typeof credentials === 'object' && typeof (credentials as { secret?: unknown }).secret === 'string')
    ),
    isDataKeyAuthCredentials: () => false,
}));

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: vi.fn(async () => null),
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    const base = createServerProfilesModuleMock({
        listServerProfiles: (...args: unknown[]) => listServerProfilesSpy(...args),
    });
    return {
        ...base,
        loadHomeViewState: () => null,
        getServerProfileById: (id: unknown) => (
            irohProfile && String(id) === irohProfile.id ? irohProfile : base.getServerProfileById(String(id))
        ),
    };
});

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: (...args: unknown[]) => getActiveServerSnapshotSpy(...args),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/runtime/nativeIrohTunnels/runtime')>();
    return {
        ...actual,
        acquireIrohHomeRuntimeOrigin: (...args: unknown[]) => acquireIrohSpy(...args),
    };
});

vi.mock('socket.io-client', () => ({
    io: (...args: unknown[]) => ioSpy(...args),
}));

vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchSpy(...args),
}));

const LEASE_RUNTIME_ORIGIN = 'http://127.0.0.1:43111';

function mockVerifiedLease(): void {
    acquireIrohSpy.mockResolvedValue({
        leaseId: 'lease-home-b',
        localUrl: LEASE_RUNTIME_ORIGIN,
        runtimeOrigin: LEASE_RUNTIME_ORIGIN,
        homeServerIdentityId: 'srv_home_b',
        endpointId: 'ep-home-b',
        carrier: 'iroh',
        observedPath: 'direct',
        status: 'ready',
        release: releaseLeaseSpy,
    });
}

function createFakeSocket() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const socket = {
        connected: false,
        id: 'socket-1',
        on: (event: string, handler: (...args: unknown[]) => void) => {
            const bucket = listeners.get(event) ?? new Set();
            bucket.add(handler);
            listeners.set(event, bucket);
            return socket;
        },
        off: (event: string, handler?: (...args: unknown[]) => void) => {
            if (!handler) {
                listeners.delete(event);
                return socket;
            }
            listeners.get(event)?.delete(handler);
            return socket;
        },
        onAny: vi.fn(),
        emit: vi.fn((event: string, ...args: unknown[]) => {
            for (const handler of listeners.get(event) ?? []) handler(...args);
        }),
        connect: vi.fn(() => {
            socket.connected = true;
            for (const handler of listeners.get('connect') ?? []) handler();
        }),
        disconnect: vi.fn(() => {
            socket.connected = false;
            for (const handler of listeners.get('disconnect') ?? []) handler('io client disconnect');
        }),
        timeout: () => ({
            emitWithAck: async () => ({ ok: true, result: { watched: true } }),
        }),
        emitWithAck: async () => ({ ok: true, result: { watched: true } }),
    };
    return socket;
}

async function primeReachabilityOnline(serverUrl: string): Promise<void> {
    const { peekServerReachabilityState, waitForServerReachable } = await import(
        '@/sync/runtime/connectivity/serverReachabilitySupervisorPool'
    );
    await waitForServerReachable({ serverUrl, token: TOKEN_B, timeoutMs: 5_000 });
    await vi.waitFor(() => {
        expect(peekServerReachabilityState(serverUrl)?.phase).toBe('online');
    });
}

describe('scoped transport authority for non-focused Iroh Homes', () => {
    afterEach(async () => {
        vi.useRealTimers();
        acquireIrohSpy.mockReset();
        releaseLeaseSpy.mockClear();
        listServerProfilesSpy.mockReset();
        getActiveServerSnapshotSpy.mockReset();
        runtimeFetchSpy.mockReset();
        ioSpy.mockReset();
        irohProfile = buildIrohOnlyProfile();
        try {
            const { resetServerReachabilitySupervisors, setServerReachabilityNetworkAllowed } = await import(
                '@/sync/runtime/connectivity/serverReachabilitySupervisorPool'
            );
            setServerReachabilityNetworkAllowed(true);
            await resetServerReachabilitySupervisors();
        } catch {
            // ignore
        }
    });

    it('resolves the scoped context with a verified Iroh runtime origin and release ownership', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([]);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        mockVerifiedLease();

        const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
        const context = await resolveServerAccountRequestContext({ serverId: 'srv_home_b' });

        expect(context.scope).toBe('scoped');
        if (context.scope !== 'scoped') return;
        expect(acquireIrohSpy).toHaveBeenCalledWith({
            homeServerIdentityId: 'srv_home_b',
            endpoint: { kind: 'iroh', endpointId: 'ep-home-b', relayUrls: ['https://relay.example.test'] },
            canonicalServerUrl: 'http://127.0.0.1:3010',
            verification: { kind: 'authenticated', token: TOKEN_B },
        });
        expect(context.runtimeOrigin).toBe(LEASE_RUNTIME_ORIGIN);
        expect(context.carrier).toBe('iroh');
        // Release ownership is explicit and idempotent; the verified origin rides the context.
        await Promise.all([context.release?.(), context.release?.()]);
        expect(releaseLeaseSpy).toHaveBeenCalledTimes(1);
    });

    it('fails closed when Iroh verification rejects the Home identity', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        acquireIrohSpy.mockRejectedValue(
            Object.assign(new Error('identity mismatch'), { name: 'IrohError', code: 'identity_mismatch' }),
        );

        const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
        await expect(resolveServerAccountRequestContext({ serverId: 'srv_home_b' }))
            .rejects.toMatchObject({ name: 'IrohError', code: 'identity_mismatch' });
        expect(runtimeFetchSpy).not.toHaveBeenCalled();
    });

    it('reports typed transport unavailability when pure Iroh unavailability has no independent HTTPS ingress', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        acquireIrohSpy.mockRejectedValue(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );

        const { resolveServerAccountRequestContext, ServerScopedTransportUnavailableError } = await import(
            './resolveServerAccountRequestContext'
        );
        await expect(resolveServerAccountRequestContext({ serverId: 'srv_home_b' }))
            .rejects.toBeInstanceOf(ServerScopedTransportUnavailableError);
    });

    it('falls back to a descriptor-proven independent HTTPS endpoint after pure Iroh unavailability', async () => {
        irohProfile = buildIrohOnlyProfile({
            homeConnectionDescriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'http://127.0.0.1:3010',
                revision: 3,
                endpoints: [
                    { kind: 'iroh', endpointId: 'ep-home-b', relayUrls: ['https://relay.example.test'] },
                    { kind: 'https', url: ' HTTPS://Home-B.Example.test:443/api///?token=secret#fragment ' },
                ],
            },
        });
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        acquireIrohSpy.mockRejectedValue(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );

        const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
        const context = await resolveServerAccountRequestContext({ serverId: 'srv_home_b' });
        if (context.scope !== 'scoped') {
            throw new Error('expected scoped context');
        }
        expect(context.runtimeOrigin).toBe('https://home-b.example.test/api');
        expect(context.carrier).toBe('https');
    });

    it('serves scoped session RPC for a non-focused Iroh-only Home through the verified loopback origin', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([irohProfile]);
        mockVerifiedLease();
        runtimeFetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/v1/auth/ping') || url.endsWith('/health')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200, headers: new Headers() });
            }
            if (url.includes('/v2/sessions/session-1')) {
                return new Response(JSON.stringify({
                    session: {
                        id: 'session-1',
                        seq: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        active: true,
                        activeAt: 1,
                        archivedAt: null,
                        metadata: 'metadata',
                        metadataVersion: 1,
                        agentState: null,
                        agentStateVersion: 0,
                        pendingCount: 0,
                        pendingVersion: 0,
                        encryptionMode: 'plain',
                        dataEncryptionKey: null,
                    },
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: new Headers() });
        });
        const fakeSocket = createFakeSocket();
        ioSpy.mockReturnValue(fakeSocket);

        await primeReachabilityOnline('http://127.0.0.1:3010');

        const { resetScopedSessionDataKeyCacheForTests } = await import('./resolveScopedSessionDataKey');
        const { sessionRpcWithServerScope } = await import('./serverScopedSessionRpc');
        await expect(sessionRpcWithServerScope({
            sessionId: 'session-1',
            serverId: 'srv_home_b',
            method: 'session.permission.remote.grants.list',
            payload: { sessionId: 'session-1' },
            timeoutMs: 5_000,
        })).resolves.toEqual({ watched: true });

        // The scoped socket connects to the verified loopback origin, never the canonical URL.
        expect(ioSpy).toHaveBeenCalledTimes(1);
        expect(ioSpy.mock.calls[0]?.[0]).toBe(LEASE_RUNTIME_ORIGIN);
        // The operation releases its verified lease through the context's release ownership.
        await vi.waitFor(() => {
            expect(releaseLeaseSpy).toHaveBeenCalledTimes(1);
        });
        resetScopedSessionDataKeyCacheForTests();
    });

    it('serves scoped HTTP for a non-focused Iroh-only Home through the verified loopback origin', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([irohProfile]);
        mockVerifiedLease();
        const responseBody = JSON.stringify({ ok: true });
        const sourceResponse = new Response(responseBody, { status: 200, headers: new Headers() });
        const readBodySpy = vi.spyOn(sourceResponse, 'arrayBuffer');
        runtimeFetchSpy.mockResolvedValue(sourceResponse);

        const { createServerRequestWithServerScope } = await import('./createServerRequestWithServerScope');
        const request = await createServerRequestWithServerScope({
            serverId: 'srv_home_b',
            activeRequest: async () => new Response('{}', { status: 200 }),
        });
        const response = await request('/v1/example', { method: 'GET' });
        expect(response.status).toBe(200);
        expect(readBodySpy).toHaveBeenCalledTimes(1);
        await expect(response.json()).resolves.toEqual({ ok: true });

        // Request bytes ride the verified origin; canonical identity is never a transport target.
        const requestUrls = runtimeFetchSpy.mock.calls.map(([input]) => String(input));
        expect(requestUrls.some((url) => url.startsWith(`${LEASE_RUNTIME_ORIGIN}/v1/example`))).toBe(true);
        expect(requestUrls.some((url) => url.startsWith('http://127.0.0.1:3010/v1/example'))).toBe(false);
        await vi.waitFor(() => {
            expect(releaseLeaseSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('mints a peer-route grant for a non-focused Iroh-only Home through the verified loopback origin', async () => {
        const clientEndpointId = 'a'.repeat(64);
        const machineEndpointId = 'b'.repeat(64);
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([irohProfile]);
        mockVerifiedLease();
        runtimeFetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/v1/auth/ping') || url.endsWith('/health')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            const request = JSON.parse(String(init?.body)) as { ephemeralPublicKeyBase64Url: string };
            return new Response(JSON.stringify({
                ok: true,
                grant: {
                    payload: {
                        v: 2,
                        grantId: 'grant-v2',
                        accountId: 'account-b',
                        machineId: 'machine-b',
                        flowKind: 'bounded_transfer',
                        routeKind: 'iroh_peer',
                        scope: { kind: 'bounded_transfer', mode: 'carrier' },
                        iat: 1_000,
                        exp: 301_000,
                        aud: 'happier-daemon-route-grant',
                        endpointFingerprint: machineEndpointId,
                        proofKind: 'ephemeral_ed25519',
                        ephemeralPublicKeyBase64Url: request.ephemeralPublicKeyBase64Url,
                        iroh: {
                            initiator: { kind: 'account_client', endpointId: clientEndpointId },
                            target: { machineId: 'machine-b', endpointId: machineEndpointId },
                            operationKind: 'finite_transfer',
                        },
                    },
                    signature: {
                        keyId: 'key-1',
                        alg: 'Ed25519',
                        valueBase64Url: Buffer.from(new Uint8Array(64).fill(4)).toString('base64url'),
                    },
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });

        const { requestPeerRouteGrantV2 } = await import(
            '@/sync/domains/machines/peer/mediation/stream/productionRouteHttp'
        );
        const { createServerRequestWithServerScope } = await import(
            './createServerRequestWithServerScope'
        );
        const result = await requestPeerRouteGrantV2({
            authority: {
                request: createServerRequestWithServerScope({
                    serverId: 'srv_home_b',
                    activeRequest: async () => {
                        throw new Error('non-focused grant must not use active request');
                    },
                }),
            },
            request: {
                v: 2,
                kind: 'ephemeral_ed25519',
                ephemeralPublicKeyBase64Url: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
                machineId: 'machine-b',
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
                endpointFingerprint: machineEndpointId,
                ttlMs: 300_000,
                scope: { kind: 'bounded_transfer', mode: 'carrier' },
                iroh: {
                    initiator: { kind: 'account_client', endpointId: clientEndpointId },
                    target: { machineId: 'machine-b', endpointId: machineEndpointId },
                    operationKind: 'finite_transfer',
                },
            },
            timeoutMs: 5_000,
        });

        expect(result).toMatchObject({ ok: true, value: { payload: { grantId: 'grant-v2' } } });
        const requestUrls = runtimeFetchSpy.mock.calls.map(([input]) => String(input));
        expect(requestUrls).toContain(`${LEASE_RUNTIME_ORIGIN}/v1/machines/peer/mediation/route-grants`);
        expect(requestUrls).not.toContain('http://127.0.0.1:3010/v1/machines/peer/mediation/route-grants');
        await vi.waitFor(() => expect(releaseLeaseSpy).toHaveBeenCalledTimes(1));
    });

    it('releases the Iroh lease when machine preparation fails before socket acquisition', async () => {
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([irohProfile]);
        mockVerifiedLease();
        runtimeFetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/v1/auth/ping') || url.endsWith('/health')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            return new Response(JSON.stringify({ machine: null }), { status: 200 });
        });

        const { machineRpcWithServerScope } = await import('./serverScopedMachineRpc');
        await expect(machineRpcWithServerScope({
            serverId: 'srv_home_b',
            machineId: 'machine-1',
            method: 'machine.test',
            payload: {},
            timeoutMs: 5_000,
            onIssued: vi.fn(),
        })).rejects.toThrow('Machine encryption not found');

        expect(ioSpy).not.toHaveBeenCalled();
        expect(releaseLeaseSpy).toHaveBeenCalledTimes(1);
    });

    it('releases the Iroh lease when the caller aborts during scoped context acquisition', async () => {
        const controller = new AbortController();
        getActiveServerSnapshotSpy.mockReturnValue({
            serverId: 'srv_home_a',
            serverUrl: 'https://home-a.example.test',
            generation: 1,
        });
        listServerProfilesSpy.mockReturnValue([irohProfile]);
        acquireIrohSpy.mockImplementation(async () => {
            controller.abort();
            return {
                leaseId: 'lease-home-b',
                localUrl: LEASE_RUNTIME_ORIGIN,
                runtimeOrigin: LEASE_RUNTIME_ORIGIN,
                homeServerIdentityId: 'srv_home_b',
                endpointId: 'ep-home-b',
                carrier: 'iroh',
                observedPath: 'direct',
                status: 'ready',
                release: releaseLeaseSpy,
            };
        });

        const { machineRpcWithServerScope } = await import('./serverScopedMachineRpc');
        await expect(machineRpcWithServerScope({
            serverId: 'srv_home_b',
            machineId: 'machine-1',
            method: 'machine.test',
            payload: {},
            timeoutMs: 5_000,
            signal: controller.signal,
            onIssued: vi.fn(),
        })).rejects.toMatchObject({ name: 'AbortError', code: 'MACHINE_RPC_ABORTED' });

        expect(ioSpy).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(releaseLeaseSpy).toHaveBeenCalledTimes(1);
        });
    });
});
