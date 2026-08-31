import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Machine } from '@/sync/domains/state/storageTypes';

import {
    flushHookEffects,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { installSearchRouteCommonModuleMocks } from './searchRouteTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const machineRpcSpy = vi.fn();
const routerPushSpy = vi.fn();
const homeSearchSpy = vi.fn();
const featureEnabledState: Record<string, boolean> = { 'memory.search': true };
const machinesState = vi.hoisted(() => ({
    machines: [] as Machine[],
}));
const serverProfilesState = vi.hoisted(() => ({
    profileSource: 'desktop-personal-home' as string | undefined,
}));
const featureRuntimeState = vi.hoisted(() => ({
    storagePolicy: 'plaintext_only' as string | undefined,
    snapshotStatus: 'ready' as string,
    homeSearch: { enabled: true, provider: 'home' } as unknown,
}));

installSearchRouteCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Text: (props: any) => React.createElement('Text', props, props.children),
            TextInput: (props: any) => React.createElement('TextInput', props),
            Pressable: (props: any) => React.createElement('Pressable', props, props.children),
            ScrollView: (props: any) => React.createElement('ScrollView', props, props.children),
            Platform: {
                OS: 'web',
                select: (options: any) => (options && 'default' in options ? options.default : undefined),
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                push: routerPushSpy,
                replace: vi.fn(),
                back: vi.fn(),
                setParams: vi.fn(),
            },
        }).module;
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    text: '#111',
                    textSecondary: '#666',
                    shadow: { color: '#000', opacity: 0.2 },
                    input: { placeholder: '#999', background: '#fff' },
                    accent: { blue: '#07f' },
                    success: '#0a0',
                },
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => key,
        });
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useAllMachines: () => machinesState.machines,
            },
        });
    },
});

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement(
        'DropdownMenu',
        {
            ...props,
            testID: props.testID ?? props.itemTrigger?.itemProps?.testID,
        },
    ),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureEnabledState[featureId] === true,
}));

vi.mock('@/sync/store/hooks', () => ({
    useAllSessions: () => ([
        { id: 'sess-1', metadata: { title: 'Session One' } },
    ]),
    useLocalSetting: () => null,
}));

vi.mock('@/utils/sessions/sessionUtils', () => ({
    getSessionName: (session: any) => session?.metadata?.title ?? session?.id ?? 'session',
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'srv_1', generation: 1 }),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'srv_1', serverUrl: '', generation: 1 }),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => 1,
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>()),
    getServerProfileById: () => serverProfilesState.profileSource === undefined
        ? null
        : {
            id: 'srv_1',
            name: 'Home profile',
            serverUrl: 'https://home.example.test',
            source: serverProfilesState.profileSource,
        },
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: () => {
        if (featureRuntimeState.snapshotStatus !== 'ready') {
            return { status: featureRuntimeState.snapshotStatus };
        }
        return {
            status: 'ready',
            features: {
                capabilities: {
                    encryption: featureRuntimeState.storagePolicy === undefined
                        ? {}
                        : { storagePolicy: featureRuntimeState.storagePolicy },
                    homeSearch: featureRuntimeState.homeSearch,
                },
            },
        };
    },
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcSpy,
}));

vi.mock('@/sync/domains/memory/searchHomeMemory', () => ({
    searchHomeMemory: homeSearchSpy,
}));

afterEach(() => {
    machineRpcSpy.mockReset();
    routerPushSpy.mockReset();
    homeSearchSpy.mockReset();
    featureEnabledState['memory.search'] = true;
    machinesState.machines = [];
    serverProfilesState.profileSource = 'desktop-personal-home';
    featureRuntimeState.storagePolicy = 'plaintext_only';
    featureRuntimeState.snapshotStatus = 'ready';
    featureRuntimeState.homeSearch = { enabled: true, provider: 'home' };
    standardCleanup();
});

function createHomeSearchHit(sessionId: string, summary: string) {
    return {
        sessionId,
        seqFrom: 1,
        seqTo: 1,
        createdAtFromMs: 1,
        createdAtToMs: 1,
        summary,
        score: 0.9,
    };
}

async function renderMemorySearchScreen() {
    const Screen = (await import('@/app/(app)/search')).default;
    return renderScreen(React.createElement(Screen));
}

