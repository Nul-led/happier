import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { installSessionFilesViewCommonModuleMocks } from '../sessionFilesViewsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Two Homes can each host a Session with the same id. Every Changed Files input has to be read
 * through the qualified address; an unqualified read falls back to same-id cache discovery, which
 * cannot tell the two apart and silently attributes the other Home's workspace evidence to this
 * Session.
 */
const TOUCHED_PATHS_BY_HOME: Record<string, string[]> = {
    'home-a': ['src/home-a.ts'],
    'home-b': ['src/home-b.ts'],
};

const touchedPathsCalls: Array<{ sessionId: string; serverId?: string | null }> = [];

installSessionFilesViewCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useProjectForSession: () => null,
            useProjectSessions: () => ['s1'],
            useWorkspaceScmTouchedPathsForSession: (sessionId: string, serverId?: string | null) => {
                touchedPathsCalls.push({ sessionId, serverId });
                // An unqualified read is exactly the ambiguous case: the id alone resolves to
                // whichever Home the shared cache happens to hold.
                return TOUCHED_PATHS_BY_HOME[String(serverId ?? 'home-a')] ?? [];
            },
            useSessionProjectScmOperationLog: () => [],
            useSetting: (key: string) => {
                if (key === 'scmReviewMaxFiles') return 25;
                if (key === 'scmReviewMaxChangedLines') return 2000;
                return null;
            },
            importOriginal,
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Octicons: 'Octicons',
}));

vi.mock('@/sync/domains/session/changes/hooks/useDerivedSessionChangeSet', () => ({
    useDerivedSessionChangeSet: () => ({
        turnChangeSets: [],
        latestTurnChangeSet: null,
        latestTurnScopedChangeSet: null,
        sessionChangeSet: null,
        latestTurnDiffByPath: null,
        latestTurnAgentReportedDiffByPath: null,
        latestTurnCheckpointDiffByPath: null,
        providerDiffByPath: null,
    }),
}));

vi.mock('@/components/sessions/files/content/ChangedFilesList', () => ({
    ChangedFilesList: (props: any) => React.createElement('ChangedFilesList', props),
}));

vi.mock('@/components/workspaces/scm/review/ChangedFilesReview', () => ({
    ChangedFilesReview: (props: any) => React.createElement('ChangedFilesReview', props),
}));

function entry(path: string) {
    return {
        path,
        kind: 'modified' as const,
        hasIncludedDelta: false,
        hasPendingDelta: true,
        previousPath: null,
        stats: {
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 1,
            pendingRemoved: 0,
            isBinary: false,
        },
    };
}

function snapshot(): ScmWorkingSnapshot {
    return {
        fetchedAt: 1,
        projectKey: 'm1:/tmp/repo',
        repo: { isRepo: true, rootPath: '/tmp/repo', backendId: 'git', mode: '.git' },
        capabilities: {
            readStatus: true,
            readLog: true,
            writeCommit: true,
            supportedDiffAreas: ['included', 'pending'],
        },
        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
        stashCount: 0,
        hasConflicts: false,
        entries: [entry('src/home-a.ts'), entry('src/home-b.ts')],
        totals: {
            includedFiles: 0,
            pendingFiles: 2,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 2,
            pendingRemoved: 0,
        },
    } as unknown as ScmWorkingSnapshot;
}

describe('RepositoryTreeChangedFilesPane (exact Home)', () => {
    it('reads workspace touched-path evidence from the Home named by the route, not a same-id match', async () => {
        touchedPathsCalls.length = 0;
        const { RepositoryTreeChangedFilesPane } = await import('./RepositoryTreeChangedFilesPane');

        const screen = await renderScreen(<RepositoryTreeChangedFilesPane
            sessionId="s1"
            serverId="home-b"
            scmSnapshot={snapshot()}
            searchQuery=""
            onSearchQueryChange={vi.fn()}
            onShowAllRepositoryFiles={vi.fn()}
            onOpenFile={vi.fn()}
        />);

        expect(touchedPathsCalls.at(-1)?.serverId).toBe('home-b');

        const list = screen.findAllByType('ChangedFilesList' as any)[0];
        expect(list).toBeTruthy();
        expect(list.props.sessionAttributedFiles.map((entryValue: any) => entryValue.file.fullPath))
            .toEqual(['src/home-b.ts']);
    });
});
