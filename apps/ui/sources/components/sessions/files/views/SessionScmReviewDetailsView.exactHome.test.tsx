import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createPartialStorageModuleMock, renderScreen } from '@/dev/testkit';
import type { Session } from '@/sync/domains/state/storageTypes';
import { installSessionFilesViewCommonModuleMocks } from './sessionFilesViewsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Two Homes can each host a Session with the same id. The review host must read its snapshot,
 * touched paths, commit selection and workspace scope through the qualified address; an
 * unqualified read resolves by id alone and can show — and offer to commit — the other Home's
 * working tree.
 */
const mockSession = {
    id: 's1',
    seq: 0,
    createdAt: 0,
    updatedAt: 0,
    active: false,
    activeAt: 0,
    metadata: { path: '/tmp/repo', host: '' },
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
    thinking: false,
    thinkingAt: 0,
    presence: 0,
} satisfies Session;

const workspaceScopeCalls: Array<{ sessionId: unknown; serverId: unknown }> = [];

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

function snapshotWithFile(path: string) {
    return {
        fetchedAt: 1,
        projectKey: `m1:/tmp/${path}`,
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
        entries: [entry(path)],
        totals: {
            includedFiles: 0,
            pendingFiles: 1,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 1,
            pendingRemoved: 0,
        },
    };
}

// An unqualified read is the ambiguous case: the id alone lands on whichever Home the shared
// cache happens to hold, modelled here as Home A.
const SNAPSHOTS_BY_HOME: Record<string, ReturnType<typeof snapshotWithFile>> = {
    'home-a': snapshotWithFile('src/home-a.ts'),
    'home-b': snapshotWithFile('src/home-b.ts'),
};

installSessionFilesViewCommonModuleMocks({
    storage: async (importOriginal) =>
        createPartialStorageModuleMock(importOriginal, {
            useSession: () => mockSession,
            useSessionMessages: () => ({ messages: [], isLoaded: true }),
            useSessionProjectScmSnapshot: (_sessionId: string, serverId?: string | null) =>
                SNAPSHOTS_BY_HOME[String(serverId ?? 'home-a')] ?? null,
            useSessionProjectScmSnapshotError: () => null,
            useSessionRealtimeScmTranscriptConsumer: () => {},
            useWorkspaceScmTouchedPathsForSession: () => [],
            useSessionProjectScmCommitSelectionPaths: () => [],
            useSessionProjectScmCommitSelectionPatches: () => [],
            useSessionProjectScmOperationLog: () => [],
            useSessionWorkspacePath: () => '/tmp/repo',
            useProjectForSession: () => null,
            useProjectSessions: () => [],
            useWorkspaceReviewCommentsDrafts: () => [],
            useSetting: () => 25,
        }),
});

vi.mock('@expo/vector-icons', () => ({
    Octicons: 'Octicons',
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        openDetailsTab: vi.fn(),
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/sync/domains/session/resolveWorkspaceScopeForSession', () => ({
    resolveWorkspaceScopeForSession: () => null,
    useWorkspaceScopeForSession: (sessionId: unknown, serverId?: unknown) => {
        workspaceScopeCalls.push({ sessionId, serverId });
        return serverId
            ? { serverId: String(serverId), machineId: 'm1', rootPath: '/tmp/repo' }
            : null;
    },
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

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: {
        invalidateFromAutoRefresh: vi.fn(),
        invalidateFromAutoRefreshAndAwait: vi.fn(async () => {}),
        invalidateFromMutationAndAwait: vi.fn(async () => {}),
        invalidateFromUser: vi.fn(),
    },
}));

vi.mock('@/scm/diffCache/useScmDiffCacheLimits', () => ({
    useScmDiffCacheLimits: () => {},
}));

vi.mock('@/scm/refresh/useScmAdaptivePolling', () => ({
    useScmAdaptivePolling: () => {},
}));

vi.mock('@/components/ui/scroll/useScrollEdgeFades', () => ({
    useScrollEdgeFades: () => ({
        visibility: { top: false, bottom: false, left: false, right: false },
        onViewportLayout: () => {},
        onContentSizeChange: () => {},
        onScroll: () => {},
    }),
}));

vi.mock('@/components/ui/scroll/ScrollEdgeFades', () => ({
    ScrollEdgeFades: () => null,
}));
vi.mock('@/components/ui/scroll/ScrollEdgeIndicators', () => ({
    ScrollEdgeIndicators: () => null,
}));

vi.mock('@/components/workspaces/scm/review/ChangedFilesReview', () => ({
    ChangedFilesReview: (props: any) => React.createElement('ChangedFilesReview', props),
}));

describe('SessionScmReviewDetailsView (exact Home)', () => {
    it('reviews the working tree of the Home named by the route, not a same-id match', async () => {
        workspaceScopeCalls.length = 0;
        const { SessionScmReviewDetailsView } = await import('./SessionScmReviewDetailsView');

        const screen = await renderScreen(
            <SessionScmReviewDetailsView sessionId="s1" serverId="home-b" scopeId="session:s1" />,
        );

        const review = screen.findAllByType('ChangedFilesReview' as any)[0];
        expect(review).toBeTruthy();
        expect(review.props.allRepositoryChangedFiles.map((file: any) => file.fullPath))
            .toEqual(['src/home-b.ts']);
        expect(workspaceScopeCalls.at(-1)?.serverId).toBe('home-b');
    });
});
