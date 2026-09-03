import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = vi.hoisted(() => new Map<string, string>());
const runtimeFetchMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn());
const createEncryptionFromAuthCredentialsMock = vi.hoisted(() => vi.fn());

vi.mock('react-native-mmkv', () => {
    class MMKV {
        getString(key: string) {
            return kvStore.get(key);
        }
        set(key: string, value: string) {
            kvStore.set(key, value);
        }
        delete(key: string) {
            kvStore.delete(key);
        }
        clearAll() {
            kvStore.clear();
        }
    }

    return { MMKV };
});

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: runtimeFetchMock,
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('@/auth/storage/tokenStorage')
    >();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getCredentialsForServerUrl: getCredentialsForServerUrlMock,
        },
    };
});

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
    createEncryptionFromAuthCredentials: createEncryptionFromAuthCredentialsMock,
}));

import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';

import {
    captureSessionRequestAuthorityForServerAccountScope,
    createSessionRequestForResolvedServerScope,
    createSessionRequestWithServerScope,
    resolveSessionRequestForServerAccountScope,
} from './createSessionRequestWithServerScope';

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `e30.${payload}.signature`;
}

function expectHeaderValue(headers: HeadersInit | undefined, key: string, value: string) {
    expect(new Headers(headers).get(key)).toBe(value);
}

