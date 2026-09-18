import { CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION_PROTOCOL_VERSION } from '@happier-dev/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = vi.hoisted(() => new Map<string, string>());
const serverFetchMock = vi.hoisted(() => vi.fn());
const runtimeFetchMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn());
const createEncryptionFromAuthCredentialsMock = vi.hoisted(() => vi.fn());
const resolvePreferredServerIdForSessionIdMock = vi.hoisted(() => vi.fn());

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

vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchMock,
}));

vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: runtimeFetchMock,
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

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId', () => ({
    resolvePreferredServerIdForSessionId: (sessionId: string) => resolvePreferredServerIdForSessionIdMock(sessionId),
}));

import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';

import {
    createSessionShare,
    deleteSessionShare,
    getSessionShares,
    updateSessionShare,
} from './apiSharing';
import { createSessionSocialRequest, getSessionFriendsList } from './createSessionSocialRequest';

function expectHeaderValue(headers: HeadersInit | undefined, key: string, value: string) {
    expect(new Headers(headers).get(key)).toBe(value);
}

function mutationCalls(url: string, method: string) {
    return runtimeFetchMock.mock.calls.filter(([input, init]) => String(input) === url && init?.method === method);
}

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `e30.${payload}.signature`;
}

const releasedShare = Object.freeze({
    id: 'share-1',
    sharedWithUser: Object.freeze({
        id: 'user-2',
        username: 'lee',
        firstName: null,
        lastName: null,
        avatar: null,
    }),
    accessLevel: 'edit' as const,
    canApprovePermissions: false,
    createdAt: 1,
    updatedAt: 1,
});

