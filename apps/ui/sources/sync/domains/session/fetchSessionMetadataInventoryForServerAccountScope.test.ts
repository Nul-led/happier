import { afterEach, describe, expect, it, vi } from 'vitest';

import type { V2SessionRecord } from '@happier-dev/protocol';
import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';

const boundary = vi.hoisted(() => ({
    captureAuthority: vi.fn(),
    credentialListeners: new Set<(event: Readonly<{ serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }>) => void>(),
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        subscribeHomeCredentialMutations: (listener: (event: Readonly<{ serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }>) => void) => {
            boundary.credentialListeners.add(listener);
            return () => boundary.credentialListeners.delete(listener);
        },
    };
});

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope')
    >();
    return {
        ...actual,
        captureServerRequestAuthorityForServerAccountScope: boundary.captureAuthority,
    };
});

import { ensureSessionMetadataInventoryForServerAccountScope } from './fetchSessionMetadataInventoryForServerAccountScope';

function row(id: string, archivedAt: number | null = null): V2SessionRecord {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: archivedAt === null,
        activeAt: 1,
        archivedAt,
        encryptionMode: 'plain',
        metadata: JSON.stringify({ name: id, path: `/work/${id}` }),
        metadataVersion: 1,
        agentState: JSON.stringify({}),
        agentStateVersion: 1,
        dataEncryptionKey: null,
        share: null,
    };
}