describe('createSessionRequestWithServerScope', () => {
    beforeEach(() => {
        kvStore.clear();
        runtimeFetchMock.mockReset();
        getCredentialsForServerUrlMock.mockReset();
        createEncryptionFromAuthCredentialsMock.mockReset();
    });

    it('uses the active request when the target server is already active', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        setActiveServerId(activeServer.id, { scope: 'device' });

        const activeRequest = vi.fn(async () => new Response(null, { status: 200 }));
        const request = createSessionRequestWithServerScope({
            serverId: activeServer.id,
            activeRequest,
        });

        await request('/v1/sessions/s1/messages', { method: 'GET' });

        expect(activeRequest).toHaveBeenCalledWith('/v1/sessions/s1/messages', { method: 'GET' });
        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });

    it('uses runtimeFetch with scoped auth when the target server is not active', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });

        const ownerToken = tokenForSub('owner-account');
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockImplementation(async () => new Response(null, { status: 200, headers: new Headers() }));

        const activeRequest = vi.fn(async () => new Response(null, { status: 200 }));
        const request = createSessionRequestWithServerScope({
            serverId: ownerServer.id,
            activeRequest,
        });

        await request('/v1/sessions/s1/messages?scope=main', { method: 'GET' });

        expect(activeRequest).not.toHaveBeenCalled();
        const call = runtimeFetchMock.mock.calls.find(([input]) =>
            String(input?.url).includes('/v1/sessions/s1/messages?scope=main'));
        expect(call).toBeTruthy();
        expect(call?.[0]?.init).toEqual(expect.objectContaining({ method: 'GET' }));
        expectHeaderValue(call?.[0]?.init?.headers, 'Authorization', `Bearer ${ownerToken}`);
    });

    it('preserves request body and existing headers for non-GET scoped requests', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });

        const ownerToken = tokenForSub('owner-account');
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockImplementation(async () => new Response(null, { status: 200, headers: new Headers() }));

        const activeRequest = vi.fn(async () => new Response(null, { status: 200 }));
        const request = createSessionRequestWithServerScope({
            serverId: ownerServer.id,
            activeRequest,
        });

        await request('/v2/sessions/s1/pending', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Test': '1',
            },
            body: JSON.stringify({ hello: 'world' }),
        });

        expect(activeRequest).not.toHaveBeenCalled();
        const call = runtimeFetchMock.mock.calls.find(([input]) =>
            String(input?.url).includes('/v2/sessions/s1/pending'));
        expect(call).toBeTruthy();
        expect(call?.[0]?.init).toEqual(expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ hello: 'world' }),
        }));
        expectHeaderValue(call?.[0]?.init?.headers, 'Authorization', `Bearer ${ownerToken}`);
        expectHeaderValue(call?.[0]?.init?.headers, 'Content-Type', 'application/json');
        expectHeaderValue(call?.[0]?.init?.headers, 'X-Test', '1');
    });

    it('binds an outbox action request to the exact persisted server and authenticated account', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        const ownerToken = tokenForSub('account-owner');
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

        const authority = await resolveSessionRequestForServerAccountScope({
            scope: { serverId: ownerServer.id, accountId: 'account-owner' },
            activeRequest: async () => { throw new Error('must not substitute active authority'); },
        });
        try {
            await authority.request('/v2/sessions/s1/pending', { method: 'POST', body: 'exact-body' });
        } finally {
            await authority.release();
        }

        const call = runtimeFetchMock.mock.calls.find(([input]) =>
            String(input?.url).includes('/v2/sessions/s1/pending'));
        expect(call).toBeTruthy();
        expect(call?.[0]?.init).toEqual(expect.objectContaining({ body: 'exact-body' }));
        expectHeaderValue(call?.[0]?.init?.headers, 'Authorization', `Bearer ${ownerToken}`);
    });

    it('keeps a same-server request bound to the captured account after stored credentials change', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        const accountAToken = tokenForSub('account-a');
        const accountBToken = tokenForSub('account-b');
        getCredentialsForServerUrlMock.mockResolvedValueOnce({
            token: accountAToken,
            secret: 'account-a-secret',
        });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

        const authority = await captureSessionRequestAuthorityForServerAccountScope({
            scope: { serverId: activeServer.id, accountId: 'account-a' },
            activeRequest: async () => {
                throw new Error('captured account authority must not use the mutable active request');
            },
        });
        getCredentialsForServerUrlMock.mockResolvedValue({
            token: accountBToken,
            secret: 'account-b-secret',
        });

        await authority.request('/v1/sessions/history/messages', { method: 'GET' });

        expect(getCredentialsForServerUrlMock).toHaveBeenCalledTimes(1);
        const call = runtimeFetchMock.mock.calls.find(([input]) =>
            String(input?.url).includes('/v1/sessions/history/messages'));
        expect(call).toBeTruthy();
        expectHeaderValue(call?.[0]?.init?.headers, 'Authorization', `Bearer ${accountAToken}`);
        expect(authority.scope).toEqual({
            serverId: activeServer.id,
            accountId: 'account-a',
        });
    });

    it('rejects credentials whose authenticated account does not match the persisted outbox scope', async () => {
        const activeServer = upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        setActiveServerId(activeServer.id, { scope: 'device' });
        getCredentialsForServerUrlMock.mockResolvedValue({ token: tokenForSub('different-account'), secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});

        await expect(resolveSessionRequestForServerAccountScope({
            scope: { serverId: ownerServer.id, accountId: 'account-owner' },
            activeRequest: async () => new Response(null, { status: 200 }),
        })).rejects.toThrow('authenticated account does not match');
        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });

    /**
     * A Home reached only by a semantic carrier (browser Iroh, Lane 06 A7.3/A7.4)
     * has NO origin a URL fetch can reach: its canonical URL resolves nowhere.
     * The scoped-request owner already receives that carrier on its resolved
     * context, so it must move the bytes over it. Sending the request to the
     * canonical URL instead is not a degraded path — it cannot arrive at all,
     * which is what broke every account-scoped call (V2 route grants included)
     * on an ingress-less Home.
     */
    it('carries an account-scoped request over the resolved semantic Home carrier instead of its unreachable URL', async () => {
        const carried: { url: string; init: RequestInit }[] = [];
        const homeCarrier = {
            endpointId: 'a'.repeat(64),
            readObservedPath: () => 'relay' as const,
            request: async (url: string, init: RequestInit) => {
                carried.push({ url, init });
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            },
            createWebSocket: () => {
                throw new Error('the scoped HTTP request must not open a socket');
            },
        };

        const request = createSessionRequestForResolvedServerScope({
            context: {
                scope: 'scoped',
                timeoutMs: 5_000,
                targetServerId: 'srv_ingressless',
                targetServerUrl: 'https://ingressless.happier.invalid',
                targetAccountId: 'account-a',
                token: tokenForSub('account-a'),
                credentials: { token: tokenForSub('account-a') },
                encryption: null,
                // Exactly what `resolveServerScopedTransport` returns for a
                // browser Iroh Home: the canonical URL as the "origin", plus the
                // carrier that actually owns the bytes.
                runtimeOrigin: 'https://ingressless.happier.invalid',
                carrier: 'iroh',
                homeCarrier,
            },
            activeRequest: async () => {
                throw new Error('a scoped request must not fall back to the active request');
            },
        });

        const response = await request('/v1/machines/peer/mediation/route-grants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ v: 2 }),
        });

        expect(response.status).toBe(200);
        expect(runtimeFetchMock).not.toHaveBeenCalled();
        expect(carried).toHaveLength(1);
        expect(carried[0]?.url).toBe('https://ingressless.happier.invalid/v1/machines/peer/mediation/route-grants');
        expect(carried[0]?.init.method).toBe('POST');
        expectHeaderValue(carried[0]?.init.headers, 'Authorization', `Bearer ${tokenForSub('account-a')}`);
    });
});

afterEach(async () => {
    try {
        const { resetServerReachabilitySupervisors } = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
        await resetServerReachabilitySupervisors();
    } catch {
        // ignore
    }
});