function findRequiredTestNode(
    screen: Awaited<ReturnType<typeof renderScreen>>,
    testID: string,
) {
    const node = screen.findByTestId(testID);
    expect(node).toBeTruthy();
    if (!node) {
        throw new Error(`Expected ${testID} to exist`);
    }
    return node;
}

async function settleMemorySearchScreen() {
    await flushHookEffects();
}

function collectScreenText(screen: Awaited<ReturnType<typeof renderScreen>>): string[] {
    return screen.findAllByType('Text' as any).map((node) => node.props.children);
}

async function submitQuery(screen: Awaited<ReturnType<typeof renderScreen>>, query: string) {
    const input = findRequiredTestNode(screen, 'memory-search-query');
    await act(async () => {
        input.props.onChangeText?.(query);
    });
    const btn = findRequiredTestNode(screen, 'memory-search-submit');
    await act(async () => {
        btn.props.onPress?.();
    });
    await settleMemorySearchScreen();
}

describe('Memory search screen — Personal Home provider', () => {
    it('searches Home with zero machines and a dead daemon, renders grouped hits, navigates, and never calls daemon RPC', async () => {
        serverProfilesState.profileSource = 'account-directory';
        machinesState.machines = [];
        machineRpcSpy.mockImplementation(async () => {
            throw new Error('daemon RPC must not be called for the Home provider');
        });
        homeSearchSpy.mockResolvedValueOnce({
            v: 1,
            ok: true,
            hits: [createHomeSearchHit('sess-1', 'Vector cache summary')],
        });

        const screen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();

        expect(machineRpcSpy).not.toHaveBeenCalled();
        expect(screen.findAllByTestId('memory-search-machine-trigger')).toHaveLength(0);
        expect(findRequiredTestNode(screen, 'memory-search-query').props.accessibilityLabel).toBe('memorySearchSettings.screen.searchPlaceholder');
        expect(findRequiredTestNode(screen, 'memory-search-submit').props.accessibilityLabel).toBe('memorySearchSettings.screen.searchPlaceholder');
        expect(collectScreenText(screen)).toContain('memorySearchSettings.screen.searchPlaceholder');

        await submitQuery(screen, 'openclaw');

        expect(homeSearchSpy).toHaveBeenCalledWith(expect.objectContaining({
            query: 'openclaw',
        }));
        expect(machineRpcSpy).not.toHaveBeenCalled();

        const texts = collectScreenText(screen);
        expect(texts).toContain('Session One');
        expect(texts).toContain('Vector cache summary');

        const hitNodes = screen.findAll((node) => (
            typeof node.props?.testID === 'string' && node.props.testID.startsWith('memory-search-hit')
        ));
        expect(hitNodes.length).toBeGreaterThan(0);
        await act(async () => {
            hitNodes[0]?.props.onPress?.();
        });
        expect(routerPushSpy).toHaveBeenCalledWith('/session/sess-1?jumpSeq=1');
    });

    it('keeps controls, state, and bounded results under one stable scroll owner', async () => {
        homeSearchSpy.mockResolvedValueOnce({
            v: 1,
            ok: true,
            hits: Array.from({ length: 20 }, (_, index) => createHomeSearchHit(`sess-${index + 1}`, `Result ${index + 1}`)),
        });

        const screen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();
        await submitQuery(screen, 'bounded');

        const scrollOwners = screen.findAllByType('ScrollView' as any);
        expect(scrollOwners).toHaveLength(1);
        expect(scrollOwners[0]?.props.testID).toBe('memory-search-scroll');
        expect(scrollOwners[0]?.props.contentInsetAdjustmentBehavior).toBe('automatic');
        expect(collectScreenText(screen)).toContain('Result 20');
    });

    it('keeps useful results visible when a refresh fails and provides an explicit clear action', async () => {
        homeSearchSpy
            .mockResolvedValueOnce({
                v: 1,
                ok: true,
                hits: [createHomeSearchHit('sess-1', 'Keep this result')],
            })
            .mockResolvedValueOnce({
                v: 1,
                ok: false,
                errorCode: 'temporarily_unavailable',
            });

        const screen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();
        await submitQuery(screen, 'first');
        expect(collectScreenText(screen)).toContain('Keep this result');

        await submitQuery(screen, 'retry');
        expect(collectScreenText(screen)).toContain('Keep this result');
        expect(collectScreenText(screen)).toContain('common.requestFailed');

        const clear = findRequiredTestNode(screen, 'memory-search-clear');
        expect(clear.props.accessibilityLabel).toBe('common.clearSearch');
        await act(async () => {
            clear.props.onPress?.();
        });
        expect(findRequiredTestNode(screen, 'memory-search-query').props.value).toBe('');
        expect(collectScreenText(screen)).not.toContain('Keep this result');
    });

    it('surfaces indexing and unavailable Home capability without querying Home or daemon, then safely falls back when missing', async () => {
        machineRpcSpy.mockImplementation(async () => {
            throw new Error('daemon RPC must not be called for the Home provider');
        });
        featureRuntimeState.homeSearch = {
            enabled: false,
            provider: 'home',
            reason: 'indexing',
        };

        const indexingScreen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();

        expect(collectScreenText(indexingScreen)).toContain('memorySearchSettings.status.indexing');
        expect(findRequiredTestNode(indexingScreen, 'memory-search-submit').props.accessibilityState).toEqual({ disabled: true });

        featureRuntimeState.homeSearch = {
            enabled: false,
            provider: 'home',
            reason: 'index_unavailable',
        };

        const screen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();

        expect(collectScreenText(screen)).toContain('memorySearchSettings.status.unavailableLight');
        expect(findRequiredTestNode(screen, 'memory-search-submit').props.accessibilityState).toEqual({ disabled: true });
        expect(homeSearchSpy).not.toHaveBeenCalled();
        expect(machineRpcSpy).not.toHaveBeenCalled();

        featureRuntimeState.homeSearch = undefined;
        const missingCapabilityScreen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();

        expect(findRequiredTestNode(missingCapabilityScreen, 'memory-search-submit').props.accessibilityState).toEqual({ disabled: true });
        expect(missingCapabilityScreen.findAllByTestId('memory-search-machine-trigger')).toHaveLength(1);
        expect(homeSearchSpy).not.toHaveBeenCalled();
        expect(machineRpcSpy).not.toHaveBeenCalled();
    });

    it('keeps non-plain Homes on the advertised daemon provider without calling Home', async () => {
        serverProfilesState.profileSource = 'account-directory';
        featureRuntimeState.storagePolicy = 'required_e2ee';
        featureRuntimeState.homeSearch = {
            enabled: false,
            provider: 'daemon',
            reason: 'non_plain_home',
        };
        machinesState.machines = [{
            id: 'm1',
            seq: 0,
            createdAt: 0,
            updatedAt: 0,
            active: true,
            activeAt: 0,
            metadata: {
                displayName: 'Machine 1',
                host: 'm1',
                platform: 'darwin',
                happyCliVersion: '0.0.0-test',
                happyHomeDir: '/Users/m1/.happier',
                homeDir: '/Users/m1',
            },
            metadataVersion: 0,
            daemonState: null,
            daemonStateVersion: 0,
        }];
        machineRpcSpy.mockImplementation(async (params: any) => {
            if (params?.method === 'daemon.memory.status') {
                return {
                    v: 1,
                    enabled: true,
                    indexMode: 'hints',
                    hintsIndexReady: true,
                    deepIndexReady: false,
                    activeIndexReady: true,
                    activeIndexSearchable: true,
                    indexContent: {
                        lightShardCount: 1,
                        lightTermCount: 12,
                        deepChunkCount: 0,
                        deepEmbeddingCount: 0,
                        searchableSessionCount: 1,
                        lastIndexedAtMs: 1,
                        latestIndexedMessageAtMs: 1,
                    },
                    embeddingsEnabled: false,
                    embeddingsMode: 'disabled',
                    embeddingsPresetId: null,
                    embeddingsProviderKind: null,
                    embeddingsModelId: null,
                    embeddingsRuntimeState: 'ready',
                    embeddingsUsingFallback: false,
                    tier1DbPath: '/tmp/memory.sqlite',
                    deepDbPath: null,
                    tier1DbBytes: 1024,
                    deepDbBytes: null,
                };
            }
            if (params?.method === 'daemon.memory.search') {
                return { v: 1, ok: true, hits: [] };
            }
            throw new Error('unexpected rpc');
        });

        const screen = await renderMemorySearchScreen();
        await settleMemorySearchScreen();

        expect(machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.memory.status',
        }));

        await submitQuery(screen, 'openclaw');

        expect(machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.memory.search',
        }));
        expect(homeSearchSpy).not.toHaveBeenCalled();
    });

});
