/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionListQueryV1 } from '@happier-dev/protocol';

import type { SessionListQueryHomeState } from './sessionListQueryController';

const controllerHarness = vi.hoisted(() => ({ createdServerIds: [] as string[] }));

const runtimeHarness = vi.hoisted(() => ({
    fetchPage: vi.fn(),
    loadNextOrdinary: vi.fn(async (_serverId: string) => undefined),
    refreshOrdinary: vi.fn(async (_serverId: string) => undefined),
    retryHome: vi.fn(async (_serverId: string) => undefined),
    /** Homes whose ordinary corpus an incumbent runtime owns, and which one. */
    ordinaryOwnerByServerId: new Map<string, 'sync' | 'concurrent'>(),
    // The incumbent owner's frontier facts for that Home.
    ordinaryState: {
        addresses: [] as ReadonlyArray<Readonly<{ serverId: string; sessionId: string }>>,
        nextCursor: null as string | null,
        hasNext: false,
        phase: 'ready' as SessionListQueryHomeState['phase'],
    },
}));

// Bindings are identity-stable per Home: the hook keys committed controllers on
// the exact binding object, so a fresh one per render would look like a retired
// Account lifetime.
const scopeHarness = vi.hoisted(() => ({ bindings: new Map<string, unknown>() }));

vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopes: (serverIds: readonly string[]) => {
        for (const serverId of serverIds) {
            if (scopeHarness.bindings.has(serverId)) continue;
            scopeHarness.bindings.set(serverId, {
                serverId,
                accountId: serverId,
                scope: { serverId, accountId: serverId },
                isCurrent: () => true,
                onRetire: () => ({ dispose: () => undefined }),
            });
        }
        return new Map(serverIds.map((serverId) => [serverId, scopeHarness.bindings.get(serverId)]));
    },
}));

vi.mock('./sessionListQueryController', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./sessionListQueryController')>();
    return {
        ...actual,
        createSessionListQueryHomeController: ({ serverId }: { serverId: string }) => {
            controllerHarness.createdServerIds.push(serverId);
            let state: SessionListQueryHomeState = {
                requestedQueryKey: `query:${serverId}`,
                appliedQueryKey: `query:${serverId}`,
                addresses: [{ serverId, sessionId: 'controller-page-2' }],
                nextCursor: 'controller-cursor',
                hasNext: true,
                attentionNextCursor: null,
                attentionHasNext: false,
                // The second owner's page was aborted by the shared abort key.
                phase: 'offline',
                freshnessAt: 1,
                failureReason: null,
                failureCode: null,
                appliedSourceKind: 'ordinary',
            };
            return {
                getSnapshot: () => state,
                subscribe: () => () => undefined,
                update: vi.fn(async () => {
                    state = { ...state };
                }),
                refresh: vi.fn(async () => undefined),
                invalidate: vi.fn(async () => undefined),
                loadNext: vi.fn(async () => undefined),
                dispose: vi.fn(),
            };
        },
    };
});

const EMPTY_QUERY_MEMBERSHIP = vi.hoisted(() => ({}));

vi.mock('@/sync/domains/state/storage', () => ({
    useMachineListByServerId: () => ({}),
    useMachineListStatusByServerId: () => ({}),
    useOrdinarySessionListMembershipByServerId: () => ({}),
    useSessionListQueryMembershipByKey: () => EMPTY_QUERY_MEMBERSHIP,
    useSessionListRowsByServerId: () => ({}),
    useSettings: () => ({
        sessionListActiveGroupingV1: 'project',
        sessionListInactiveGroupingV1: 'project',
        sessionListSectionModeV1: 'single',
    }),
    useSocketStatus: () => 'connected',
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getServerProfileById: () => null,
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    // `sessions.filteredListing` is unavailable on this Home, so its corpus runs
    // through the released ordinary GET adapter.
    resolveRuntimeFeatureDecisionFromSnapshot: () => ({ state: 'disabled' }),
    useServerFeaturesMainSelectionSnapshot: (serverIds: readonly string[]) => ({
        status: 'ready',
        serverIds,
        snapshotsByServerId: Object.fromEntries(serverIds.map((serverId) => [serverId, { status: 'ready' }])),
    }),
}));

vi.mock('@/hooks/server/useFeatureLocalPolicySettings', () => ({
    useFeatureLocalPolicySettings: () => ({}),
}));

vi.mock('./sessionListQueryRuntime', () => ({
    fetchSessionListQueryPageForHome: runtimeHarness.fetchPage,
    getSessionListQueryHomeAvailability: () => 'online',
    isSessionListQueryHomeOnline: () => true,
    resolveOrdinarySessionListHomeOwner: (serverId: string) => (
        runtimeHarness.ordinaryOwnerByServerId.get(serverId) ?? null
    ),
    loadNextOrdinarySessionListPage: runtimeHarness.loadNextOrdinary,
    readOrdinarySessionListHomeState: (input: Readonly<{ serverId: string; requestedQueryKey: string }>) => ({
        requestedQueryKey: input.requestedQueryKey,
        appliedQueryKey: input.requestedQueryKey,
        addresses: runtimeHarness.ordinaryState.addresses,
        nextCursor: runtimeHarness.ordinaryState.nextCursor,
        hasNext: runtimeHarness.ordinaryState.hasNext,
        attentionNextCursor: null,
        attentionHasNext: false,
        phase: runtimeHarness.ordinaryState.phase,
        freshnessAt: 10,
        failureReason: null,
        failureCode: null,
        appliedSourceKind: 'ordinary',
    } satisfies SessionListQueryHomeState),
    refreshOrdinarySessionList: runtimeHarness.refreshOrdinary,
    retrySessionListQueryHome: runtimeHarness.retryHome,
}));

