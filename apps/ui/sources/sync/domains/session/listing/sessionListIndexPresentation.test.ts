import { describe, expect, it } from 'vitest';

import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import type { SessionListQueryHomeState } from './sessionListQueryController';
import * as presentationModule from './sessionListIndexPresentation';
import {
    applySessionListIndexPresentation,
    resolveSessionListSourceIndex,
    resolveVisibleSessionListIndexSummary,
} from './sessionListIndexPresentation';

type QueryPresentationResolver = (input: Readonly<{
    selectedServerIds: readonly string[];
    statesByServerId: Readonly<Record<string, SessionListQueryHomeState | undefined>>;
    coverageComplete: boolean;
    retainedRowCount: number;
}>) => unknown;

function queryState(partial: Partial<SessionListQueryHomeState>): SessionListQueryHomeState {
    return {
        requestedQueryKey: 'query',
        appliedQueryKey: null,
        addresses: [],
        nextCursor: null,
        hasNext: false,
        attentionNextCursor: null,
        attentionHasNext: false,
        phase: 'idle',
        freshnessAt: null,
        failureReason: null,
        failureCode: null,
        ...partial,
    };
}

function makeHeader(title: string, partial?: Partial<Extract<SessionListIndexItem, { type: 'header' }>>): SessionListIndexItem {
    return {
        type: 'header',
        title,
        ...(partial ?? {}),
    };
}

function makeSession(sessionId: string, serverId: string, serverName: string, partial?: Partial<Extract<SessionListIndexItem, { type: 'session' }>>): SessionListIndexItem {
    return {
        type: 'session',
        sessionId,
        serverId,
        serverName,
        ...(partial ?? {}),
    };
}

describe('resolveSessionListSourceIndex', () => {
    it('keeps resolved server index visible when some selected servers are still loading', () => {
        const activeIndex: SessionListIndexItem[] = [
            makeSession('s1', 'server-a', 'Server A'),
        ];

        const result = resolveSessionListSourceIndex({
            enabled: true,
            activeServerId: 'server-a',
            activeIndex,
            byServerId: {
                'server-a': activeIndex,
                'server-b': null,
            },
            selectedServerIds: ['server-a', 'server-b'],
        });

        expect(result).toBe(activeIndex);
    });
});

describe('resolveVisibleSessionListIndexSummary', () => {
    it('counts sessions using the renderable resolver for direct-vs-persisted storage filters', () => {
        const index: SessionListIndexItem[] = [
            makeSession('direct-1', 'server-a', 'Server A', { storageKind: 'direct' }),
            makeSession('persisted-1', 'server-a', 'Server A', { storageKind: 'persisted' }),
        ];

        expect(resolveVisibleSessionListIndexSummary({
            enabled: false,
            activeServerId: 'server-a',
            activeIndex: index,
        }, 'direct')).toEqual({
            sessionsReady: true,
            sessionCount: 1,
        });
    });

    it('treats partially resolved selected-server sources as ready (stale-while-revalidate)', () => {
        const activeIndex: SessionListIndexItem[] = [
            makeSession('s1', 'server-a', 'Server A'),
        ];

        const result = resolveVisibleSessionListIndexSummary({
            enabled: true,
            activeServerId: 'server-a',
            activeIndex,
            byServerId: {
                'server-a': activeIndex,
                'server-b': null,
            },
            selectedServerIds: ['server-a', 'server-b'],
        }, 'all');

        expect(result).toEqual({
            sessionsReady: true,
            sessionCount: 1,
        });
    });
});