function response(sessions: readonly V2SessionRecord[], nextCursor: string | null): Response {
    return new Response(JSON.stringify({
        sessions,
        nextCursor,
        hasNext: nextCursor !== null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function createLifetime() {
    let current = true;
    const listeners = new Set<() => void>();
    return {
        lifetime: {
            isCurrent: () => current,
            onRetire: (listener: () => void) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
        },
        retire: () => {
            current = false;
            for (const listener of listeners) listener();
        },
    };
}

afterEach(() => {
    boundary.captureAuthority.mockReset();
    for (const listener of [...boundary.credentialListeners]) {
        listener({ kind: 'credentials_removed', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
    }
    boundary.credentialListeners.clear();
    storage.setState(storage.getInitialState(), true);
});

describe('ensureSessionMetadataInventoryForServerAccountScope', () => {
    it('publishes same-id inactive-Home metadata only to that server partition', async () => {
        const activeSession = {
            id: 'session-1',
            serverId: 'home-a',
            seq: 1,
            createdAt: 1,
            updatedAt: 10,
            active: true,
            activeAt: 10,
            archivedAt: null,
            encryptionMode: 'plain',
            metadata: { name: 'Home A title', path: '/work/a', host: 'host-a' },
            metadataVersion: 1,
            agentState: {},
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0,
            presence: 'online',
        } satisfies Session;
        storage.setState((state) => ({
            ...state,
            sessions: { ...state.sessions, [activeSession.id]: activeSession },
        }));
        const homeBRow = {
            ...row('session-1'),
            metadata: JSON.stringify({ name: 'Home B title', path: '/work/b' }),
            updatedAt: 20,
        };
        const request = vi.fn(async (path: string) => {
            const pathname = new URL(path, 'https://home-b.example.test').pathname;
            if (pathname === '/v2/sessions/active') return response([], null);
            if (pathname === '/v2/sessions') return response([homeBRow], null);
            return response([], null);
        });
        boundary.captureAuthority.mockResolvedValue({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            context: { credentials: { token: 'token-b' } },
            request,
            release: vi.fn(async () => {}),
        });
        const account = createLifetime();

        await ensureSessionMetadataInventoryForServerAccountScope({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            accountLifetime: account.lifetime,
            refresh: true,
        });

        expect(storage.getState().sessions['session-1']).toBe(activeSession);
        expect(storage.getState().sessionListRowsByServerId['home-b']?.['session-1']).toMatchObject({
            metadata: { name: 'Home B title', path: '/work/b' },
        });
    });

    it('exhausts current and archived list cursors through one exact Account authority and applies scoped metadata rows', async () => {
        const request = vi.fn(async (path: string) => {
            const url = new URL(path, 'https://home-b.example.test');
            const cursor = url.searchParams.get('cursor');
            if (url.pathname === '/v2/sessions/active') return response([], null);
            if (url.pathname === '/v2/sessions/archived') {
                return cursor
                    ? response([row('archived-page-2', 2)], null)
                    : response([row('archived-page-1', 1)], 'archived-next');
            }
            return cursor
                ? response([row('current-page-2')], null)
                : response([row('current-page-1')], 'current-next');
        });
        const release = vi.fn(async () => {});
        boundary.captureAuthority.mockResolvedValue({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            context: { credentials: { token: 'token-b' } },
            request,
            release,
        });
        const account = createLifetime();

        await ensureSessionMetadataInventoryForServerAccountScope({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            accountLifetime: account.lifetime,
            refresh: true,
        });

        expect(boundary.captureAuthority).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'home-b', accountId: 'account-b' },
        }));
        expect(request.mock.calls.map(([path]) => {
            const url = new URL(path, 'https://home-b.example.test');
            return [url.pathname, url.searchParams.get('cursor')];
        })).toEqual([
            ['/v2/sessions/active', null],
            ['/v2/sessions', null],
            ['/v2/sessions', 'current-next'],
            ['/v2/sessions/archived', null],
            ['/v2/sessions/archived', 'archived-next'],
        ]);
        expect(Object.keys(storage.getState().sessionListRowsByServerId['home-b'] ?? {}).sort()).toEqual([
            'archived-page-1',
            'archived-page-2',
            'current-page-1',
            'current-page-2',
        ]);
        expect(storage.getState().sessions).toEqual({});
        expect(storage.getState().sessionListRowsByServerId['home-b']?.['archived-page-2']).toMatchObject({
            metadata: { name: 'archived-page-2', path: '/work/archived-page-2' },
        });
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('aborts and fences late publication when the exact Home credential retires', async () => {
        const request = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
            expect(init.signal).toBeInstanceOf(AbortSignal);
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }));
        const release = vi.fn(async () => {});
        boundary.captureAuthority.mockResolvedValue({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            context: { credentials: { token: 'token-b' } },
            request,
            release,
        });
        const account = createLifetime();
        const work = ensureSessionMetadataInventoryForServerAccountScope({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            accountLifetime: account.lifetime,
            refresh: true,
        });
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

        for (const listener of boundary.credentialListeners) {
            listener({ kind: 'credentials_removed', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
        }
        await expect(work).rejects.toMatchObject({ name: 'AbortError' });

        expect(storage.getState().sessions['must-not-publish']).toBeUndefined();
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    });

    it('does not overwrite a newer scoped Sync create or update that lands while inventory is paging', async () => {
        const archivedPage = createDeferred<Response>();
        const request = vi.fn(async (path: string) => {
            const pathname = new URL(path, 'https://home-b.example.test').pathname;
            if (pathname === '/v2/sessions/active') return response([], null);
            if (pathname === '/v2/sessions') {
                return response([
                    { ...row('updated-during-inventory'), updatedAt: 10 },
                ], null);
            }
            return await archivedPage.promise;
        });
        boundary.captureAuthority.mockResolvedValue({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            context: { credentials: { token: 'token-b' } },
            request,
            release: vi.fn(async () => {}),
        });
        const account = createLifetime();
        storage.getState().mergeSessionListRowsForServerScope('home-b', [
            createSessionListRenderableSessionFixture({
                id: 'updated-during-inventory',
                updatedAt: 5,
                archivedAt: null,
                metadata: { name: 'Before inventory', path: '/work/before', host: 'home-b-host' },
            }),
            createSessionListRenderableSessionFixture({
                id: 'unchanged-before-inventory',
                updatedAt: 5,
                archivedAt: null,
                metadata: { name: 'Removed remotely', path: '/work/removed', host: 'home-b-host' },
            }),
        ]);

        const work = ensureSessionMetadataInventoryForServerAccountScope({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            accountLifetime: account.lifetime,
            refresh: true,
        });
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));

        storage.getState().mergeSessionListRowsForServerScope('home-b', [
            createSessionListRenderableSessionFixture({
                id: 'updated-during-inventory',
                updatedAt: 20,
                archivedAt: null,
                metadata: { name: 'Newer Sync title', path: '/work/newer', host: 'home-b-host' },
            }),
            createSessionListRenderableSessionFixture({
                id: 'created-during-inventory',
                updatedAt: 20,
                archivedAt: null,
                metadata: { name: 'New Sync session', path: '/work/new', host: 'home-b-host' },
            }),
        ]);
        archivedPage.resolve(response([], null));
        await work;

        const rows = storage.getState().sessionListRowsByServerId['home-b'];
        expect(rows?.['updated-during-inventory']).toMatchObject({
            updatedAt: 20,
            metadata: { name: 'Newer Sync title' },
        });
        expect(rows?.['created-during-inventory']).toMatchObject({
            metadata: { name: 'New Sync session' },
        });
        expect(rows?.['unchanged-before-inventory']).toBeUndefined();
        expect(storage.getState().ordinarySessionListMembershipByServerId['home-b']).toEqual([
            'updated-during-inventory',
            'created-during-inventory',
        ]);
    });

    it('shares one scoped inventory across consumers while detaching a retired caller independently', async () => {
        const archivedPage = createDeferred<Response>();
        const request = vi.fn(async (path: string, init: RequestInit) => {
            const pathname = new URL(path, 'https://home-b.example.test').pathname;
            if (pathname === '/v2/sessions/active') return response([], null);
            if (pathname === '/v2/sessions') return response([row('shared-row')], null);
            return await archivedPage.promise;
        });
        boundary.captureAuthority.mockResolvedValue({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            context: { credentials: { token: 'token-b' } },
            request,
            release: vi.fn(async () => {}),
        });
        const first = createLifetime();
        const second = createLifetime();
        const firstWork = ensureSessionMetadataInventoryForServerAccountScope({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            accountLifetime: first.lifetime,
            refresh: true,
        });
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
        const secondWork = ensureSessionMetadataInventoryForServerAccountScope({
            scope: { serverId: 'home-b', accountId: 'account-b' },
            accountLifetime: second.lifetime,
        });

        first.retire();
        await expect(firstWork).rejects.toMatchObject({ name: 'AbortError' });
        expect(request.mock.calls.at(-1)?.[1].signal?.aborted).toBe(false);
        archivedPage.resolve(response([], null));
        await secondWork;

        expect(boundary.captureAuthority).toHaveBeenCalledOnce();
        expect(storage.getState().sessionListRowsByServerId['home-b']?.['shared-row']).toBeDefined();
    });
});
