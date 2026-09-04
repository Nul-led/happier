import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol';
import { SESSION_MACHINE_TARGET_UNAVAILABLE_ERROR_CODE } from '@/sync/runtime/sessionMachineRpcErrorCodes';

import { createDeferred, flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';
import type { MachineAdministrationTargetSelectionMockController } from '@/dev/testkit/mocks/machineAdministrationTargetSelection';

const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());
const homeSearchMock = vi.hoisted(() => vi.fn());
const ensureSessionVisibleMock = vi.hoisted(() => vi.fn(async () => ({ kind: 'available' as const })));
const unavailableSessionIds = vi.hoisted(() => new Set<string>());
const scopedSessionRequestMock = vi.hoisted(() => vi.fn(async (path: string) => {
    const detailMatch = path.match(/^\/v2\/sessions\/([^/?]+)$/);
    if (detailMatch) {
        const sessionId = decodeURIComponent(detailMatch[1]!);
        if (unavailableSessionIds.has(sessionId)) {
            return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 });
        }
        return new Response(JSON.stringify({
            session: {
                id: sessionId,
                createdAt: 1,
                updatedAt: 2,
                seq: 3,
                active: true,
                activeAt: 2,
                encryptionMode: 'plain',
                dataEncryptionKey: null,
                metadataVersion: 1,
                metadata: JSON.stringify({ path: `/work/${sessionId}` }),
                agentStateVersion: 1,
                agentState: null,
                share: null,
            },
        }), { status: 200 });
    }
    return new Response(JSON.stringify({ sessions: [], nextCursor: null, hasNext: false }), { status: 200 });
}));
const captureSessionRequestAuthorityMock = vi.hoisted(() => vi.fn(async ({ scope }: { scope: { serverId: string; accountId: string } }) => ({
    scope,
    context: { scope: 'scoped', credentials: { token: scope.accountId } },
    request: scopedSessionRequestMock,
    release: async () => undefined,
})));
const featureEnabledState = vi.hoisted(() => ({ memorySearch: true, search: false }));
const activeServerState = vi.hoisted(() => ({ serverId: 'server-a' as string | null }));
const accountScopeState = vi.hoisted(() => ({
    current: { serverId: 'server-a', accountId: 'account-a' } as { serverId: string; accountId: string } | null,
}));
const featureRuntimeState = vi.hoisted(() => ({ homeSearch: undefined as unknown }));
const storageState = vi.hoisted(() => {
    const state = {
        sessions: {} as Record<string, { id: string; serverId?: string }>,
        sessionListRowStateByServerId: {} as Record<string, Record<string, unknown>>,
        clearSessionListRowsForServerScope: vi.fn((serverId: string) => {
            delete state.sessionListRowStateByServerId[serverId];
        }),
        reconcileSessionListRowsForServerScope: vi.fn((serverId: string, rows: ReadonlyArray<{ id: string }>) => {
            state.sessionListRowStateByServerId[serverId] = Object.fromEntries(rows.map((row) => [row.id, row]));
        }),
        mergeSessionListRowsForServerScope: vi.fn((serverId: string, rows: ReadonlyArray<{ id: string }>) => {
            state.sessionListRowStateByServerId[serverId] = {
                ...state.sessionListRowStateByServerId[serverId],
                ...Object.fromEntries(rows.map((row) => [row.id, row])),
            };
        }),
    };
    return state;
});
const selectionHolder = vi.hoisted(() => ({
    controller: null as MachineAdministrationTargetSelectionMockController | null,
}));
const credentialMutationListeners = vi.hoisted(() => new Set<(event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void>());
const credentialAccounts = vi.hoisted(() => new Map<string, string>([
    ['server-a', 'account-a'],
    ['server-b', 'account-b'],
    ['home-b', 'account-b'],
]));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcWithServerScopeMock,
}));

vi.mock('@/sync/domains/memory/searchHomeMemory', () => ({
    searchHomeMemory: homeSearchMock,
}));