vi.mock('./sessionListQueryInvalidation', () => ({
    subscribeSessionListQueryHomeInvalidation: () => () => undefined,
}));

import {
    type SessionListQueryHomeInput,
    type SessionListQuerySourceState,
    useSessionListQuerySourceState,
} from './useSessionListQuerySourceState';

const QUERY: SessionListQueryV1 = {
    v: 1,
    storage: 'active',
    includeInactive: false,
    scope: 'my_work',
    attention: 'any',
    audiences: [],
    tagIds: [],
    includeAttention: true,
};

const ORDINARY_ADAPTER = { path: '/v2/sessions', allowV1Fallback: true, membership: 'ordinary' } as const;

async function renderSource(homes: SessionListQueryHomeInput[]) {
    const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let sourceState: SessionListQuerySourceState | null = null;

    function Harness() {
        sourceState = useSessionListQuerySourceState({ enabled: true, homes });
        return null;
    }

    await act(async () => {
        root.render(<Harness />);
    });

    return {
        read: () => sourceState,
        dispose: async () => {
            await act(async () => {
                root.unmount();
            });
            container.remove();
            actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
        },
        act,
    };
}

describe('ordinary Session-list frontier on the Home Sync owns', () => {
    afterEach(() => {
        scopeHarness.bindings.clear();
        controllerHarness.createdServerIds.length = 0;
        runtimeHarness.fetchPage.mockReset();
        runtimeHarness.loadNextOrdinary.mockReset();
        runtimeHarness.refreshOrdinary.mockReset();
        runtimeHarness.retryHome.mockReset();
        runtimeHarness.ordinaryOwnerByServerId.clear();
        runtimeHarness.ordinaryState = {
            addresses: [],
            nextCursor: null,
            hasNext: false,
            phase: 'ready',
        };
    });

    it('reads Sync\'s frontier instead of opening a second paginator over the same corpus', async () => {
        runtimeHarness.ordinaryOwnerByServerId.set('home-a', 'sync');
        runtimeHarness.ordinaryState = {
            addresses: [
                { serverId: 'home-a', sessionId: 'page-1' },
                { serverId: 'home-a', sessionId: 'page-2' },
            ],
            nextCursor: 'sync-cursor-3',
            hasNext: true,
            phase: 'ready',
        };
        const harness = await renderSource([
            { serverId: 'home-a', query: QUERY, ordinaryAdapter: ORDINARY_ADAPTER },
        ]);

        try {
            // No second owner: no controller instance, no second request adapter,
            // and therefore no shared abort key to read as offline.
            expect(controllerHarness.createdServerIds).toEqual([]);
            expect(runtimeHarness.fetchPage).not.toHaveBeenCalled();

            const state = harness.read()?.statesByServerId['home-a'];
            expect(state?.phase).toBe('ready');
            expect(state?.addresses.map((address) => address.sessionId)).toEqual(['page-1', 'page-2']);
            expect(state?.nextCursor).toBe('sync-cursor-3');

            await act(async () => {
                await harness.read()?.loadNext();
            });
            expect(runtimeHarness.loadNextOrdinary).toHaveBeenCalledExactlyOnceWith('home-a');

            await act(async () => {
                await harness.read()?.refresh();
            });
            expect(runtimeHarness.refreshOrdinary).toHaveBeenCalledExactlyOnceWith('home-a');
            expect(runtimeHarness.retryHome).not.toHaveBeenCalled();
        } finally {
            await harness.dispose();
        }
    });

    it('reads a managed secondary Home\'s incumbent frontier instead of truncating it to page one', async () => {
        // A legacy secondary Home the concurrent cache manages: two ordinary pages
        // are already loaded and its own cursor is open.
        runtimeHarness.ordinaryOwnerByServerId.set('home-b', 'concurrent');
        runtimeHarness.ordinaryState = {
            addresses: [
                { serverId: 'home-b', sessionId: 'page-1' },
                { serverId: 'home-b', sessionId: 'page-2' },
            ],
            nextCursor: 'concurrent-cursor-3',
            hasNext: true,
            phase: 'ready',
        };
        const harness = await renderSource([
            { serverId: 'home-b', query: QUERY, ordinaryAdapter: ORDINARY_ADAPTER },
        ]);

        try {
            // Mounting a Source filter must not create a second paginator that
            // replaces the loaded corpus with page one.
            expect(controllerHarness.createdServerIds).toEqual([]);
            expect(runtimeHarness.fetchPage).not.toHaveBeenCalled();

            const state = harness.read()?.statesByServerId['home-b'];
            expect(state?.addresses.map((address) => address.sessionId)).toEqual(['page-1', 'page-2']);
            expect(state?.nextCursor).toBe('concurrent-cursor-3');

            await act(async () => {
                await harness.read()?.loadNext();
            });
            expect(runtimeHarness.loadNextOrdinary).toHaveBeenCalledExactlyOnceWith('home-b');
        } finally {
            await harness.dispose();
        }
    });

    it('keeps its own controller for a Home no incumbent ordinary owner manages', async () => {
        const harness = await renderSource([
            { serverId: 'home-c', query: QUERY, ordinaryAdapter: ORDINARY_ADAPTER },
        ]);

        try {
            expect(controllerHarness.createdServerIds).toEqual(['home-c']);
            expect(runtimeHarness.loadNextOrdinary).not.toHaveBeenCalled();
        } finally {
            await harness.dispose();
        }
    });
});
