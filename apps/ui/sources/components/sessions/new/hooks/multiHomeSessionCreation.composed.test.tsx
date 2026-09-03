import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { renderHook } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock, type LocalStorageMockHandle } from '@/auth/storage/tokenStorage.web.testHelpers';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';

installTokenStorageWebPlatformMocks();

const socketBoundary = vi.hoisted(() => ({
    connects: vi.fn(),
    emits: vi.fn(),
    fetches: vi.fn(),
    controls: new Map<string, Readonly<{ disconnect: () => void; reconnect: () => void }>>(),
}));
const modalBoundary = vi.hoisted(() => ({
    alert: vi.fn(),
    confirm: vi.fn(async () => false),
}));
const syncSingletonHarness = vi.hoisted(() => ({ current: null as unknown }));
const observabilityBoundary = vi.hoisted(() => ({ capture: vi.fn() }));
const routeBoundary = vi.hoisted(() => ({
    params: {} as Record<string, string | undefined>,
}));

vi.mock('@/text', async () => createTextModuleMock({ translate: (key: string) => key }));
vi.mock('@/modal', () => ({ Modal: modalBoundary }));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        params: () => routeBoundary.params,
        pathname: '/new',
    }).module;
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        InteractionManager: {
            runAfterInteractions: (callback: () => void) => {
                callback();
                return { cancel: () => {} };
            },
        },
        useWindowDimensions: () => ({ width: 900, height: 800 }),
    });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@react-navigation/native', async (importOriginal) => {
    const React = await import('react');
    return {
        ...await importOriginal<typeof import('@react-navigation/native')>(),
        useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
        useIsFocused: () => true,
    };
});
// Vitest cannot follow the production owner's bundler-only `require('../sync.ts')` under Node.
// Keep the owner real and inject the actual Vitest-loaded singleton through that caller seam.
vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => {
        if (!syncSingletonHarness.current) throw new Error('Sync singleton test harness is not initialized');
        return syncSingletonHarness.current;
    },
}));
vi.mock('@/utils/system/sentry', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/system/sentry')>(),
    captureExceptionIfEnabled: (error: unknown, context?: unknown) => observabilityBoundary.capture(error, context),
}));
vi.mock('socket.io-client', () => ({
    io: (serverUrl: string, options: { auth?: { token?: string } }) => {
        const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        const publish = (event: string, ...args: unknown[]) => {
            for (const listener of listeners.get(event) ?? []) listener(...args);
        };
        const socket = {
            connected: false,
            id: 'composed-socket',
            connect() {
                socket.connected = true;
                socketBoundary.connects(serverUrl, options.auth?.token);
                publish('connect');
            },
            disconnect() {
                socket.connected = false;
                publish('disconnect', 'io client disconnect');
            },
            on(event: string, listener: (...args: unknown[]) => void) {
                const registered = listeners.get(event) ?? new Set();
                registered.add(listener);
                listeners.set(event, registered);
            },
            off(event: string, listener: (...args: unknown[]) => void) {
                listeners.get(event)?.delete(listener);
            },
            async emitWithAck(event: string, payload: unknown) {
                socketBoundary.emits({
                    serverUrl,
                    token: options.auth?.token,
                    event,
                    payload,
                });
                return {
                    ok: true,
                    result: { type: 'error', code: 'spawn_failed', retryable: false },
                };
            },
            timeout() {
                return socket;
            },
            emit: vi.fn(),
        };
        socketBoundary.controls.set(serverUrl, {
            disconnect: () => {
                socket.connected = false;
                publish('disconnect', 'transport close');
            },
            reconnect: () => socket.connect(),
        });
        return socket;
    },
}));

function tokenFor(accountId: string): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none' })}.${encode({ sub: accountId })}.signature`;
}

