import { describe, expect, it } from 'vitest';

import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';

import { filterCollapsedSessionListItems } from './filterCollapsedSessionListItems';

function makeSession(id: string, groupKey: string): SessionListIndexItem {
    return {
        type: 'session',
        serverId: 'server-a',
        serverName: 'Server A',
        groupKey,
        groupKind: 'date',
        sessionId: id,
    };
}

describe('filterCollapsedSessionListItems', () => {
    it('returns the original array when there are no collapsed groups to apply', () => {
        const items: SessionListIndexItem[] = [
            { type: 'header', title: 'Inactive', headerKind: 'inactive', groupKey: 'inactive:server-a', serverId: 'server-a', serverName: 'Server A' },
            makeSession('visible-session', 'server:server-a:day:2026-02-18'),
        ];

        const result = filterCollapsedSessionListItems(items, {});

        expect(result).toBe(items);
    });

    it('returns the original array when collapsed groups do not match any rendered rows', () => {
        const items: SessionListIndexItem[] = [
            { type: 'header', title: 'Inactive', headerKind: 'inactive', groupKey: 'inactive:server-a', serverId: 'server-a', serverName: 'Server A' },
            makeSession('visible-session', 'server:server-a:day:2026-02-18'),
        ];

        const result = filterCollapsedSessionListItems(items, { 'server:server-a:day:2026-02-19': true });

        expect(result).toBe(items);
    });

    it('hides collapsed groups and skips subordinate headers until the next section header', () => {
        const activeSectionKey = 'active:server-a';
        const activeGroupKey = 'server:server-a:day:2026-02-17';
        const inactiveSectionKey = 'inactive:server-a';
        const inactiveGroupKey = 'server:server-a:day:2026-02-18';

        const items: SessionListIndexItem[] = [
            { type: 'header', title: 'Active', headerKind: 'active', groupKey: activeSectionKey, serverId: 'server-a', serverName: 'Server A' },
            { type: 'header', title: 'Today', headerKind: 'date', groupKey: activeGroupKey, serverId: 'server-a', serverName: 'Server A' },
            makeSession('hidden-session', activeGroupKey),
            { type: 'header', title: 'Inactive', headerKind: 'inactive', groupKey: inactiveSectionKey, serverId: 'server-a', serverName: 'Server A' },
            { type: 'header', title: 'Tomorrow', headerKind: 'date', groupKey: inactiveGroupKey, serverId: 'server-a', serverName: 'Server A' },
            makeSession('visible-session', inactiveGroupKey),
        ];

        const result = filterCollapsedSessionListItems(items, { [activeSectionKey]: true });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.type === 'header' ? item.title : `run:${item.runId}`)).toEqual([
            'Active',
            'Inactive',
            'Tomorrow',
            'visible-session',
        ]);
    });

    it('keeps the one-section corpus visible when only the Pinned section is collapsed', () => {
        const pinnedGroupKey = 'pinned';
        const sessionsSectionKey = 'sessions:server-a';
        const projectGroupKey = 'server:server-a:project:repo';

        // Projects and Recent activity are one-section layouts: the corpus below
        // Pinned is headed by `sessions`, never by `active`/`inactive`.
        const items: SessionListIndexItem[] = [
            { type: 'header', title: 'Pinned', headerKind: 'pinned', groupKey: pinnedGroupKey },
            makeSession('pinned-session', pinnedGroupKey),
            { type: 'header', title: 'Sessions', headerKind: 'sessions', groupKey: sessionsSectionKey, serverId: 'server-a', serverName: 'Server A' },
            { type: 'header', title: 'Repo', headerKind: 'project', groupKey: projectGroupKey, serverId: 'server-a', serverName: 'Server A' },
            makeSession('visible-session', projectGroupKey),
        ];

        const result = filterCollapsedSessionListItems(items, { [pinnedGroupKey]: true });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.type === 'header' ? item.title : `run:${item.runId}`)).toEqual([
            'Pinned',
            'Sessions',
            'Repo',
            'visible-session',
        ]);
    });

    it('collapses a promoted attention section without hiding the corpus beneath it', () => {
        const attentionGroupKey = 'attention';
        const sessionsSectionKey = 'sessions:server-a';
        const dateGroupKey = 'server:server-a:day:2026-02-17';

        const items: SessionListIndexItem[] = [
            { type: 'header', title: 'Needs attention', headerKind: 'attention', groupKey: attentionGroupKey },
            makeSession('attention-session', dateGroupKey),
            { type: 'header', title: 'Sessions', headerKind: 'sessions', groupKey: sessionsSectionKey, serverId: 'server-a', serverName: 'Server A' },
            { type: 'header', title: 'Today', headerKind: 'date', groupKey: dateGroupKey, serverId: 'server-a', serverName: 'Server A' },
            makeSession('visible-session', dateGroupKey),
        ];

        const result = filterCollapsedSessionListItems(items, { [attentionGroupKey]: true });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.type === 'header' ? item.title : `run:${item.runId}`)).toEqual([
            'Needs attention',
            'Sessions',
            'Today',
            'visible-session',
        ]);
    });

    it('drops only the rows from individually collapsed groups when the parent section remains expanded', () => {
        const collapsedGroupKey = 'server:server-a:day:2026-02-17';
        const openGroupKey = 'server:server-a:day:2026-02-18';

        const items: SessionListIndexItem[] = [
            { type: 'header', title: 'Inactive', headerKind: 'inactive', groupKey: 'inactive:server-a', serverId: 'server-a', serverName: 'Server A' },
            { type: 'header', title: 'Today', headerKind: 'date', groupKey: collapsedGroupKey, serverId: 'server-a', serverName: 'Server A' },
            makeSession('hidden-session', collapsedGroupKey),
            { type: 'header', title: 'Tomorrow', headerKind: 'date', groupKey: openGroupKey, serverId: 'server-a', serverName: 'Server A' },
            makeSession('visible-session', openGroupKey),
        ];

        const result = filterCollapsedSessionListItems(items, { [collapsedGroupKey]: true });

        expect(result.map((item) => item.type === 'session' ? item.sessionId : item.type === 'header' ? item.title : `run:${item.runId}`)).toEqual([
            'Inactive',
            'Today',
            'Tomorrow',
            'visible-session',
        ]);
    });
});
