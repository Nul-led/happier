import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '@/dev/testkit';

type ServerRuntimeSnapshotFixture = Readonly<{
    serverId: string;
    serverUrl: string;
    generation: number;
}>;

function createServerRuntimeMock(readSnapshot: () => ServerRuntimeSnapshotFixture) {
    return {
        getActiveServerSnapshot: () => readSnapshot(),
        captureActiveServerRuntimeTarget: () => {
            const snapshot = readSnapshot();
            return { serverId: snapshot.serverId, generation: snapshot.generation };
        },
        getActiveServerHomeCarrier: () => null,
    };
}

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

// `createDeferred` is imported from the UI testkit; reset before each mocked
// manager import so its transitive modules cannot retain a pre-mock manager.
beforeEach(() => {
    vi.resetModules();
});

describe('switchConnectionToActiveServer', () => {
    it('uses server-scoped credentials for the active server when switching sync server', async () => {
        const abortSpy = vi.fn();
        const syncSwitchServerSpy = vi.fn(async (_credentials: { token: string; secret: string }) => {});
        const getCredentialsSpy = vi.fn(async () => null);
        const getCredentialsForServerUrlSpy = vi.fn(async () => ({ token: 'scoped-token', secret: 'scoped-secret' }));

        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => ({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                kind: 'custom',
                generation: 42,
            })));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: getCredentialsSpy,
                getCredentialsForServerUrl: getCredentialsForServerUrlSpy,
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: syncSwitchServerSpy,
        }));
        vi.doMock('@/sync/http/client', () => ({
            abortServerFetches: abortSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        const result = await switchConnectionToActiveServer();
        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith('https://api.example.test', { serverId: 'server-a' });
        expect(result).toEqual({
            token: 'scoped-token',
            secret: 'scoped-secret',
        });

        expect(getCredentialsSpy).not.toHaveBeenCalled();
        expect(syncSwitchServerSpy).toHaveBeenCalledWith(
            { token: 'scoped-token', secret: 'scoped-secret' },
            expect.objectContaining({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                generation: 42,
            }),
        );
    });

    it('aborts in-flight server fetches before switching sync server', async () => {
        const abortSpy = vi.fn();
        const syncSwitchServerSpy = vi.fn(async (_credentials: { token: string; secret: string }) => {});
        const getCredentialsSpy = vi.fn(async () => ({ token: 'fallback', secret: 'fallback-secret' }));
        const getCredentialsForServerUrlSpy = vi.fn(async () => ({ token: 't', secret: 's' }));

        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => ({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                kind: 'custom',
                generation: 42,
            })));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: getCredentialsSpy,
                getCredentialsForServerUrl: getCredentialsForServerUrlSpy,
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: syncSwitchServerSpy,
        }));
        vi.doMock('@/sync/http/client', () => ({
            abortServerFetches: abortSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        await switchConnectionToActiveServer();

        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith('https://api.example.test', { serverId: 'server-a' });
        expect(getCredentialsSpy).not.toHaveBeenCalled();
        expect(abortSpy).toHaveBeenCalledTimes(1);
        expect(syncSwitchServerSpy).toHaveBeenCalledTimes(1);
    });

    it('applies latest server generation after a switch happens during an in-flight switch', async () => {
        let generation = 1;
        const abortSpy = vi.fn();
        const switchStarted = createDeferred<void>();
        const releaseSwitch = createDeferred<void>();
        let syncCallCount = 0;
        const getCredentialsSpy = vi.fn(async () => null);
        const getCredentialsForServerUrlSpy = vi.fn(async (serverUrl: string) =>
            serverUrl === 'https://a.example.test'
                ? { token: 'token-a', secret: 's' }
                : { token: 'token-b', secret: 's' },
        );
        const syncSwitchServerSpy = vi.fn(async (_credentials: { token: string; secret: string }) => {
            syncCallCount += 1;
            if (syncCallCount > 1) return;
            switchStarted.resolve();
            await releaseSwitch.promise;
        });

        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => ({
                serverId: generation === 1 ? 'server-a' : 'server-b',
                serverUrl: generation === 1 ? 'https://a.example.test' : 'https://b.example.test',
                kind: 'custom',
                generation,
            })));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: getCredentialsSpy,
                getCredentialsForServerUrl: getCredentialsForServerUrlSpy,
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: syncSwitchServerSpy,
        }));
        vi.doMock('@/sync/http/client', () => ({
            abortServerFetches: abortSpy,
        }));

        const { switchConnectionToActiveServer } = await import('./connectionManager');
        const first = switchConnectionToActiveServer();
        await switchStarted.promise;
        generation = 2;
        const second = switchConnectionToActiveServer();
        releaseSwitch.resolve();
        await Promise.all([first, second]);

        expect(abortSpy).toHaveBeenCalledTimes(2);
        expect(syncSwitchServerSpy).toHaveBeenCalledTimes(2);
        expect(getCredentialsForServerUrlSpy).toHaveBeenNthCalledWith(1, 'https://a.example.test', { serverId: 'server-a' });
        expect(getCredentialsForServerUrlSpy).toHaveBeenNthCalledWith(2, 'https://b.example.test', { serverId: 'server-b' });
        expect(getCredentialsSpy).not.toHaveBeenCalled();
        expect(syncSwitchServerSpy.mock.calls.at(-1)?.[0]).toEqual({ token: 'token-b', secret: 's' });
    });

    it('does not return stale credentials when a newer Home is requested during the already-applied credential read', async () => {
        let snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        const staleCredentialReadStarted = createDeferred<void>();
        const releaseStaleCredentialRead = createDeferred<void>();
        let homeACredentialReads = 0;
        const homeACredentials = { token: 'token-a', secret: 's-a' };
        const homeBCredentials = { token: 'token-b', secret: 's-b' };
        const getCredentialsForServerUrlSpy = vi.fn(async (serverUrl: string) => {
            if (serverUrl === 'https://a.example.test') {
                homeACredentialReads += 1;
                // The first switch reads once before applying Sync and once
                // again before returning the still-current credentials. Pause
                // the next already-applied read to reproduce the A/B race.
                if (homeACredentialReads === 3) {
                    staleCredentialReadStarted.resolve();
                    await releaseStaleCredentialRead.promise;
                }
                return homeACredentials;
            }
            return homeBCredentials;
        });
        const syncSwitchServerSpy = vi.fn(async () => {});

        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: getCredentialsForServerUrlSpy,
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: syncSwitchServerSpy,
        }));
        vi.doMock('@/sync/http/client', () => ({
            abortServerFetches: vi.fn(),
        }));

        const connection = await import('./connectionManager');
        await expect(connection.switchConnectionToActiveServer()).resolves.toEqual(homeACredentials);

        const alreadyAppliedRead = connection.switchConnectionToActiveServer();
        await staleCredentialReadStarted.promise;
        snapshot = {
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
            kind: 'custom',
            generation: 2,
        };
        const newerRequest = connection.switchConnectionToActiveServer();
        releaseStaleCredentialRead.resolve();

        await expect(alreadyAppliedRead).resolves.toEqual(homeBCredentials);
        await expect(newerRequest).resolves.toEqual(homeBCredentials);
        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(
            homeBCredentials,
            expect.objectContaining({
                serverId: 'server-b',
                serverUrl: 'https://b.example.test',
                generation: 2,
            }),
        );
    });

    it('publishes a same-Home applied event when its connection generation changes', async () => {
        let snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token-a', secret: 's' })),
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: vi.fn(async () => {}),
        }));
        vi.doMock('@/sync/http/client', () => ({
            abortServerFetches: vi.fn(),
        }));

        const connection = await import('./connectionManager');
        await connection.switchConnectionToActiveServer();
        const applied: Array<{ serverId: string; generation: number | undefined }> = [];
        const unsubscribe = connection.subscribeAppliedActiveServer((serverId, generation?: number) => {
            applied.push({ serverId, generation });
        });

        snapshot = { ...snapshot, generation: 2 };
        await connection.switchConnectionToActiveServer();

        expect(applied).toEqual([{ serverId: 'server-a', generation: 2 }]);
        unsubscribe();
    });

    it('republishes the same Home when its singleton transport becomes available again', async () => {
        const snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        const syncRestoreSpy = vi.fn(async () => {});
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token-a', secret: 's' })),
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: vi.fn(async () => {}),
            syncRestore: syncRestoreSpy,
            syncHydrateLocalState: vi.fn(),
        }));
        vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));

        const connection = await import('./connectionManager');
        await connection.switchConnectionToActiveServer();
        const applied: Array<{ serverId: string; generation: number | undefined }> = [];
        const availability: boolean[] = [];
        const unsubscribe = connection.subscribeAppliedActiveServer((serverId, generation?: number) => {
            applied.push({ serverId, generation });
        });
        const unsubscribeAvailability = connection.subscribeAppliedActiveServerRuntimeAvailability((available) => {
            availability.push(available);
        });

        await connection.restoreConnectionToActiveServer({ token: 'token-a', secret: 's' });

        expect(syncRestoreSpy).toHaveBeenCalledOnce();
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(true);
        expect(applied).toEqual([]);
        expect(availability).toEqual([false, true]);
        unsubscribe();
        unsubscribeAvailability();
    });

    it('keeps the retained Home unavailable after its singleton transport is disconnected', async () => {
        const snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        const syncSwitchServerSpy = vi.fn(async () => {});
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token-a', secret: 's' })),
            },
        }));
        vi.doMock('@/sync/sync', () => ({ syncSwitchServer: syncSwitchServerSpy }));
        vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));

        const connection = await import('./connectionManager');
        await connection.switchConnectionToActiveServer();
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(true);

        await connection.disconnectActiveServerConnection();

        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(null);
        expect(connection.getAppliedActiveServerSnapshot()).toEqual(expect.objectContaining({
            serverId: 'server-a',
            generation: 1,
        }));
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(false);
    });

    it('restores a disconnected Home at the same generation before reusing its applied shortcut', async () => {
        const snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        const syncSwitchServerSpy = vi.fn(async () => {});
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token-a', secret: 's' })),
            },
        }));
        vi.doMock('@/sync/sync', () => ({ syncSwitchServer: syncSwitchServerSpy }));
        vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));

        const connection = await import('./connectionManager');
        await connection.switchConnectionToActiveServer();
        await connection.disconnectActiveServerConnection();
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(false);

        await connection.retryActiveServerConnection();

        expect(syncSwitchServerSpy).toHaveBeenNthCalledWith(
            3,
            { token: 'token-a', secret: 's' },
            expect.objectContaining({ serverId: 'server-a', generation: 1 }),
        );
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(true);
    });

    it('starts Sync with the new credential when the same Home is signed into after a signed-out apply', async () => {
        const snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        let storedCredentials: { token: string; secret: string } | null = null;
        const syncSwitchServerSpy = vi.fn(async () => {});
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => storedCredentials),
            },
        }));
        vi.doMock('@/sync/sync', () => ({ syncSwitchServer: syncSwitchServerSpy }));
        vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));

        const connection = await import('./connectionManager');
        // A signed-out tab applies the focused Home with no credential.
        await connection.switchConnectionToActiveServer();
        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(null, expect.objectContaining({ serverId: 'server-a' }));

        // Signing in persists a credential for the same Home and generation.
        storedCredentials = { token: 'token-a', secret: 's' };
        await connection.switchConnectionToActiveServer();

        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(
            { token: 'token-a', secret: 's' },
            expect.objectContaining({ serverId: 'server-a', generation: 1 }),
        );

        // An unchanged credential keeps reusing the applied runtime.
        await connection.switchConnectionToActiveServer();
        expect(syncSwitchServerSpy).toHaveBeenCalledTimes(2);
    });

    it('retires Sync when the same Home signs out, and restarts it for the next credential', async () => {
        const snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        let storedCredentials: { token: string; secret: string } | null = { token: 'token-a', secret: 's' };
        const syncSwitchServerSpy = vi.fn(async () => {});
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => storedCredentials),
            },
        }));
        vi.doMock('@/sync/sync', () => ({ syncSwitchServer: syncSwitchServerSpy }));
        vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));

        const connection = await import('./connectionManager');
        await connection.switchConnectionToActiveServer();

        storedCredentials = null;
        await expect(connection.switchConnectionToActiveServer()).resolves.toBeNull();
        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(null, expect.objectContaining({ serverId: 'server-a' }));

        storedCredentials = { token: 'token-a2', secret: 's' };
        await connection.switchConnectionToActiveServer();
        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(
            { token: 'token-a2', secret: 's' },
            expect.objectContaining({ serverId: 'server-a', generation: 1 }),
        );
        expect(syncSwitchServerSpy).toHaveBeenCalledTimes(3);
    });

    it('publishes only the focused Home whose full Sync application has completed', async () => {
        let snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        const firstSwitchStarted = createDeferred<void>();
        const releaseFirstSwitch = createDeferred<void>();
        let syncCallCount = 0;
        const syncSwitchServerSpy = vi.fn(async () => {
            syncCallCount += 1;
            if (syncCallCount !== 1) return;
            firstSwitchStarted.resolve();
            await releaseFirstSwitch.promise;
        });

        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async (serverUrl: string) => ({
                    token: serverUrl.includes('a.example') ? 'token-a' : 'token-b',
                    secret: 's',
                })),
            },
        }));
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: syncSwitchServerSpy,
        }));
        vi.doMock('@/sync/http/client', () => ({
            abortServerFetches: vi.fn(),
        }));

        const connection = await import('./connectionManager');
        expect(connection.getAppliedActiveServerSnapshot()).toEqual(expect.objectContaining({
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        }));
        const applied: string[] = [];
        const applying: string[] = [];
        const unsubscribe = connection.subscribeAppliedActiveServer((serverId) => {
            applied.push(serverId);
        });
        const unsubscribeApplying = connection.subscribeApplyingActiveServer((serverId) => {
            applying.push(serverId);
        });
        const first = connection.switchConnectionToActiveServer();
        await firstSwitchStarted.promise;

        snapshot = {
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
            kind: 'custom',
            generation: 2,
        };
        const second = connection.switchConnectionToActiveServer();

        expect(connection.getAppliedActiveServerId()).toBe('server-a');
        expect(connection.getAppliedActiveServerSnapshot()).toEqual(expect.objectContaining({
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        }));
        expect(applied).toEqual([]);
        expect(applying).toEqual(['server-a']);

        releaseFirstSwitch.resolve();
        await Promise.all([first, second]);

        expect(connection.getAppliedActiveServerId()).toBe('server-b');
        expect(connection.getAppliedActiveServerSnapshot()).toEqual(expect.objectContaining({
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
            generation: 2,
        }));
        expect(applied).toEqual(['server-b']);
        expect(applying).toEqual(['server-a', 'server-b']);
        unsubscribe();
        unsubscribeApplying();
    });

    it('withdraws the singleton transport before the former applied Home is reset for a new target', async () => {
        let snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        const bSwitchStarted = createDeferred<void>();
        const releaseBSwitch = createDeferred<void>();
        const syncSwitchServerSpy = vi.fn(async (_credentials: unknown, target?: { serverId?: string }) => {
            if (target?.serverId !== 'server-b') return;
            bSwitchStarted.resolve();
            await releaseBSwitch.promise;
        });
        const activeQuerySpy = vi.fn(async () => ({ route: 'active' }));
        const concurrentQuerySpy = vi.fn(async (serverId: string) => ({ route: `concurrent:${serverId}` }));

        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
            return {
                ...actual,
                TokenStorage: {
                    ...actual.TokenStorage,
                    getCredentials: vi.fn(async () => null),
                    getCredentialsForServerUrl: vi.fn(async (serverUrl: string) => ({
                        token: serverUrl.includes('a.example') ? 'token-a' : 'token-b',
                        secret: 's',
                    })),
                },
            };
        });
        vi.doMock('@/sync/sync', () => ({
            syncSwitchServer: syncSwitchServerSpy,
            sync: { fetchSessionListQueryPage: activeQuerySpy },
        }));
        vi.doMock('@/sync/http/client', async (importOriginal) => ({
            ...await importOriginal<typeof import('@/sync/http/client')>(),
            abortServerFetches: vi.fn(),
        }));
        vi.doMock('@/sync/runtime/orchestration/concurrentSessionCache', () => ({
            fetchConcurrentSessionListQueryPage: concurrentQuerySpy,
            getConcurrentSessionListQueryHomeAvailability: () => 'offline',
            isConcurrentSessionListQueryHomeOnline: () => false,
            retryConcurrentSessionListQueryHome: vi.fn(async () => {}),
        }));

        const connection = await import('./connectionManager');
        await connection.switchConnectionToActiveServer();
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(true);

        snapshot = {
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
            kind: 'custom',
            generation: 2,
        };
        const pendingSwitch = connection.switchConnectionToActiveServer();
        await bSwitchStarted.promise;

        expect(connection.getAppliedActiveServerSnapshot()).toEqual(expect.objectContaining({
            serverId: 'server-a',
            generation: 1,
        }));
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(false);

        const queryRuntime = await import('@/sync/domains/session/listing/sessionListQueryRuntime');
        const page = {
            source: { kind: 'ordinary' as const, path: '/v2/sessions', allowV1Fallback: false },
            membership: 'ordinary' as const,
            signal: new AbortController().signal,
        };
        await expect(queryRuntime.fetchSessionListQueryPageForHome('server-b', page))
            .resolves.toEqual({ route: 'concurrent:server-b' });
        expect(activeQuerySpy).not.toHaveBeenCalled();

        releaseBSwitch.resolve();
        await pendingSwitch;

        expect(connection.getAppliedActiveServerSnapshot()).toEqual(expect.objectContaining({
            serverId: 'server-b',
            generation: 2,
        }));
        expect(connection.isAppliedActiveServerRuntimeAvailable()).toBe(true);
    });
});

describe('applied active Home snapshot', () => {
    it('resolves the applied Home when it is first read, not when the module is imported', async () => {
        let snapshot: ServerRuntimeSnapshotFixture = { serverId: '', serverUrl: '', generation: 0 };
        vi.doMock('@/sync/domains/server/serverRuntime', () => createServerRuntimeMock(() => snapshot));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => null),
            },
        }));
        vi.doMock('@/sync/sync', () => ({ syncSwitchServer: vi.fn(async () => {}) }));
        vi.doMock('@/sync/http/client', () => ({ abortServerFetches: vi.fn() }));

        // The module is loaded before the persisted Home has been restored, which
        // is the real startup order for every consumer that imports Sync eagerly.
        const connection = await import('./connectionManager');
        snapshot = { serverId: 'server-a', serverUrl: 'https://api.example.test', generation: 7 };

        expect(connection.getAppliedActiveServerId()).toBe('server-a');
        expect(connection.getAppliedActiveServerSnapshot()).toEqual({
            serverId: 'server-a',
            serverUrl: 'https://api.example.test',
            generation: 7,
        });
    });
});
