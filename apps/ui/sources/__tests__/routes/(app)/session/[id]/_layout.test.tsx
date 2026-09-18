import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { resetSessionListPaneRetentionForTests, retainSessionListPaneState } from '@/components/sessions/shell/sessionListPaneRetention';

const routeParams = vi.hoisted(() => ({
    value: { id: 'session-1' } as Readonly<{ id?: string; serverId?: string }>,
}));
const routeRuntime = vi.hoisted(() => ({
    childHydrationServerIds: [] as string[],
    setParams: vi.fn((params: Readonly<{ serverId?: string }>) => {
        routeParams.value = { ...routeParams.value, ...params };
    }),
}));
const sessionState = vi.hoisted(() => ({
    current: null as Readonly<{
        id: string;
        active: boolean;
        metadata: unknown;
        ownerMetadataView?: unknown;
        metadataLayoutVersion?: number;
    }> | null,
}));
const lookupState = vi.hoisted(() => ({
    sessionListIndexByServerId: {} as Record<string, readonly Readonly<{
        type: 'session';
        sessionId: string;
        serverId: string;
    }>[]>,
    ordinarySessionListMembershipByServerId: {} as Record<string, readonly string[]>,
}));

vi.mock('expo-router', () => ({
    Slot: () => {
        // A legacy child falls back to the active Home when the parent has not
        // promoted a qualified route param before mounting it.
        routeRuntime.childHydrationServerIds.push(routeParams.value.serverId ?? 'home-a');
        return React.createElement('SessionRouteSlot');
    },
    useLocalSearchParams: () => routeParams.value,
    useRouter: () => ({ setParams: routeRuntime.setParams }),
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useSession: () => sessionState.current,
    storage: (selector: (state: unknown) => unknown) => selector({
        sessions: sessionState.current ? { [sessionState.current.id]: sessionState.current } : {},
        sessionListIndexByServerId: lookupState.sessionListIndexByServerId,
        ordinarySessionListMembershipByServerId: lookupState.ordinarySessionListMembershipByServerId,
    }),
}));

vi.mock('@/components/sessions/shell/SessionInvalidLinkFallback', () => ({
    SessionInvalidLinkFallback: (props: unknown) => React.createElement('SessionInvalidLinkFallback', props),
}));

