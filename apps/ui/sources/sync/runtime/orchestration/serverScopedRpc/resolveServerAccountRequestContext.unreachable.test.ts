import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An unreachable Home must settle the request context. The Home carrier is the network boundary: it
 * is held open here the way a dial to a Home that never answers is. The reachability signal is the
 * real one the rest of the app reads for this Home (the connection supervisor's endpoint status in
 * the realtime store), not a timer.
 */
const carrier = vi.hoisted(() => ({
    acquire: vi.fn(),
    release: vi.fn(async () => {}),
}));
const active = vi.hoisted(() => ({ serverId: 'srv_home', serverUrl: 'https://home.example.test' }));

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub })).replaceAll('=', '');
    return `e30.${payload}.signature`;
}

// Secure storage is the boundary for this Home's saved sign-in; the rest of the module stays real.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getCredentialsForServerUrl: async () => ({ token: tokenForSub('account-a') }),
        },
        isTokenOnlyAuthCredentials: () => true,
    };
});

vi.mock('@/sync/runtime/homeCarrierPolicy', () => ({
    acquireEligibleHomeCarrier: (...args: unknown[]) => carrier.acquire(...args),
}));

// The saved Home profile (persisted state); the rest of the module stays real.
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    const profile = {
        id: active.serverId,
        serverUrl: active.serverUrl,
        homeConnectionDescriptor: { homeServerIdentityId: active.serverId, canonicalServerUrl: active.serverUrl, endpoints: [] },
    };
    return {
        ...actual,
        getServerProfileById: (id: string) => (id === active.serverId ? profile : null),
        areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    };
});

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerSnapshot: () => ({ serverId: active.serverId, serverUrl: active.serverUrl, generation: 1 }),
    isAppliedActiveServerRuntimeAvailable: () => false,
}));

const { storage } = await import('@/sync/domains/state/storage');
const { resolveServerAccountRequestContext, ServerScopedTransportUnavailableError } = await import('./resolveServerAccountRequestContext');

function setEndpointStatus(status: 'online' | 'offline' | 'connecting') {
    storage.getState().setEndpointConnectivity({
        status,
        reason: null,
        attempt: 0,
        nextRetryAt: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastErrorMessage: null,
    } as never);
}

beforeEach(() => {
    carrier.acquire.mockReset();
    carrier.release.mockClear();
});
afterEach(() => {
    storage.getState().resetEndpointConnectivity();
});

describe('resolveServerAccountRequestContext for an unreachable Home', () => {
    it('settles with the typed unavailable failure when the active Home is known to be unreachable', async () => {
        setEndpointStatus('offline');
        carrier.acquire.mockImplementation(() => new Promise(() => {}));

        await expect(resolveServerAccountRequestContext({ serverId: active.serverId, preferScoped: true }))
            .rejects.toBeInstanceOf(ServerScopedTransportUnavailableError);
    });

    it('settles a pending resolution as soon as the Home turns unreachable, and releases a carrier that arrives late', async () => {
        setEndpointStatus('connecting');
        let arrive: ((value: unknown) => void) | null = null;
        carrier.acquire.mockImplementation(() => new Promise((resolve) => { arrive = resolve; }));

        const pending = resolveServerAccountRequestContext({ serverId: active.serverId, preferScoped: true });
        const outcome = pending.then(() => 'resolved', (error: unknown) => error);
        await vi.waitFor(() => expect(carrier.acquire).toHaveBeenCalled());
        setEndpointStatus('offline');
        expect(await outcome).toBeInstanceOf(ServerScopedTransportUnavailableError);

        // The dial finishes after the caller was told it failed: its carrier must not leak.
        (arrive as unknown as (value: unknown) => void)({
            kind: 'native_iroh',
            lease: { runtimeOrigin: 'http://127.0.0.1:1', leaseId: 'lease-1' },
            release: carrier.release,
        });
        await vi.waitFor(() => expect(carrier.release).toHaveBeenCalled());
    });

    it('resolves normally while the Home is reachable', async () => {
        setEndpointStatus('online');
        carrier.acquire.mockResolvedValue({ kind: 'https', runtimeOrigin: active.serverUrl });

        const context = await resolveServerAccountRequestContext({ serverId: active.serverId, preferScoped: true });
        expect(context.scope).toBe('scoped');
    });
});
