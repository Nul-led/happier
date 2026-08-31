import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { renderHook } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock, type LocalStorageMockHandle } from '@/auth/storage/tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();

const socketBoundary = vi.hoisted(() => ({
    connects: vi.fn(),
    emits: vi.fn(),
    fetches: vi.fn(),
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
        const socket = {
            connected: false,
            id: 'composed-socket',
            connect() {
                socket.connected = true;
                socketBoundary.connects(serverUrl, options.auth?.token);
                for (const listener of listeners.get('connect') ?? []) listener();
            },
            disconnect() {
                socket.connected = false;
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

    beforeEach(async () => {
        vi.resetModules();
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
        socketBoundary.connects.mockClear();
        socketBoundary.emits.mockClear();
        socketBoundary.fetches.mockClear();
        modalBoundary.alert.mockClear();
        modalBoundary.confirm.mockClear();
        observabilityBoundary.capture.mockClear();
        routeBoundary.params = {
            machineId: 'machine-b',
            directory: '/workspace/project',
        };

        const { sync } = await import('@/sync/sync');
        syncSingletonHarness.current = sync;

        const {
            CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
            MACHINE_PLAIN_DATA_KEY_MARKER,
        } = await import('@happier-dev/protocol');
        const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        setRuntimeFetch(async (input) => {
            const url = String(input);
            socketBoundary.fetches(url);
            if (url.endsWith('/v1/features')) {
                return new Response(JSON.stringify({
                    features: {},
                    capabilities: {
                        accountStoredContentCompatibility: {
                            v: 1,
                            minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                            currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                            declarationTransport: 'http-header-and-socket-auth-v1',
                        },
                    },
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (url.includes('/v1/machines/machine-b')) {
                return new Response(JSON.stringify({
                    machine: { id: 'machine-b', dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER },
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (url.endsWith('/v1/auth/ping')) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.endsWith('/health')) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ ok: false }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        });
    });

    afterEach(async () => {
        const { resetRuntimeFetch } = await import('@/utils/system/runtimeFetch');
        resetRuntimeFetch();
        localStorageHandle.restore();
        if (navigatorLocksDescriptor) Object.defineProperty(globalThis.navigator, 'locks', navigatorLocksDescriptor);
        else Reflect.deleteProperty(globalThis.navigator, 'locks');
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        vi.restoreAllMocks();
        syncSingletonHarness.current = null;
    });

    async function arrangeFocusedHomeA() {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
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

    it('adopts B without focus mutation and creates only through B selected by device-global HomeView', async () => {
        const { profiles, homeA, homeAScopeId, homeAToken } = await arrangeFocusedHomeA();
        const focusBefore = profiles.getActiveServerSnapshot();
        const groupsBefore = profiles.loadHomeViewState()?.groups;
        const { adoptHomeProfileWithCredentials } = await import('@/sync/domains/server/adoptHomeProfile');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const homeBToken = tokenFor('account-b');

        const homeB = await adoptHomeProfileWithCredentials({
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
        const homeBScopeId = profiles.resolveServerProfileScopeId(homeB);
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
        const model = createHook.getCurrent();
        expect(model.variant === 'simple' ? model.simpleProps.targetServerId : model.wizardProps.machine.serverId)
            .toBe(homeBScopeId);
        expect(socketBoundary.connects).toHaveBeenCalledWith(homeB.serverUrl, homeBToken);
        expect(socketBoundary.connects).not.toHaveBeenCalledWith(homeA.serverUrl, homeAToken);
        socketBoundary.fetches.mockClear();
        socketBoundary.emits.mockClear();
        await act(async () => {
            await readProductionCreateAction(createHook.getCurrent())({ initialMessage: 'skip' });
        });

        expect(profiles.listServerProfiles().filter((profile) => profile.serverIdentityId === 'srv_home_b')).toHaveLength(1);
        await expect(TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: homeBScopeId }))
            .resolves.toEqual({ token: homeBToken });
        await expect(TokenStorage.getCredentialsForServerUrl(homeA.serverUrl, { serverId: homeAScopeId }))
            .resolves.toEqual({ token: homeAToken });
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: focusBefore.serverId,
            serverUrl: focusBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()?.groups).toEqual(groupsBefore);
        expect(socketBoundary.fetches.mock.calls.length).toBeGreaterThan(0);
        expect(socketBoundary.fetches.mock.calls.every(([url]) =>
            String(url).startsWith(homeB.serverUrl))).toBe(true);
        expect(socketBoundary.emits).toHaveBeenCalledTimes(1);
        expect(socketBoundary.emits.mock.calls[0]?.[0]).toMatchObject({
            serverUrl: homeB.serverUrl,
            token: homeBToken,
            payload: {
                method: 'machine-b:session.spawnNew',
                params: { executionTarget: { serverId: homeBScopeId, machineId: 'machine-b' } },
            },
        });
        expect(modalBoundary.alert).toHaveBeenCalledOnce();
        expect(modalBoundary.alert).toHaveBeenCalledWith('common.error', 'newSession.failedToStart');
        expect(observabilityBoundary.capture).not.toHaveBeenCalled();

        await createHook.unmount();
    });

    it('rejects an explicit missing B target without falling back to focused A or issuing create', async () => {
        const { profiles, homeA, homeAScopeId, homeAToken } = await arrangeFocusedHomeA();
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: 'srv_missing_home_b',
            groups: [{ id: 'home-a-group', name: 'Home A', serverIds: [homeAScopeId] }],
        });
        const createHook = await renderProductionCreateCaller({ activeServerId: homeAScopeId });
        const model = createHook.getCurrent();
        expect(model.variant === 'simple' ? model.simpleProps.targetServerId : model.wizardProps.machine.serverId)
            .toBeNull();
        socketBoundary.fetches.mockClear();
        socketBoundary.connects.mockClear();
        socketBoundary.emits.mockClear();
        await act(async () => {
            await readProductionCreateAction(createHook.getCurrent())({ initialMessage: 'skip' });
        });

        expect(profiles.getActiveServerSnapshot().serverId).toBe(homeAScopeId);
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.getCredentialsForServerUrl(homeA.serverUrl, { serverId: homeAScopeId }))
            .resolves.toEqual({ token: homeAToken });
        expect(socketBoundary.fetches).not.toHaveBeenCalled();
        expect(socketBoundary.connects).not.toHaveBeenCalled();
        expect(socketBoundary.emits).not.toHaveBeenCalled();

        await createHook.unmount();
    });
});
