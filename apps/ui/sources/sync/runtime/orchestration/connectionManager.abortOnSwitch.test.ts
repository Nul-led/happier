import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '@/dev/testkit';

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

describe('switchConnectionToActiveServer', () => {
    it('uses server-scoped credentials for the active server when switching sync server', async () => {
        const abortSpy = vi.fn();
        const syncSwitchServerSpy = vi.fn(async (_credentials: { token: string; secret: string }) => {});
        const getCredentialsSpy = vi.fn(async () => null);
        const getCredentialsForServerUrlSpy = vi.fn(async () => ({ token: 'scoped-token', secret: 'scoped-secret' }));

        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                kind: 'custom',
                generation: 42,
            }),
        }));
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
        await expect(switchConnectionToActiveServer()).resolves.toEqual({
            token: 'scoped-token',
            secret: 'scoped-secret',
        });

        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith('https://api.example.test', { serverId: 'server-a' });
        expect(getCredentialsSpy).not.toHaveBeenCalled();
        expect(syncSwitchServerSpy).toHaveBeenCalledWith({ token: 'scoped-token', secret: 'scoped-secret' });
    });

    it('aborts in-flight server fetches before switching sync server', async () => {
        const abortSpy = vi.fn();
        const syncSwitchServerSpy = vi.fn(async (_credentials: { token: string; secret: string }) => {});
        const getCredentialsSpy = vi.fn(async () => ({ token: 'fallback', secret: 'fallback-secret' }));
        const getCredentialsForServerUrlSpy = vi.fn(async () => ({ token: 't', secret: 's' }));

        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                kind: 'custom',
                generation: 42,
            }),
        }));
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

        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: generation === 1 ? 'server-a' : 'server-b',
                serverUrl: generation === 1 ? 'https://a.example.test' : 'https://b.example.test',
                kind: 'custom',
                generation,
            }),
        }));
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
        generation = 2;
        const second = switchConnectionToActiveServer();
        await switchStarted.promise;
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

        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => snapshot,
        }));
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
        expect(syncSwitchServerSpy).toHaveBeenLastCalledWith(homeBCredentials);
    });

    it('publishes a same-Home applied event when its connection generation changes', async () => {
        let snapshot = {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            kind: 'custom',
            generation: 1,
        };
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => snapshot,
        }));
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

        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => snapshot,
        }));
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
        expect(applied).toEqual([]);
        expect(applying).toEqual(['server-a']);

        releaseFirstSwitch.resolve();
        await Promise.all([first, second]);

        expect(connection.getAppliedActiveServerId()).toBe('server-b');
        expect(applied).toEqual(['server-b']);
        expect(applying).toEqual(['server-a', 'server-b']);
        unsubscribe();
        unsubscribeApplying();
    });
});