// The genuine boundary under the materialization owner: the sync engine's
// explicit-server session reader. Everything above it stays real.
vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({
        ensureSessionVisibleForMessageRoute: ensureSessionVisibleMock,
        getSyncTuning: () => ({ sessionListHydrationConcurrencyLimit: 2 }),
    }),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope', () => ({
    captureSessionRequestAuthorityForServerAccountScope: captureSessionRequestAuthorityMock,
}));

vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: { getState: () => storageState },
}));

vi.mock('@/sync/store/hooks', () => ({
    useActiveServerAccountScope: () => accountScopeState.current,
}));
vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({ useServerProfilesGeneration: () => 1 }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    getServerProfileById: (serverId: string) => ({ id: serverId, serverUrl: `https://${serverId}.example.test` }),
    resolveServerProfileScopeIdForIdentifier: (serverId: string) => serverId,
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: async (_url: string, options: { serverId?: string }) => ({
            token: credentialAccounts.get(options.serverId ?? '') ?? '',
        }),
    },
    subscribeHomeCredentialMutations: (listener: (event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void) => {
        credentialMutationListeners.add(listener);
        return () => credentialMutationListeners.delete(listener);
    },
}));
vi.mock('@/utils/auth/parseToken', () => ({ parseToken: (token: string) => token }));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => (
        featureId === 'memory.search'
            ? featureEnabledState.memorySearch
            : featureId === 'search' && featureEnabledState.search
    ),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: activeServerState.serverId, serverUrl: '', generation: 1 }),
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: () => ({
        status: 'ready',
        features: { capabilities: { homeSearch: featureRuntimeState.homeSearch } },
    }),
    useServerFeaturesSnapshotForServerId: () => ({
        status: 'ready',
        features: { capabilities: { homeSearch: featureRuntimeState.homeSearch } },
    }),
}));

// Persisted Account selection plus the all-profile machine inventory is the boundary;
// the real explicit-target resolution above it stays in the path.
vi.mock('@/sync/domains/machines/administration/useTargetSelection', async () => {
    const { createMachineAdministrationTargetSelectionMock } = await import(
        '@/dev/testkit/mocks/machineAdministrationTargetSelection'
    );
    const mock = createMachineAdministrationTargetSelectionMock({
        serverId: 'server-a',
        serverIdentityId: 'server-a',
        machines: [{ machineId: 'machine-a', displayName: 'Mac' }],
    });
    selectionHolder.controller = mock.controller;
    return mock.module;
});

function selection(): MachineAdministrationTargetSelectionMockController {
    const controller = selectionHolder.controller;
    if (!controller) throw new Error('machine selection mock was not installed');
    return controller;
}

/** No explicitly selected usable memory machine, and none available to select. */
function withoutSelectedMemoryMachine(): void {
    selection().setMachines([]);
    selection().select(null);
}