describe('resolveSessionListQueryPresentation', () => {
    const resolve = (input: Parameters<QueryPresentationResolver>[0]) => {
        const resolver = (presentationModule as unknown as Readonly<{
            resolveSessionListQueryPresentation?: QueryPresentationResolver;
        }>).resolveSessionListQueryPresentation;
        expect(typeof resolver).toBe('function');
        return resolver?.(input);
    };

    it('keeps initial unresolved Homes in loading instead of treating zero as authoritative', () => {
        expect(resolve({
            selectedServerIds: ['home-a'],
            statesByServerId: { 'home-a': queryState({ phase: 'loading' }) },
            coverageComplete: false,
            retainedRowCount: 0,
        })).toEqual({ kind: 'initial_loading' });
    });

    it('treats no selected Homes as complete only after the filter owner proves the empty selection', () => {
        expect(resolve({
            selectedServerIds: [],
            statesByServerId: {},
            coverageComplete: false,
            retainedRowCount: 0,
        })).toEqual({ kind: 'initial_loading' });

        expect(resolve({
            selectedServerIds: [],
            statesByServerId: {},
            coverageComplete: true,
            retainedRowCount: 0,
        })).toEqual({ kind: 'ready', complete: true });
    });

    it('projects mixed ready and unavailable Homes as partial with exact reasons', () => {
        expect(resolve({
            selectedServerIds: ['home-a', 'home-b', 'home-c'],
            statesByServerId: {
                'home-a': queryState({ phase: 'ready', appliedQueryKey: 'query' }),
                'home-b': queryState({ phase: 'offline' }),
                'home-c': queryState({ phase: 'error', failureReason: 'unsupported' }),
            },
            coverageComplete: false,
            retainedRowCount: 2,
        })).toEqual({
            kind: 'partial',
            unavailableHomes: [
                { serverId: 'home-b', reason: 'offline' },
                { serverId: 'home-c', reason: 'unsupported' },
            ],
        });
    });

    it('reports retained refresh and incomplete ready coverage without hiding rows', () => {
        expect(resolve({
            selectedServerIds: ['home-a'],
            statesByServerId: {
                'home-a': queryState({ phase: 'refreshing', appliedQueryKey: 'query', addresses: [{ serverId: 'home-a', sessionId: 's1' }] }),
            },
            coverageComplete: false,
            retainedRowCount: 1,
        })).toEqual({ kind: 'refreshing', retainedRows: true });

        expect(resolve({
            selectedServerIds: ['home-a'],
            statesByServerId: {
                'home-a': queryState({ phase: 'ready', appliedQueryKey: 'query', hasNext: true }),
            },
            coverageComplete: false,
            retainedRowCount: 1,
        })).toEqual({ kind: 'ready', complete: false });
    });

    it('distinguishes complete zero from a terminal query error', () => {
        expect(resolve({
            selectedServerIds: ['home-a'],
            statesByServerId: { 'home-a': queryState({ phase: 'ready', appliedQueryKey: 'query' }) },
            coverageComplete: true,
            retainedRowCount: 0,
        })).toEqual({ kind: 'ready', complete: true });

        expect(resolve({
            selectedServerIds: ['home-a'],
            statesByServerId: { 'home-a': queryState({ phase: 'error', failureReason: 'network' }) },
            coverageComplete: false,
            retainedRowCount: 0,
        })).toEqual({ kind: 'error', retainedRows: false });
    });
});

describe('applySessionListIndexPresentation', () => {
    it('groups by server when concurrent grouped presentation is enabled', () => {
        const data: SessionListIndexItem[] = [
            makeHeader('Today', { headerKind: 'date' }),
            makeSession('s1', 'server-a', 'Server A'),
            makeSession('s2', 'server-b', 'Server B'),
            makeSession('s3', 'server-a', 'Server A'),
        ];

        const result = applySessionListIndexPresentation(data, {
            enabled: true,
            presentation: 'grouped',
        });

        expect(result.map((item) => {
            if (item.type === 'header') {
                return `header:${item.headerKind ?? 'date'}:${item.title}`;
            }
            return `session:${item.sessionId}:${item.serverId}`;
        })).toEqual([
            'header:server:Server A',
            'header:date:Today',
            'session:s1:server-a',
            'session:s3:server-a',
            'header:server:Server B',
            'session:s2:server-b',
        ]);
    });
});
