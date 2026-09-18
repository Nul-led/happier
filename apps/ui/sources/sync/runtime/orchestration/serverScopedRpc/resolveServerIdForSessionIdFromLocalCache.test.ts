import { describe, expect, it } from 'vitest';

import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { resolveServerIdForSessionIdFromLocalState } from '@/sync/domains/session/resolveSessionAddressFromLocalState';

function createRenderableSession(id: string) {
    return createSessionListRenderableSessionFixture({ id });
}

describe('resolveServerIdForSessionIdFromLocalState', () => {
    const makeIndexSessionItem = (sessionId: string, serverId: string): SessionListIndexItem => ({
        type: 'session',
        sessionId,
        serverId,
        serverName: serverId,
    });

    it('uses the active entity captured Home as an authoritative bare-id candidate', () => {
        const state = {
            sessions: {
                s1: { serverId: 'server-a' },
            },
            sessionListRowsByServerId: {
                'server-b': { s1: createRenderableSession('s1') },
            },
            sessionListIndexByServerId: {
                'server-c': [makeIndexSessionItem('s1', 'server-c')],
            },
            ordinarySessionListMembershipByServerId: {},
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 's1')).toBe('server-a');
    });

    it('uses ordinary list membership as an authoritative bare-id candidate', () => {
        const state = {
            sessions: {},
            sessionListRowsByServerId: {},
            sessionListIndexByServerId: {},
            ordinarySessionListMembershipByServerId: { 'server-c': ['s3'] },
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 's3')).toBe('server-c');
    });

    it('ignores stale row and index caches when no active entity or ordinary membership remains', () => {
        const state = {
            sessions: {},
            sessionListIndexByServerId: {
                'https://home.example/a:b': [makeIndexSessionItem('c', 'https://home.example/a:b')],
            },
            sessionListRowsByServerId: {
                'https://home.example/a': { 'b:c': createRenderableSession('b:c') },
            },
            ordinarySessionListMembershipByServerId: {},
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 'b:c')).toBeNull();
        expect(resolveServerIdForSessionIdFromLocalState(state, 'c')).toBeNull();
    });

    it('does not pick the first Home when an unqualified id occurs in two authoritative memberships', () => {
        const state = {
            sessions: {},
            ordinarySessionListMembershipByServerId: {
                'https://a.example:8443': ['same'],
                'home-b': ['same'],
            },
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 'same')).toBeNull();
    });

    it('does not use the current active Home for an active entity with no captured Home', () => {
        const state = {
            sessions: {
                s1: {},
            },
            ordinarySessionListMembershipByServerId: {},
        } satisfies Parameters<typeof resolveServerIdForSessionIdFromLocalState>[0];

        expect(resolveServerIdForSessionIdFromLocalState(state, 's1')).toBeNull();
    });
});