function createMemoryStatusResponse(searchable: boolean) {
    return {
        v: 1,
        enabled: true,
        indexMode: 'hints',
        hintsIndexReady: true,
        deepIndexReady: false,
        activeIndexReady: true,
        activeIndexSearchable: searchable,
        indexContent: searchable
            ? {
                lightShardCount: 1,
                lightTermCount: 12,
                deepChunkCount: 0,
                deepEmbeddingCount: 0,
                searchableSessionCount: 1,
                lastIndexedAtMs: 1,
                latestIndexedMessageAtMs: 1,
            }
            : null,
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

function createMemorySearchHit(sessionId: string, summary = 'Matching summary', score = 0.9) {
    return {
        sessionId,
        seqFrom: 1,
        seqTo: 1,
        createdAtFromMs: 1,
        createdAtToMs: 1,
        summary,
        score,
    };
}

/** The Home this Account focuses advertises a ready plaintext index. */
function withReadyHomeSearch(): void {
    featureEnabledState.search = true;
    featureRuntimeState.homeSearch = { enabled: true };
}

async function renderMemoryAugmentationHook(props: Readonly<{
    searchQuery: string;
    enabled?: boolean;
    eligibleSessionIds?: readonly string[];
}>) {
    const { useSessionListMemorySearchAugmentation } = await import('./useSessionListMemorySearchAugmentation');
    return await renderHook(
        (nextProps: typeof props) => useSessionListMemorySearchAugmentation(nextProps),
        { initialProps: props },
    );
}

afterEach(() => {
    vi.useRealTimers();
    machineRpcWithServerScopeMock.mockReset();
    homeSearchMock.mockReset();
    ensureSessionVisibleMock.mockReset();
    ensureSessionVisibleMock.mockResolvedValue({ kind: 'available' });
    unavailableSessionIds.clear();
    scopedSessionRequestMock.mockClear();
    captureSessionRequestAuthorityMock.mockReset();
    captureSessionRequestAuthorityMock.mockImplementation(async ({ scope }: { scope: { serverId: string; accountId: string } }) => ({
        scope,
        context: { scope: 'scoped', credentials: { token: scope.accountId } },
        request: scopedSessionRequestMock,
        release: async () => undefined,
    }));
    featureEnabledState.memorySearch = true;
    featureEnabledState.search = false;
    activeServerState.serverId = 'server-a';
    accountScopeState.current = { serverId: 'server-a', accountId: 'account-a' };
    featureRuntimeState.homeSearch = undefined;
    storageState.sessions = {};
    storageState.sessionListRowStateByServerId = {};
    storageState.clearSessionListRowsForServerScope.mockClear();
    storageState.reconcileSessionListRowsForServerScope.mockClear();
    storageState.mergeSessionListRowsForServerScope.mockClear();
    selectionHolder.controller?.reset();
    credentialMutationListeners.clear();
    credentialAccounts.clear();
    credentialAccounts.set('server-a', 'account-a');
    credentialAccounts.set('server-b', 'account-b');
    credentialAccounts.set('home-b', 'account-b');
    standardCleanup();
});

describe('useSessionListMemorySearchAugmentation', () => {
    it('surfaces real metadata-inventory failure as retryable and clears it when the query retires', async () => {
        featureEnabledState.memorySearch = false;
        featureEnabledState.search = false;
        captureSessionRequestAuthorityMock.mockRejectedValue(new Error('inventory unavailable'));
        const {
            useSessionListMemorySearchAugmentationForContext,
            useSessionListMemorySearchContext,
        } = await import('./useSessionListMemorySearchAugmentation');
        const hook = await renderHook(
            (props: { searchQuery: string }) => useSessionListMemorySearchAugmentationForContext(
                props,
                useSessionListMemorySearchContext({ serverId: 'server-a' }),
            ),
            { initialProps: { searchQuery: 'payments' } },
        );
        await flushHookEffects({ cycles: 4 });

        expect(hook.getCurrent().sessionInventoryStatus).toBe('error');
        expect(captureSessionRequestAuthorityMock).toHaveBeenCalledTimes(1);

        await act(async () => hook.getCurrent().retrySessionInventory());
        await flushHookEffects({ cycles: 4 });
        expect(hook.getCurrent().sessionInventoryStatus).toBe('error');
        expect(captureSessionRequestAuthorityMock).toHaveBeenCalledTimes(2);

        await hook.rerender({ searchQuery: '' });
        await flushHookEffects({ cycles: 2 });
        expect(hook.getCurrent().sessionInventoryStatus).toBe('idle');
    });

    it('keeps an aborted metadata inventory silent after the contextual query retires', async () => {
        featureEnabledState.memorySearch = false;
        featureEnabledState.search = false;
        const pendingAuthority = createDeferred<{
            scope: { serverId: string; accountId: string };
            context: { scope: string };
            request: () => Promise<Response>;
            release: () => Promise<void>;
        }>();
        captureSessionRequestAuthorityMock.mockImplementationOnce(async () => pendingAuthority.promise);
        const {
            useSessionListMemorySearchAugmentationForContext,
            useSessionListMemorySearchContext,
        } = await import('./useSessionListMemorySearchAugmentation');
        const hook = await renderHook(
            (props: { searchQuery: string }) => useSessionListMemorySearchAugmentationForContext(
                props,
                useSessionListMemorySearchContext({ serverId: 'server-a' }),
            ),
            { initialProps: { searchQuery: 'payments' } },
        );
        await flushHookEffects({ cycles: 3 });
        expect(hook.getCurrent().sessionInventoryStatus).toBe('loading');

        await hook.rerender({ searchQuery: '' });
        await flushHookEffects({ cycles: 2 });
        expect(hook.getCurrent().sessionInventoryStatus).toBe('idle');

        pendingAuthority.resolve({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            context: { scope: 'scoped' },
            request: async () => new Response('{}'),
            release: async () => undefined,
        });
        await flushHookEffects({ cycles: 3 });
        expect(hook.getCurrent().sessionInventoryStatus).toBe('idle');
    });


    it('keys results by Account, provider, exact Home/server, and daemon machine', async () => {
        const { buildSessionListMemorySearchScopeKey } = await import('./useSessionListMemorySearchAugmentation');
        const base = {
            accountScope: { serverId: 'server-a', accountId: 'account-a' },
            provider: 'daemon' as const,
            serverId: 'server-a',
            machineId: 'machine-a',
        };
        const identities = [
            buildSessionListMemorySearchScopeKey(base),
            buildSessionListMemorySearchScopeKey({
                ...base,
                accountScope: { serverId: 'server-a', accountId: 'account-b' },
            }),
            buildSessionListMemorySearchScopeKey({ ...base, provider: 'home', machineId: null }),
            buildSessionListMemorySearchScopeKey({ ...base, serverId: 'server-b' }),
            buildSessionListMemorySearchScopeKey({ ...base, machineId: 'machine-b' }),
        ];

        expect(new Set(identities).size).toBe(identities.length);
    });

    it('retires both the contextual query and rows when machine or provider authority switches', async () => {
        vi.useFakeTimers();
        selection().setMachines([
            { machineId: 'machine-a', displayName: 'A' },
            { machineId: 'machine-b', displayName: 'B' },
        ]);
        selection().select('machine-a');
        storageState.sessions = { 'same-session': { id: 'same-session', serverId: 'server-a' } };
        machineRpcWithServerScopeMock.mockResolvedValue({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('same-session')],
        });

        const { buildSessionListRetentionKey } = await import('../scroll/sessionListRetentionKey');
        const { useSessionListHeaderFilterRetention } = await import('./useSessionListHeaderFilterRetention');
        const {
            useSessionListMemorySearchAugmentationForContext,
            useSessionListMemorySearchContext,
        } = await import('./useSessionListMemorySearchAugmentation');
        const hook = await renderHook(() => {
            const memoryContext = useSessionListMemorySearchContext();
            const filters = useSessionListHeaderFilterRetention(
                buildSessionListRetentionKey(
                    'all',
                    `account-a:list-home-a\u0000transcript:${memoryContext.activeScopeKey}`,
                ),
            );
            const memory = useSessionListMemorySearchAugmentationForContext(
                { searchQuery: filters.searchQuery },
                memoryContext,
            );
            return { ...filters, memory };
        });
        await act(async () => hook.getCurrent().setSearchQuery('private-query'));
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });
        expect([...hook.getCurrent().memory.memoryMatchedSessionKeys]).toEqual(['server-a:same-session']);

        await act(async () => selection().select('machine-b'));

        expect(hook.getCurrent().searchQuery).toBe('');
        expect([...hook.getCurrent().memory.memoryMatchedSessionKeys]).toEqual([]);

        await act(async () => hook.getCurrent().setSearchQuery('private-query'));
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });
        expect([...hook.getCurrent().memory.memoryMatchedSessionKeys]).toEqual(['server-a:same-session']);

        await act(async () => {
            withReadyHomeSearch();
            hook.rerender();
        });

        expect(hook.getCurrent().searchQuery).toBe('');
        expect([...hook.getCurrent().memory.memoryMatchedSessionKeys]).toEqual([]);
    });

    it('queries and keys Home results to the list-selected Home instead of the focused Home', async () => {
        vi.useFakeTimers();
        withReadyHomeSearch();
        activeServerState.serverId = 'home-a';
        storageState.sessions = { 'same-session': { id: 'same-session', serverId: 'home-b' } };
        homeSearchMock.mockResolvedValue({
            ok: true,
            hits: [createMemorySearchHit('same-session')],
        });

        const {
            useSessionListMemorySearchAugmentationForContext,
            useSessionListMemorySearchContext,
        } = await import('./useSessionListMemorySearchAugmentation');
        const hook = await renderHook(() => {
            const context = useSessionListMemorySearchContext({ serverId: 'home-b' });
            return useSessionListMemorySearchAugmentationForContext({ searchQuery: 'vector' }, context);
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(homeSearchMock).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'home-b',
            accountId: 'account-b',
        }));
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['home-b:same-session']);
        expect(hook.getCurrent().memoryMatchedSessionTargets).toEqual([
            expect.objectContaining({ serverId: 'home-b', sessionId: 'same-session' }),
        ]);
    });

    it('does not call the daemon for short queries', async () => {
        vi.useFakeTimers();
        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'v',
        });

        await flushHookEffects({ advanceTimersMs: 500, cycles: 2 });

        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(hook.getCurrent().memoryMatchedSessionKeys.size).toBe(0);
        expect(hook.getCurrent().isSearchingMemory).toBe(false);
    });

    it('does not call the daemon when the surface is not data-active', async () => {
        vi.useFakeTimers();
        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
            enabled: false,
        });

        await flushHookEffects({ advanceTimersMs: 500, cycles: 2 });

        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(hook.getCurrent().memoryMatchedSessionKeys.size).toBe(0);
        expect(hook.getCurrent().isSearchingMemory).toBe(false);
    });

    it('queries the canonical daemon search seam without a status preflight', async () => {
        vi.useFakeTimers();
        const search = createDeferred<unknown>();
        machineRpcWithServerScopeMock.mockImplementation((params: { method?: string }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH) return search.promise;
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });

        await flushHookEffects({ advanceTimersMs: 300, cycles: 2 });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
            machineId: 'machine-a',
            serverId: 'server-a',
        }));
        expect(hook.getCurrent().isSearchingMemory).toBe(true);
    });

    it('passes contextual Session eligibility through the shared daemon adapter', async () => {
        vi.useFakeTimers();
        storageState.sessions = { 'archived-session': { id: 'archived-session', serverId: 'server-a' } };
        machineRpcWithServerScopeMock.mockResolvedValue({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('archived-session')],
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
            eligibleSessionIds: ['archived-session'],
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
            payload: expect.objectContaining({ eligibleSessionIds: ['archived-session'] }),
        }));
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:archived-session']);
    });

    it('publishes every valid daemon hit, including sessions outside the rendered list', async () => {
        vi.useFakeTimers();
        // Only the first hit is already in this device's projection for that server.
        storageState.sessions = { 'session-1': { id: 'session-1', serverId: 'server-a' } };
        machineRpcWithServerScopeMock.mockImplementation(async (params: { method?: string }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return createMemoryStatusResponse(true);
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                return {
                    v: 1,
                    ok: true,
                    hits: [
                        createMemorySearchHit('session-1'),
                        createMemorySearchHit('session-2', 'Out of scope summary'),
                    ],
                };
            }
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });

        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
            payload: expect.objectContaining({ query: 'vector', maxResults: 50 }),
        }));
        // Local presence is not Account authorization: every derived-index hit is
        // read through the exact captured Account authority, not the ambient Sync
        // singleton's visibility helper.
        expect(ensureSessionVisibleMock).not.toHaveBeenCalled();
        expect(captureSessionRequestAuthorityMock).toHaveBeenCalledWith({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: expect.any(Function),
        });
        expect(scopedSessionRequestMock).toHaveBeenCalledWith('/v2/sessions/session-1', expect.any(Object));
        expect(scopedSessionRequestMock).toHaveBeenCalledWith('/v2/sessions/session-2', expect.any(Object));
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual([
            'server-a:session-1',
            'server-a:session-2',
        ]);
        expect(hook.getCurrent().memoryMatchedSessionTargets.map((target) => target.sessionId)).toEqual([
            'session-1',
            'session-2',
        ]);
        expect(hook.getCurrent().memoryMatchedSessionTargets).toEqual([
            expect.objectContaining({
                sessionId: 'session-1',
                reasons: ['transcript'],
                sourceMachineId: 'machine-a',
            }),
            expect.objectContaining({
                sessionId: 'session-2',
                reasons: ['transcript'],
                sourceMachineId: 'machine-a',
            }),
        ]);
        expect(hook.getCurrent().isSearchingMemory).toBe(false);
    });

    it('never renders a hit whose session the explicit-server reader cannot authorize', async () => {
        vi.useFakeTimers();
        // A same-id session held for another server must not authorize this hit.
        storageState.sessions = { 'session-1': { id: 'session-1', serverId: 'server-b' } };
        unavailableSessionIds.add('session-1');
        machineRpcWithServerScopeMock.mockImplementation(async (params: { method?: string }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return createMemoryStatusResponse(true);
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                return { v: 1, ok: true, hits: [createMemorySearchHit('session-1', 'Stale index row')] };
            }
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });

        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(scopedSessionRequestMock).toHaveBeenCalledWith('/v2/sessions/session-1', expect.any(Object));
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual([]);
        expect(hook.getCurrent().memoryMatchedSessionTargets).toEqual([]);
    });

    it('keeps current-query matches stable while unrelated inputs churn', async () => {
        vi.useFakeTimers();
        storageState.sessions = {
            'session-1': { id: 'session-1', serverId: 'server-a' },
            'session-2': { id: 'session-2', serverId: 'server-a' },
        };
        let searchCallCount = 0;
        machineRpcWithServerScopeMock.mockImplementation(async (params: { method?: string }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return createMemoryStatusResponse(true);
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                searchCallCount += 1;
                return {
                    v: 1,
                    ok: true,
                    hits: searchCallCount === 1
                        ? [createMemorySearchHit('session-1', 'Initial summary')]
                        : [
                            createMemorySearchHit('session-1', 'Initial summary'),
                            createMemorySearchHit('session-2', 'Expanded summary', 0.8),
                        ],
                };
            }
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-1']);
        expect(searchCallCount).toBe(1);

        await hook.rerender({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 500, cycles: 4 });

        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-1']);
        expect(searchCallCount).toBe(1);

        // Rerenders that do not change the query, target, or provider decision never
        // re-issue the transcript request, so published rows stay referentially stable.
        await hook.rerender({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 500, cycles: 4 });

        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-1']);
        expect(searchCallCount).toBe(1);
    });

    it('ignores stale daemon memory search responses', async () => {
        vi.useFakeTimers();
        storageState.sessions = {
            'session-1': { id: 'session-1', serverId: 'server-a' },
            'session-2': { id: 'session-2', serverId: 'server-a' },
        };
        const firstSearch = createDeferred<unknown>();
        machineRpcWithServerScopeMock.mockImplementation((params: { method?: string; payload?: { query?: string } }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return Promise.resolve(createMemoryStatusResponse(true));
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH && params.payload?.query === 'vector') {
                return firstSearch.promise;
            }
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH && params.payload?.query === 'parser') {
                return Promise.resolve({
                    v: 1,
                    ok: true,
                    hits: [createMemorySearchHit('session-2', 'Fresh summary')],
                });
            }
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 3 });

        await hook.rerender({
            searchQuery: 'parser',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });
        firstSearch.resolve({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('session-1', 'Stale summary')],
        });
        await flushHookEffects({ cycles: 3 });

        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-2']);
        expect(hook.getCurrent().lastSuccessfulQuery).toBe('parser');
    });

    it('clears same-query rows immediately on Account replacement and never publishes retired work', async () => {
        vi.useFakeTimers();
        storageState.sessions = { 'same-session': { id: 'same-session', serverId: 'server-a' } };
        const accountASearch = createDeferred<unknown>();
        machineRpcWithServerScopeMock.mockImplementation((params: { method?: string }) => {
            if (params.method !== RPC_METHODS.DAEMON_MEMORY_SEARCH) throw new Error('unexpected rpc');
            return accountASearch.promise;
        });

        const hook = await renderMemoryAugmentationHook({ searchQuery: 'vector' });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 3 });

        credentialAccounts.set('server-a', 'account-b');
        await act(async () => {
            for (const listener of credentialMutationListeners) {
                listener({ kind: 'credentials_set', serverId: 'server-a', serverUrl: 'https://server-a.example.test' });
            }
        });
        const switched = hook.getCurrent();

        expect([...switched.memoryMatchedSessionKeys]).toEqual([]);
        expect(switched.lastSuccessfulQuery).toBeUndefined();

        accountASearch.resolve({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('same-session', 'Account A transcript')],
        });
        await flushHookEffects({ cycles: 3 });

        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual([]);
        expect(hook.getCurrent().lastSuccessfulQuery).toBeUndefined();
    });

    it('cancels the superseded query through the machine RPC cancellation path', async () => {
        vi.useFakeTimers();
        storageState.sessions = { 'session-2': { id: 'session-2', serverId: 'server-a' } };
        const abortedQueries: string[] = [];
        const firstSearch = createDeferred<unknown>();
        machineRpcWithServerScopeMock.mockImplementation((params: {
            method?: string;
            payload?: { query?: string };
            signal?: AbortSignal;
        }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return Promise.resolve(createMemoryStatusResponse(true));
            if (params.method !== RPC_METHODS.DAEMON_MEMORY_SEARCH) throw new Error('unexpected rpc');
            const query = String(params.payload?.query ?? '');
            params.signal?.addEventListener('abort', () => abortedQueries.push(query));
            if (query === 'vector') return firstSearch.promise;
            return Promise.resolve({
                v: 1,
                ok: true,
                hits: [createMemorySearchHit('session-2', 'Fresh summary')],
            });
        });

        const hook = await renderMemoryAugmentationHook({ searchQuery: 'vector' });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 3 });

        await hook.rerender({ searchQuery: 'parser' });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        // The superseded request is cancelled at the transport, and its later
        // rejection is supersession rather than a published failure.
        expect(abortedQueries).toEqual(['vector']);
        firstSearch.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        await flushHookEffects({ cycles: 3 });

        expect(hook.getCurrent().memorySearchUnavailableReason).toBeUndefined();
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-2']);
    });

    it('never queries a daemon without an explicitly selected usable machine', async () => {
        vi.useFakeTimers();
        withoutSelectedMemoryMachine();

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(hook.getCurrent().memorySearchUnavailableReason).toBe('daemon_no_target');
        expect(hook.getCurrent().isSearchingMemory).toBe(false);
    });

    it('reports an unreachable daemon separately from disabled memory search', async () => {
        vi.useFakeTimers();
        featureEnabledState.search = false;
        featureRuntimeState.homeSearch = undefined;
        machineRpcWithServerScopeMock.mockImplementation(async (params: { method?: string }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return createMemoryStatusResponse(true);
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                const error = new Error('machine is offline') as Error & { rpcErrorCode: string };
                error.rpcErrorCode = SESSION_MACHINE_TARGET_UNAVAILABLE_ERROR_CODE;
                throw error;
            }
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({ searchQuery: 'offline' });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 5 });

        expect(hook.getCurrent().memorySearchUnavailableReason).toBe('daemon_unavailable');
        expect(hook.getCurrent().memorySearchUnavailableReason).not.toBe('rpc_error');
        expect(hook.getCurrent().isSearchingMemory).toBe(false);
    });

    it('augments from Home with zero machines and never calls daemon RPC', async () => {
        vi.useFakeTimers();
        withoutSelectedMemoryMachine();
        withReadyHomeSearch();
        storageState.sessions = { 'session-1': { id: 'session-1', serverId: 'server-a' } };
        machineRpcWithServerScopeMock.mockImplementation(async () => {
            throw new Error('daemon RPC must not be called for the Home provider');
        });
        homeSearchMock.mockResolvedValueOnce({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('session-1')],
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(homeSearchMock).toHaveBeenCalledWith(expect.objectContaining({
            query: 'vector',
            serverId: 'server-a',
        }));
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-1']);
        expect(hook.getCurrent().memoryMatchedSessionTargets).toEqual([
            expect.objectContaining({
                serverId: 'server-a',
                sessionId: 'session-1',
                reasons: ['transcript'],
                sourceMachineId: null,
            }),
        ]);
        expect(hook.getCurrent().isSearchingMemory).toBe(false);
    });

    it('materializes an absent Home hit through the explicit-server reader too', async () => {
        vi.useFakeTimers();
        withoutSelectedMemoryMachine();
        withReadyHomeSearch();
        unavailableSessionIds.add('session-9');
        homeSearchMock.mockResolvedValueOnce({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('session-9')],
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(scopedSessionRequestMock).toHaveBeenCalledWith('/v2/sessions/session-9', expect.any(Object));
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual([]);
    });

    it('keeps an indexing Home off the daemon path and reports its own state', async () => {
        vi.useFakeTimers();
        withoutSelectedMemoryMachine();
        featureEnabledState.search = true;

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        // The Home feature is enabled, but readiness is still unknown and no daemon
        // can answer. Preserve that truthful transitional Home state.
        expect(homeSearchMock).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(hook.getCurrent().memorySearchUnavailableReason).toBe('home_unknown');

        featureRuntimeState.homeSearch = { enabled: false, reason: 'indexing' };
        await hook.rerender({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(homeSearchMock).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(hook.getCurrent().memorySearchUnavailableReason).toBe('home_indexing');
    });

    it('falls back to the explicitly selected machine when Home is not ready', async () => {
        vi.useFakeTimers();
        featureEnabledState.search = true;
        featureRuntimeState.homeSearch = { enabled: false, reason: 'indexing' };
        storageState.sessions = { 'session-1': { id: 'session-1', serverId: 'server-a' } };
        machineRpcWithServerScopeMock.mockImplementation(async (params: { method?: string }) => {
            if (params.method === RPC_METHODS.DAEMON_MEMORY_STATUS) return createMemoryStatusResponse(true);
            if (params.method === RPC_METHODS.DAEMON_MEMORY_SEARCH) {
                return { v: 1, ok: true, hits: [createMemorySearchHit('session-1')] };
            }
            throw new Error('unexpected rpc');
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(homeSearchMock).not.toHaveBeenCalled();
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-a:session-1']);
    });

    it('ignores stale Home results after a server switch', async () => {
        vi.useFakeTimers();
        withoutSelectedMemoryMachine();
        withReadyHomeSearch();
        storageState.sessions = {
            'session-1': { id: 'session-1', serverId: 'server-a' },
            'session-2': { id: 'session-2', serverId: 'server-b' },
        };
        const staleSearch = createDeferred<unknown>();
        let homeSearchCallCount = 0;
        homeSearchMock.mockImplementation(() => {
            homeSearchCallCount += 1;
            if (homeSearchCallCount === 1) return staleSearch.promise;
            return Promise.resolve({
                v: 1,
                ok: true,
                hits: [createMemorySearchHit('session-2', 'Fresh summary')],
            });
        });

        const hook = await renderMemoryAugmentationHook({
            searchQuery: 'vector',
        });
        await flushHookEffects({ advanceTimersMs: 300, cycles: 3 });

        activeServerState.serverId = 'server-b';
        const switched = await hook.rerender({
            searchQuery: 'vector',
        });
        expect([...switched.memoryMatchedSessionKeys]).toEqual([]);
        expect(switched.lastSuccessfulQuery).toBeUndefined();
        await flushHookEffects({ advanceTimersMs: 300, cycles: 4 });

        expect(homeSearchCallCount).toBe(2);
        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-b:session-2']);

        staleSearch.resolve({
            v: 1,
            ok: true,
            hits: [createMemorySearchHit('session-1', 'Stale summary')],
        });
        await flushHookEffects({ cycles: 3 });

        expect([...hook.getCurrent().memoryMatchedSessionKeys]).toEqual(['server-b:session-2']);
        expect(hook.getCurrent().lastSuccessfulQuery).toBe('vector');
    });
});