describe('ordinary session route layout', () => {
    afterEach(() => {
        standardCleanup();
        routeParams.value = { id: 'session-1' };
        sessionState.current = null;
        lookupState.sessionListIndexByServerId = {};
        lookupState.ordinarySessionListMembershipByServerId = {};
        routeRuntime.childHydrationServerIds = [];
        routeRuntime.setParams.mockClear();
        resetSessionListPaneRetentionForTests();
    });

    it('does not mount ordinary session routes for the hidden Voice transcript history carrier', async () => {
        sessionState.current = {
            id: 'session-1',
            active: false,
            metadata: {
                systemSessionV1: {
                    v: 1,
                    key: 'voice_transcript_history',
                    hidden: true,
                },
            },
        };
        const Layout = await import('@/app/(app)/session/[id]/_layout');

        const screen = await renderScreen(React.createElement(Layout.default));

        expect(screen.findAllByType('SessionInvalidLinkFallback')).toHaveLength(1);
        expect(screen.findAllByType('SessionRouteSlot')).toHaveLength(0);
    });

    it('keeps ordinary user sessions routed normally', async () => {
        sessionState.current = {
            id: 'session-1',
            active: false,
            metadata: {
                summary: {
                    text: 'Ordinary coding session',
                    updatedAt: 1,
                },
            },
        };
        const Layout = await import('@/app/(app)/session/[id]/_layout');

        const screen = await renderScreen(React.createElement(Layout.default));

        expect(screen.findAllByType('SessionInvalidLinkFallback')).toHaveLength(0);
        expect(screen.findAllByType('SessionRouteSlot')).toHaveLength(1);
        expect(routeRuntime.setParams).not.toHaveBeenCalled();
        expect(routeRuntime.childHydrationServerIds).toEqual(['home-a']);
    });

    it('opens the Which Home fallback without mounting hydration for an ambiguous legacy route', async () => {
        lookupState.sessionListIndexByServerId = {
            'home-a': [{ type: 'session', sessionId: 'session-1', serverId: 'home-a' }],
            'home-b': [{ type: 'session', sessionId: 'session-1', serverId: 'home-b' }],
        };
        lookupState.ordinarySessionListMembershipByServerId = {
            'home-a': ['session-1'],
            'home-b': ['session-1'],
        };
        const Layout = await import('@/app/(app)/session/[id]/_layout');

        const screen = await renderScreen(React.createElement(Layout.default));

        expect(screen.findAllByType('SessionRouteSlot')).toHaveLength(0);
        expect(screen.findAllByType('SessionInvalidLinkFallback')[0]?.props).toMatchObject({
            sessionId: 'session-1',
            candidateServerIds: ['home-a', 'home-b'],
        });
    });

    it('threads active retained query membership into the legacy Which Home route', async () => {
        const queryState = (serverId: string) => ({
            requestedQueryKey: `query-${serverId}`, appliedQueryKey: `query-${serverId}`,
            addresses: [{ serverId, sessionId: 'session-1' }],
            nextCursor: null, hasNext: false, attentionNextCursor: null, attentionHasNext: false,
            phase: 'ready' as const, freshnessAt: 1, failureReason: null, failureCode: null,
            appliedSourceKind: 'query' as const,
        });
        retainSessionListPaneState({
            storageKind: 'all', pathname: '/', sourceScopeKey: 'test', queryMembershipActive: true,
            paneState: {
                summary: { sessionsReady: true, sessionCount: 2 }, visibleSessionListIndex: [],
                hasHiddenInactiveSessions: false, folderFocus: null, showLoading: false, showEmptyState: false,
                query: {
                    active: true,
                    statesByServerId: { 'home-a': queryState('home-a'), 'home-b': queryState('home-b') },
                    byServerId: {}, source: [], coverageComplete: true,
                    loadNext: async () => {}, refresh: async () => {},
                },
            },
        });
        const Layout = await import('@/app/(app)/session/[id]/_layout');
        const screen = await renderScreen(React.createElement(Layout.default));
        expect(screen.findAllByType('SessionRouteSlot')).toHaveLength(0);
        expect(screen.findAllByType('SessionInvalidLinkFallback')[0]?.props).toMatchObject({
            candidateServerIds: ['home-a', 'home-b'],
        });
    });

    it('promotes one current-query-only Home before mounting child hydration', async () => {
        retainSessionListPaneState({
            storageKind: 'all', pathname: '/', sourceScopeKey: 'test', queryMembershipActive: true,
            paneState: {
                summary: { sessionsReady: true, sessionCount: 1 }, visibleSessionListIndex: [],
                hasHiddenInactiveSessions: false, folderFocus: null, showLoading: false, showEmptyState: false,
                query: {
                    active: true,
                    statesByServerId: {
                        'home-b': {
                            requestedQueryKey: 'query-home-b', appliedQueryKey: 'query-home-b',
                            addresses: [{ serverId: 'home-b', sessionId: 'session-1' }],
                            nextCursor: null, hasNext: false, attentionNextCursor: null, attentionHasNext: false,
                            phase: 'ready', freshnessAt: 1, failureReason: null, failureCode: null,
                            appliedSourceKind: 'query',
                        },
                    },
                    byServerId: {}, source: [], coverageComplete: true,
                    loadNext: async () => {}, refresh: async () => {},
                },
            },
        });
        const Layout = await import('@/app/(app)/session/[id]/_layout');

        const screen = await renderScreen(React.createElement(Layout.default));

        expect(routeRuntime.childHydrationServerIds).toEqual([]);
        expect(routeRuntime.setParams).toHaveBeenCalledWith({ serverId: 'home-b' });

        await screen.update(React.createElement(Layout.default));
        expect(routeRuntime.childHydrationServerIds).toEqual(['home-b']);
    });
});
