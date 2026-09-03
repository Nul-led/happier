import { describe, expect, it } from 'vitest';

import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';

import {
    SESSION_LIST_SEARCH_IN_THIS_VIEW_GROUP_KEY,
    SESSION_LIST_SEARCH_OTHER_MATCHES_GROUP_KEY,
    appendSessionListSearchOtherMatches,
    resolveSessionListSearchOutsideMatches,
} from './sessionListSearchGroups';

const activeHeader: SessionListIndexItem = {
    type: 'header',
    title: 'Active',
    headerKind: 'active',
    groupKey: 'active',
    serverId: 'server-a',
};

function sessionItem(sessionId: string): SessionListIndexItem {
    return {
        type: 'session',
        sessionId,
        serverId: 'server-a',
        groupKey: 'active',
        groupKind: 'active',
    };
}

describe('resolveSessionListSearchOutsideMatches', () => {
    it('keeps a valid hit whose session this list does not carry', () => {
        const outside = resolveSessionListSearchOutsideMatches({
            candidateSessionKeys: new Set(['server-a:in-view']),
            currentViewSessionKeys: new Set(['server-a:in-view']),
            matchedSessionTargets: [
                {
                    sessionKey: 'server-a:in-view',
                    serverId: 'server-a',
                    sessionId: 'in-view',
                    reasons: ['transcript'],
                },
                {
                    sessionKey: 'server-a:archived',
                    serverId: 'server-a',
                    sessionId: 'archived',
                    reasons: ['transcript'],
                },
            ],
        });

        expect(outside).toEqual([
            {
                sessionKey: 'server-a:archived',
                serverId: 'server-a',
                sessionId: 'archived',
                reasons: ['transcript'],
            },
        ]);
    });

    it('retains a transcript hit hidden only by the current filters and records that reason', () => {
        expect(resolveSessionListSearchOutsideMatches({
            candidateSessionKeys: new Set(['server-a:hidden']),
            currentViewSessionKeys: new Set(),
            matchedSessionTargets: [{
                sessionKey: 'server-a:hidden',
                serverId: 'server-a',
                sessionId: 'hidden',
                reasons: ['transcript'],
            }],
        })).toEqual([{
            sessionKey: 'server-a:hidden',
            serverId: 'server-a',
            sessionId: 'hidden',
            reasons: ['transcript', 'hidden-by-filters'],
        }]);
    });

    it('returns nothing when every hit is already rendered', () => {
        expect(resolveSessionListSearchOutsideMatches({
            candidateSessionKeys: new Set(['server-a:in-view']),
            currentViewSessionKeys: new Set(['server-a:in-view']),
            matchedSessionTargets: [
                {
                    sessionKey: 'server-a:in-view',
                    serverId: 'server-a',
                    sessionId: 'in-view',
                    reasons: ['transcript'],
                },
            ],
        })).toEqual([]);
    });
});

describe('appendSessionListSearchOtherMatches', () => {
    it('labels both regions and materializes outside identities as session rows', () => {
        const grouped = appendSessionListSearchOtherMatches({
            filteredItems: [activeHeader, sessionItem('in-view')],
            outsideMatches: [
                {
                    sessionKey: 'server-a:archived',
                    serverId: 'server-a',
                    sessionId: 'archived',
                    reasons: ['transcript', 'archived'],
                },
            ],
            inThisViewTitle: 'In this view',
            otherMatchesTitle: 'Other matches',
        });

        expect(grouped.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'In this view',
            'Active',
            'in-view',
            'Other matches',
            'archived',
        ]);
        const materialized = grouped[grouped.length - 1];
        expect(materialized.type === 'session' && materialized.serverId).toBe('server-a');
        expect(materialized.type === 'session' && materialized.groupKey)
            .toBe(SESSION_LIST_SEARCH_OTHER_MATCHES_GROUP_KEY);
        expect(materialized.type === 'session' && materialized.contextualSearchReasons)
            .toEqual(['transcript', 'archived']);
    });

    it('omits the in-view label when the current view has no matching rows', () => {
        const grouped = appendSessionListSearchOtherMatches({
            filteredItems: [],
            outsideMatches: [
                {
                    sessionKey: 'server-a:archived',
                    serverId: 'server-a',
                    sessionId: 'archived',
                    reasons: ['transcript'],
                },
            ],
            inThisViewTitle: 'In this view',
            otherMatchesTitle: 'Other matches',
        });

        expect(grouped.map((item) => item.type === 'session' ? item.sessionId : item.title)).toEqual([
            'Other matches',
            'archived',
        ]);
        expect(grouped.some((item) => item.type === 'header'
            && item.groupKey === SESSION_LIST_SEARCH_IN_THIS_VIEW_GROUP_KEY)).toBe(false);
    });

    it('returns the filtered items unchanged when there is nothing outside the view', () => {
        const filtered = [activeHeader, sessionItem('in-view')];
        expect(appendSessionListSearchOtherMatches({
            filteredItems: filtered,
            outsideMatches: [],
            inThisViewTitle: 'In this view',
            otherMatchesTitle: 'Other matches',
        })).toBe(filtered);
    });
});