describe('multi-Home Session creation composition', () => {
    let localStorageHandle: LocalStorageMockHandle;
    let navigatorLocksDescriptor: PropertyDescriptor | undefined;
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
    let profiles: typeof import('@/sync/domains/server/serverProfiles');
    let TokenStorage: typeof import('@/auth/storage/tokenStorage')['TokenStorage'];
    let sync: typeof import('@/sync/sync')['sync'];

    beforeEach(async () => {
        const {
            CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
            MACHINE_PLAIN_DATA_KEY_MARKER,
        } = await import('@happier-dev/protocol');
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async (input) => {
            const url = String(input);
            socketBoundary.fetches(url);
            if (url.endsWith('/v1/features')) {
                return Response.json({
                    features: {},
                    capabilities: {
                        accountStoredContentCompatibility: {
                            v: 1,
                            minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                            currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                            declarationTransport: 'http-header-and-socket-auth-v1',
                        },
                    },
                });
            }
            if (url.includes('/v1/machines/machine-b')) {
                return Response.json({
                    machine: { id: 'machine-b', dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER },
                });
            }
            if (url.endsWith('/v1/auth/ping') || url.endsWith('/health')) return Response.json({ ok: true });
            return Response.json({ ok: false }, { status: 404 });
        });
    });

    beforeAll(async () => {
        localStorageHandle = installLocalStorageMock();
        navigatorLocksDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: {
                request: async function request<T>(
                    _name: string,
                    _options: LockOptions,
                    callback: () => T | Promise<T>,
                ): Promise<T> {
                    return await callback();
                },
            },
        });
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `multi_home_create_${Date.now()}_${Math.random()}`;
        routeBoundary.params = {
            machineId: 'machine-b',
            directory: '/workspace/project',
            spawnServerId: 'srv_home_b',
        };

        ({ sync } = await import('@/sync/sync'));
        syncSingletonHarness.current = sync;
        profiles = await import('@/sync/domains/server/serverProfiles');
        ({ TokenStorage } = await import('@/auth/storage/tokenStorage'));
    });

    afterAll(async () => {
        const { resetRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        resetRuntimeFetch();
        sync.disconnectServer();
        localStorageHandle.restore();
        if (navigatorLocksDescriptor) Object.defineProperty(globalThis.navigator, 'locks', navigatorLocksDescriptor);
        else Reflect.deleteProperty(globalThis.navigator, 'locks');
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        socketBoundary.controls.clear();
        syncSingletonHarness.current = null;
    });

    async function arrangeFocusedHomeA() {
        const homeA = await profiles.adoptHomeProfile({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_a',
                canonicalServerUrl: 'https://home-a.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home-a.example.test' }],
            },
            source: 'manual',
            preserveUserLabel: true,
        });
        const homeAScopeId = profiles.resolveServerProfileScopeId(homeA);
        const homeAToken = tokenFor('account-a');
        await expect(TokenStorage.setCredentialsForServerUrl(
            homeA.serverUrl,
            { serverId: homeAScopeId },
            { token: homeAToken },
        )).resolves.toBe(true);
        profiles.setActiveServerId(homeAScopeId);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: homeAScopeId,
            groups: [{ id: 'home-a-group', name: 'Home A', serverIds: [homeAScopeId] }],
        });
        return { profiles, homeA, homeAScopeId, homeAToken };
    }

    async function renderProductionCreateCaller(params: Readonly<{
        activeServerId: string;
        targetServerId?: string;
    }>) {
        const { createMachineFixture } = await import('@/dev/testkit/fixtures/machineFixtures');
        const { storage } = await import('@/sync/domains/state/storageStore');
        storage.getState().activateProfileScope({ serverId: params.activeServerId, accountId: 'account-a' });
        if (params.targetServerId) {
            storage.getState().applyMachines([
                createMachineFixture({
                    id: 'machine-b',
                    metadata: {
                        host: 'home-b-machine',
                        platform: 'linux',
                        happyCliVersion: '0.0.0-test',
                        happyHomeDir: '/workspace/.happy',
                        homeDir: '/workspace',
                    },
                }),
            ], true, { sourceServerId: params.targetServerId });
        }
        const { useNewSessionScreenModel } = await import('./useNewSessionScreenModel');
        return await renderHook(() => useNewSessionScreenModel({ draftId: 'multi-home-composed-draft' }));
    }

    function readProductionCreateAction(model: ReturnType<Awaited<ReturnType<typeof renderProductionCreateCaller>>['getCurrent']>) {
        return model.variant === 'simple'
            ? model.simpleProps.handleCreateSession
            : model.wizardProps.footer.handleCreateSession;
    }

    let homeA!: ServerProfile;
    let homeB!: ServerProfile;
    let homeAScopeId = '';
    let homeBScopeId = '';
    let homeAToken = '';
    let homeBToken = '';

    it('adopts two Homes and keeps explicit B creation scoped across A to B to A focus and reconnect', async () => {
        ({ homeA, homeAScopeId, homeAToken } = await arrangeFocusedHomeA());
        const focusBefore = profiles.getActiveServerSnapshot();
        const groupsBefore = profiles.loadHomeViewState()?.groups;
        const { adoptHomeProfileWithCredentials } = await import('@/sync/domains/server/adoptHomeProfile');
        homeBToken = tokenFor('account-b');

        await act(async () => {
            homeB = await adoptHomeProfileWithCredentials({
                descriptor: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    canonicalServerUrl: 'https://home-b.example.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home-b.example.test' }],
                },
                source: 'account-directory',
                preserveUserLabel: true,
                credentials: { token: homeBToken },
            });
        });
        homeBScopeId = profiles.resolveServerProfileScopeId(homeB);
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: focusBefore.serverId,
            serverUrl: focusBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()?.groups).toEqual(groupsBefore);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: homeBScopeId,
            groups: groupsBefore ?? [],
        });
        const createHook = await renderProductionCreateCaller({
            activeServerId: homeAScopeId,
            targetServerId: homeBScopeId,
        });
        expect(createHook.getCurrent().variant === 'simple'
            ? createHook.getCurrent().simpleProps.targetServerId
            : createHook.getCurrent().wizardProps.machine.serverId).toBe(homeBScopeId);

        try {
            await act(async () => profiles.setActiveServerId(homeB.id, { scope: 'device' }));
            expect(profiles.getActiveServerSnapshot().serverId).toBe(homeBScopeId);
            await act(async () => profiles.setActiveServerId(homeA.id, { scope: 'device' }));
            expect(profiles.getActiveServerSnapshot().serverId).toBe(homeAScopeId);

            const homeBSocket = socketBoundary.controls.get(homeB.serverUrl);
            expect(homeBSocket).toBeDefined();
            const homeBConnectsBeforeOutage = socketBoundary.connects.mock.calls
                .filter(([url]) => url === homeB.serverUrl).length;
            await act(async () => {
                homeBSocket?.disconnect();
                homeBSocket?.reconnect();
            });
            expect(socketBoundary.connects.mock.calls.filter(([url]) => url === homeB.serverUrl)).toHaveLength(
                homeBConnectsBeforeOutage + 1,
            );
            expect(profiles.getActiveServerSnapshot().serverId).toBe(homeAScopeId);

            socketBoundary.fetches.mockClear();
            socketBoundary.emits.mockClear();
            await act(async () => {
                await readProductionCreateAction(createHook.getCurrent())({ initialMessage: 'skip' });
            });
            expect(socketBoundary.fetches.mock.calls.length).toBeGreaterThan(0);
            expect(socketBoundary.fetches.mock.calls
                .every(([url]) => String(url).startsWith(homeB.serverUrl))).toBe(true);
            expect(socketBoundary.emits).toHaveBeenCalledTimes(1);
            expect(socketBoundary.emits.mock.calls[0]?.[0]).toMatchObject({
                serverUrl: homeB.serverUrl,
                token: homeBToken,
                payload: {
                    method: 'machine-b:session.spawnNew',
                    params: { executionTarget: { serverId: homeBScopeId, machineId: 'machine-b' } },
                },
            });
            expect(modalBoundary.alert).toHaveBeenCalledWith('common.error', 'newSession.failedToStart');
            expect(observabilityBoundary.capture).not.toHaveBeenCalled();
        } finally {
            await createHook.unmount().catch(() => undefined);
        }
    });

    it('keeps Home removal and push cleanup scoped, then fails the retired explicit B target closed', async () => {
        ({ homeA, homeAScopeId, homeAToken } = await arrangeFocusedHomeA());
        await expect(TokenStorage.setCredentialsForServerUrl(
            homeB.serverUrl,
            { serverId: homeBScopeId },
            { token: homeBToken },
        )).resolves.toBe(true);
        const createHook = await renderProductionCreateCaller({
            activeServerId: homeAScopeId,
            targetServerId: homeBScopeId,
        });
        try {
            const { saveLastRegisteredExpoPushToken } = await import('@/sync/domains/state/pushTokenRegistration');
            saveLastRegisteredExpoPushToken('ExponentPushToken[multi-home]');
            socketBoundary.fetches.mockClear();
            const { removeServerProfileUiAction } = await import('@/components/serverProfiles/removeServerProfileUiAction');
            await act(async () => {
                await expect(removeServerProfileUiAction({
                    profileId: homeBScopeId,
                    serverUrl: homeB.serverUrl,
                })).resolves.toEqual({ kind: 'completed' });
            });
            await expect(TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: homeBScopeId }))
                .resolves.toBeNull();
            await expect(TokenStorage.getCredentialsForServerUrl(homeA.serverUrl, { serverId: homeAScopeId }))
                .resolves.toEqual({ token: homeAToken });
            await vi.waitFor(() => {
                expect(socketBoundary.fetches.mock.calls.some(([url]) =>
                    String(url) === `${homeB.serverUrl}/v1/push-tokens/ExponentPushToken%5Bmulti-home%5D`)).toBe(true);
            });
            expect(socketBoundary.fetches.mock.calls.some(([url]) => String(url).startsWith(`${homeA.serverUrl}/v1/push-tokens`)))
                .toBe(false);

            expect(profiles.getActiveServerSnapshot().serverId).toBe(homeAScopeId);
            expect(profiles.listServerProfiles().filter((profile) => profile.serverIdentityId === 'srv_home_b')).toHaveLength(0);
            await createHook.rerender();
            expect(createHook.getCurrent().variant === 'simple'
                ? createHook.getCurrent().simpleProps.targetServerId
                : createHook.getCurrent().wizardProps.machine.serverId).toBeNull();
            socketBoundary.fetches.mockClear();
            socketBoundary.emits.mockClear();
            await act(async () => {
                await readProductionCreateAction(createHook.getCurrent())({ initialMessage: 'skip' });
            });
            expect(socketBoundary.fetches).not.toHaveBeenCalled();
            expect(socketBoundary.emits).not.toHaveBeenCalled();
            expect(modalBoundary.alert).toHaveBeenCalledWith('common.error', 'newSession.failedToStart');
            expect(observabilityBoundary.capture).not.toHaveBeenCalled();
        } finally {
            await createHook.unmount().catch(() => undefined);
        }
    });
});