describe('apiSharing server-scoped session routes', () => {
    beforeEach(() => {
        kvStore.clear();
        serverFetchMock.mockReset();
        runtimeFetchMock.mockReset();
        getCredentialsForServerUrlMock.mockReset();
        createEncryptionFromAuthCredentialsMock.mockReset();
        resolvePreferredServerIdForSessionIdMock.mockReset();
    });

    it('uses the explicit Home and Account even when the same session id prefers another Home', async () => {
        const preferred = await upsertServerProfile({ serverUrl: 'https://preferred.example', name: 'Preferred' });
        const target = await upsertServerProfile({ serverUrl: 'https://target.example', name: 'Target' });
        await setActiveServerId(preferred.id, { scope: 'device' });
        resolvePreferredServerIdForSessionIdMock.mockReturnValue(preferred.id);
        const token = tokenForSub('target-account');
        getCredentialsForServerUrlMock.mockResolvedValue({ token, secret: 'secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            shares: [{ ...releasedShare, id: 'target-share' }],
        })));
        serverFetchMock.mockResolvedValue(new Response(JSON.stringify({
            shares: [{ ...releasedShare, id: 'wrong-share' }],
        })));

        const result = await getSessionShares({ token, secret: 'secret' }, 'same-id', {
            scope: { serverId: target.id, accountId: 'target-account' },
        });

        expect(result.map((share) => share.id)).toEqual(['target-share']);
        expect(serverFetchMock).not.toHaveBeenCalled();
        expect(runtimeFetchMock.mock.calls.some(([url]) => url === 'https://target.example/v1/sessions/same-id/shares')).toBe(true);
    });

    it('rejects a changed Account before a scoped social request leaves the process', async () => {
        const target = await upsertServerProfile({ serverUrl: 'https://target.example', name: 'Target' });
        getCredentialsForServerUrlMock.mockResolvedValue({ token: tokenForSub('new-account'), secret: 'secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        const request = createSessionSocialRequest({ token: 'stale', secret: 'secret' }, 'same-id', {
            scope: { serverId: target.id, accountId: 'original-account' },
        });
        await expect(request('/v1/sessions/same-id/public-share')).rejects.toThrow('does not match requested scope');
        expect(runtimeFetchMock).not.toHaveBeenCalled();
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('gets session shares through the preferred owner server when the owner is not active', async () => {
        const activeServer = await upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = await upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        await setActiveServerId(activeServer.id, { scope: 'device' });
        resolvePreferredServerIdForSessionIdMock.mockReturnValue(ownerServer.id);
        const ownerToken = tokenForSub('owner-account');
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({ shares: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const shares = await getSessionShares({ token: 'active-token', secret: 'active-secret' }, 'session-1');

        expect(shares).toEqual([]);
        expect(serverFetchMock).not.toHaveBeenCalled();
        expect(runtimeFetchMock).toHaveBeenCalledWith(
            'https://owner.example/v1/sessions/session-1/shares',
            expect.objectContaining({ method: 'GET' }),
        );
        const sharesCall = runtimeFetchMock.mock.calls.find((call) => call[0] === 'https://owner.example/v1/sessions/session-1/shares');
        expect(sharesCall).toBeTruthy();
        expectHeaderValue(sharesCall?.[1]?.headers, 'Authorization', `Bearer ${ownerToken}`);
        expectHeaderValue(
            sharesCall?.[1]?.headers,
            'x-happier-account-stored-content-protocol',
            String(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION_PROTOCOL_VERSION),
        );
    });

    it('creates session shares through the preferred owner server and preserves the request body', async () => {
        const activeServer = await upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = await upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        await setActiveServerId(activeServer.id, { scope: 'device' });
        resolvePreferredServerIdForSessionIdMock.mockReturnValue(ownerServer.id);
        const ownerToken = tokenForSub('owner-account');
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            share: {
                ...releasedShare,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const share = await createSessionShare(
            { token: 'active-token', secret: 'active-secret' },
            'session-1',
            { userId: 'user-2', accessLevel: 'edit' },
        );

        expect(share.id).toBe('share-1');
        expect(serverFetchMock).not.toHaveBeenCalled();
        expect(runtimeFetchMock).toHaveBeenCalledWith(
            'https://owner.example/v1/sessions/session-1/shares',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ userId: 'user-2', accessLevel: 'edit' }),
            }),
        );
        const createCall = runtimeFetchMock.mock.calls.find((call) => call[0] === 'https://owner.example/v1/sessions/session-1/shares');
        expect(createCall).toBeTruthy();
        expectHeaderValue(createCall?.[1]?.headers, 'Authorization', `Bearer ${ownerToken}`);
        expectHeaderValue(createCall?.[1]?.headers, 'Content-Type', 'application/json');
        expectHeaderValue(
            createCall?.[1]?.headers,
            'x-happier-account-stored-content-protocol',
            String(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION_PROTOCOL_VERSION),
        );
    });

    it.each([
        ['list 400', 400, () => getSessionShares({ token: 'token', secret: 'secret' }, 'session-1')],
        ['list 403', 403, () => getSessionShares({ token: 'token', secret: 'secret' }, 'session-1')],
        ['list 404', 404, () => getSessionShares({ token: 'token', secret: 'secret' }, 'session-1')],
        ['create 400', 400, () => createSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1',
            { userId: 'user-2', accessLevel: 'edit' },
        )],
        ['create 403', 403, () => createSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1',
            { userId: 'user-2', accessLevel: 'edit' },
        )],
        ['create 404', 404, () => createSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1',
            { userId: 'user-2', accessLevel: 'edit' },
        )],
        ['update 400', 400, () => updateSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1', 'share-1', { accessLevel: 'view' },
        )],
        ['update 403', 403, () => updateSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1', 'share-1', { accessLevel: 'view' },
        )],
        ['update 404', 404, () => updateSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1', 'share-1', { accessLevel: 'view' },
        )],
        ['delete 400', 400, () => deleteSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1', 'share-1',
        )],
        ['delete 403', 403, () => deleteSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1', 'share-1',
        )],
        ['delete 404', 404, () => deleteSessionShare(
            { token: 'token', secret: 'secret' }, 'session-1', 'share-1',
        )],
    ])('sends exactly one request for terminal direct-share %s', async (_name, status, run) => {
        serverFetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'terminal' }), {
            status,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.useFakeTimers();
        try {
            const result = run();
            const rejection = expect(result).rejects.toThrow();
            await vi.runAllTimersAsync();
            await rejection;
            expect(serverFetchMock).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        ['network failure', () => serverFetchMock.mockRejectedValue(new TypeError('network unavailable'))],
        ['server failure', () => serverFetchMock.mockResolvedValue(new Response('{}', { status: 503 }))],
    ])('retains the bounded retry budget for ambiguous %s', async (_name, arrange) => {
        arrange();
        vi.useFakeTimers();
        try {
            const result = getSessionShares({ token: 'token', secret: 'secret' }, 'session-1');
            const rejection = expect(result).rejects.toThrow();
            await vi.runAllTimersAsync();
            await rejection;
            expect(serverFetchMock).toHaveBeenCalledTimes(8);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        ['access level', { ...releasedShare, accessLevel: 'write' }],
        ['profile', { ...releasedShare, sharedWithUser: { ...releasedShare.sharedWithUser, username: 42 } }],
        ['timestamp', { ...releasedShare, updatedAt: 'later' }],
    ])('rejects a malformed released direct-share %s at ingress without retrying', async (_name, share) => {
        serverFetchMock.mockResolvedValue(new Response(JSON.stringify({ shares: [share] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.useFakeTimers();
        try {
            const result = getSessionShares({ token: 'token', secret: 'secret' }, 'session-1');
            const rejection = expect(result).rejects.toThrow();
            await vi.runAllTimersAsync();
            await rejection;
            expect(serverFetchMock).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('gets shareable friends through the preferred session owner server', async () => {
        const activeServer = await upsertServerProfile({ serverUrl: 'https://active.example', name: 'Active' });
        const ownerServer = await upsertServerProfile({ serverUrl: 'https://owner.example', name: 'Owner' });
        await setActiveServerId(activeServer.id, { scope: 'device' });
        resolvePreferredServerIdForSessionIdMock.mockReturnValue(ownerServer.id);
        const ownerToken = tokenForSub('owner-account');
        getCredentialsForServerUrlMock.mockResolvedValue({ token: ownerToken, secret: 'owner-secret' });
        createEncryptionFromAuthCredentialsMock.mockResolvedValue({});
        runtimeFetchMock.mockResolvedValue(new Response(JSON.stringify({
            friends: [{
                id: 'user-2',
                username: 'lee',
                firstName: 'Lee',
                lastName: null,
                avatar: null,
                bio: null,
                publicKey: null,
                status: 'friend',
            }],
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const friends = await getSessionFriendsList(
            { token: 'active-token', secret: 'active-secret' },
            'session-1',
        );

        expect(friends.map((friend) => friend.id)).toEqual(['user-2']);
        expect(serverFetchMock).not.toHaveBeenCalled();
        const requestCall = runtimeFetchMock.mock.calls.find(([input]) =>
            String(input) === 'https://owner.example/v1/friends');
        expect(requestCall?.[1]).toEqual(expect.objectContaining({ method: 'GET' }));
        expectHeaderValue(requestCall?.[1]?.headers, 'Authorization', `Bearer ${ownerToken}`);
    });
});
