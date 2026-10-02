import * as React from 'react';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScmCapabilities, type ScmCapabilities } from '@happier-dev/protocol/scm';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

// The Changes list is the real virtualized list; its web engine schedules frames (platform boundary).
(globalThis as any).requestAnimationFrame ??= vi.fn(() => 0);

import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { AppPaneProvider, useAppPaneContext } from '../../appShell/panes/AppPaneProvider';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Hoist these boundaries before AppPaneProvider can load and cache their real modules.
vi.mock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (value: any) => value?.web ?? value?.default ?? null,
            },
        });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/sync/domains/state/storage', async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useLocalSetting: (key: string) => {
                if (key === 'detailsPaneTabsBehavior') return 'preview';
                if (key === 'uiMultiPanePanelsEnabled') return true;
                return undefined;
            },
            useSession: () => ({ active: true, metadata: { path: sessionPathMock, machineId: 'm1' } }),
            useSessionListRenderableWithServerScope: () => createSessionListRenderableSessionFixture({ id: 's1', ...{ active: true, metadata: { host: 'test-machine', path: sessionPathMock ?? '', machineId: 'm1' } } }),
            useMachine: () => null,
            useSessionProjectScmSnapshot: () => scmSnapshotMock,
            useSessionProjectScmSnapshotError: () => null,
            useWorkspaceScmTouchedPathsForSession: () => [],
            useSessionProjectScmOperationLog: () => [],
            useSessionProjectScmInFlightOperation: () => null,
            useSessionProjectScmCommitSelectionPaths: () => [],
            useSessionProjectScmCommitSelectionPatches: () => [],
            useSessionRealtimeScmTranscriptConsumer: () => {},
            useSetting: (key: string) => {
                if (key === 'scmGitPaneLayout') return paneLayout;
                if (key === 'scmCommitStrategy') return 'atomic';
                if (key === 'scmRemoteConfirmPolicy') return 'always';
                if (key === 'scmPushRejectPolicy') return 'reject';
                return undefined;
            },
            useSessionMessages: () => ({ messages: [], isLoaded: true }),
            useProjectForSession: () => null,
            useProjectSessions: () => [],
            storage: { getState: () => ({ sessions: {}, settings: {}, concurrentSessionListCacheByServerId: {} }) },
        });
});
vi.mock('@/text', async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
});

// Hoisted with the `vi.mock` factories below: `@/sync/sync` reaches `@/scm/scmStatusSync` while an
// earlier mock factory is still evaluating, so a plain module-scope `const` is still in its TDZ
// when the factory runs.
const { invalidateFromUserAndAwaitSpy, invalidateFromAutoRefreshAndAwaitSpy } = vi.hoisted(() => ({
    invalidateFromUserAndAwaitSpy: vi.fn(),
    invalidateFromAutoRefreshAndAwaitSpy: vi.fn(async () => {}),
}));
const loadCommitHistorySpy = vi.fn();
const useChangedFilesDataSpy = vi.fn();
let sessionPathMock: string | null = '/workspace';
let scmSnapshotMock: any = null;
let scmWriteEnabledMock = true;
let paneLayout: 'unified' | 'tabs' = 'tabs';

function buildChangedFilesDataMock(overrides: Record<string, unknown> = {}) {
    return {
        sessionAttribution: { confidence: 'unknown', reason: 'unavailable' },
        sessionCheckpointOverlap: 'unknown',
        showTurnViewToggle: false,
        showTurnAgentReportedViewToggle: false,
        showTurnCheckpointViewToggle: false,
        turnCheckpointMetadata: null,
        showSessionViewToggle: false,
        scmStatusFiles: null,
        changedFilesCount: 0,
        shouldShowAllFiles: true,
        allRepositoryChangedFiles: [],
        turnAttributedFiles: [],
        turnAgentReportedFiles: [],
        turnCheckpointFiles: [],
        turnRepositoryOnlyFiles: [],
        sessionAttributedFiles: [],
        repositoryOnlyFiles: [],

        ...overrides,
    };
}

function buildScmSnapshotMock(capabilities: Partial<ScmCapabilities>) {
    return {
        fetchedAt: 1,
        projectKey: 'm1:/workspace',
        repo: { isRepo: true, rootPath: '/workspace', backendId: 'git', mode: '.git' },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
        capabilities: createScmCapabilities({ changeSetModel: 'index', readStatus: true, ...capabilities }),
    } satisfies ScmWorkingSnapshot;
}

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
    TextSelectabilityScope: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/lists/virtualized/VirtualizedList', async () => {
    const { createCapturingLegendListMock } = await import('@/dev/testkit/mocks/legendList');
    return {
        VirtualizedList: createCapturingLegendListMock({ renderItems: true }).module.LegendList,
    };
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => scmWriteEnabledMock,
}));

vi.mock('@/hooks/session/files/useChangedFilesData', () => ({
    useChangedFilesData: (...args: any[]) => useChangedFilesDataSpy(...args),
}));

vi.mock('@/hooks/session/files/useScmCommitHistory', () => ({
    useScmCommitHistory: () => ({
        historyEntries: [],
        historyLoading: false,
        historyHasMore: false,
        loadCommitHistory: loadCommitHistorySpy,
    }),
}));

vi.mock('@/hooks/session/files/useFilesScmOperations', () => ({
    useFilesScmOperations: () => ({
        scmOperationBusy: false,
        scmOperationStatus: null,
        commitPreflight: { allowed: true, message: null },
        pullPreflight: { allowed: true, message: null },
        pushPreflight: { allowed: true, message: null },
        runRemoteOperation: vi.fn(),
        createCommitFromMessage: vi.fn(async () => ({ ok: true })),
    }),
}));

vi.mock('@/scm/registry/scmUiBackendRegistry', () => {
    const scmUiBackendRegistry = {
        getPluginForSnapshot: () => ({
            displayName: 'Git',
            commitActionConfig: () => ({ label: 'Commit' }),
            remoteActionConfig: () => ({ fetch: true, pull: true, push: true }),
            inferRemoteTarget: () => ({ remote: 'origin', branch: 'main' }),
            mapCapabilitiesToUiPolicy: () => ({ supportedDiffAreas: ['pending'], changeSetModel: 'index' }),
        }),
    };
    return {
        scmUiBackendRegistry,
        createScmUiBackendRegistry: () => scmUiBackendRegistry,
    };
});

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: {
        invalidateFromUserAndAwait: invalidateFromUserAndAwaitSpy,
        invalidateFromAutoRefreshAndAwait: invalidateFromAutoRefreshAndAwaitSpy,
        invalidateFromMutationAndAwait: vi.fn(async () => {}),
    },
}));

vi.mock('@/components/workspaces/scm/commitComposer/ScmCommitComposerCard', () => ({
    ScmCommitComposerCard: (props: any) => React.createElement('ScmCommitComposerCard', props),
}));

vi.mock('@/components/sessions/files/SourceControlOperationsHistorySection', () => ({
    SourceControlOperationsHistorySection: (props: any) => React.createElement('SourceControlOperationsHistorySection', props),
}));

vi.mock('@/components/sessions/files/SourceControlOperationsLogSection', () => ({
    SourceControlOperationsLogSection: (props: any) => React.createElement('SourceControlOperationsLogSection', props),
}));

vi.mock('@/components/sessions/files/content/ChangedFilesList', () => ({
    ChangedFilesList: (props: any) => React.createElement('ChangedFilesList', props),
}));

vi.mock('@/components/workspaces/scm/SourceControlBranchSummary', () => ({
    SourceControlBranchSummary: (props: any) => React.createElement('SourceControlBranchSummary', props),
}));

vi.mock('@/components/sessions/sourceControl/commitSelection/ScmChangesSelectionHeaderRow', () => ({
    ScmChangesSelectionHeaderRow: (props: any) => React.createElement('ScmChangesSelectionHeaderRow', props),
}));


vi.mock('@/components/sessions/sourceControl/changes/ScmChangeDiscardButton', () => ({
    ScmChangeDiscardButton: (props: any) => React.createElement('ScmChangeDiscardButton', props),
}));

vi.mock('@/components/workspaces/scm/changes/ScmChangeOverflowMenu', () => ({
    ScmChangeOverflowMenu: (props: any) => React.createElement('ScmChangeOverflowMenu', props),
}));

vi.mock('@/components/sessions/files/views/SessionRepositoryTreeBrowserView', () => ({
    SessionRepositoryTreeBrowserView: (props: any) => React.createElement('SessionRepositoryTreeBrowserView', props),
}));

// Attribution and view-mode selection are the real domain owner (`@/scm/scmAttribution`), not a mock.


vi.mock('@/scm/operations/applyFileStageAction', () => ({
    applyFileStageAction: vi.fn(async () => {}),
}));

vi.mock('@/scm/operations/applyBulkFileStageAction', () => ({
    applyBulkFileStageAction: vi.fn(async () => {}),
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: () => {},
}));

vi.mock('@/components/workspaces/scm/states', () => ({
    SourceControlStaleSnapshotNotice: () => null,
    SourceControlUnavailableState: () => React.createElement('SourceControlUnavailableState'),
    NotSourceControlRepositoryState: () => React.createElement('NotSourceControlRepositoryState'),
    SourceControlSessionInactiveState: () => React.createElement('SourceControlSessionInactiveState'),
}));

vi.mock('@/components/workspaces/files/repositoryTree/computeExpandedPathsForReveal', () => ({
    computeExpandedPathsForReveal: (args: any) => args.expandedPaths,
}));

vi.mock('@/components/sessions/model/useSessionMachineReachability', async (importOriginal) => {
    const { createReachableSessionMachineReachability, installSessionMachineReachabilityModuleMock } = await import('@/dev/testkit/mocks/sessionMachineReachability');
    return installSessionMachineReachabilityModuleMock({
        useSessionMachineReachability: () => createReachableSessionMachineReachability(),
    })(importOriginal);
});

describe('SessionRightPanel git sub-tabs', () => {
    beforeEach(() => {
        paneLayout = 'tabs';
        sessionPathMock = '/workspace';
        scmWriteEnabledMock = true;
        scmSnapshotMock = null;
        useChangedFilesDataSpy.mockReset();
        invalidateFromUserAndAwaitSpy.mockClear();
        invalidateFromAutoRefreshAndAwaitSpy.mockClear();
        useChangedFilesDataSpy.mockImplementation(() => buildChangedFilesDataMock());
    });

    it('refreshes SCM snapshot without preloading commit history when mounted', async () => {
        const { SessionRightPanel } = await import('./SessionRightPanel');

        invalidateFromAutoRefreshAndAwaitSpy.mockClear();
        loadCommitHistorySpy.mockClear();
        sessionPathMock = '/workspace';
        scmSnapshotMock = buildScmSnapshotMock({
            readLog: true,
            writeCommit: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            writeDiscard: true,
            writeInclude: true,
            writeExclude: true,
        });

        await renderScreen(<AppPaneProvider>
                    <SessionRightPanel sessionId="s1" scopeId="session:s1" />
                </AppPaneProvider>);

        // Allow mount effects to flush.
        await act(async () => {
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        // Scoped to the pane's Home; this pane scope names none.
        expect(invalidateFromAutoRefreshAndAwaitSpy).toHaveBeenCalledWith('s1', undefined);
        expect(loadCommitHistorySpy).not.toHaveBeenCalled();
    });

    it('refreshes SCM snapshot even when sessionPath is missing', async () => {
        const { SessionRightPanel } = await import('./SessionRightPanel');

        invalidateFromAutoRefreshAndAwaitSpy.mockClear();
        loadCommitHistorySpy.mockClear();
        sessionPathMock = null;
        scmSnapshotMock = buildScmSnapshotMock({
            readLog: true,
            writeCommit: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            writeDiscard: true,
            writeInclude: true,
            writeExclude: true,
        });

        await renderScreen(<AppPaneProvider>
                    <SessionRightPanel sessionId="s1" scopeId="session:s1" />
                </AppPaneProvider>);

        // Allow mount effects to flush.
        await act(async () => {
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        // Scoped to the pane's Home; this pane scope names none.
        expect(invalidateFromAutoRefreshAndAwaitSpy).toHaveBeenCalledWith('s1', undefined);
        expect(loadCommitHistorySpy).not.toHaveBeenCalled();
    });

    it('offers Changes and History only in Tabs layout and switches to History', async () => {
        const { SessionRightPanel } = await import('./SessionRightPanel');

        let observedState: any = null;
        useChangedFilesDataSpy.mockImplementation(() => buildChangedFilesDataMock({
            scmStatusFiles: {
                includedFiles: [],
                pendingFiles: [],
                changeSetModel: 'index',
                branch: 'main',
                upstream: null,
                ahead: 0,
                behind: 0,
                detached: false,
                totalIncluded: 0,
                totalPending: 0,
            },
        }));
        const Probe = () => {
            const { state } = useAppPaneContext();
            observedState = state;
            return null;
        };

        scmWriteEnabledMock = true;
        scmSnapshotMock = buildScmSnapshotMock({
            readLog: true,
            writeCommit: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            writeDiscard: true,
            writeInclude: true,
            writeExclude: true,
        });
        const screen = await renderScreen(
            <AppPaneProvider>
                <SessionRightPanel sessionId="s1" scopeId="session:s1" />
                <Probe />
            </AppPaneProvider>,
        );
        const commitSurface = screen.findByTestId('session-rightpanel-git-surface:commit');
        expect(screen.findByTestId('session-rightpanel-git-subtab:commit'), screen.getTextContent()).toBeTruthy();
        expect(screen.findByTestId('session-rightpanel-git-subtab:history')).toBeTruthy();

        expect(commitSurface).toBeTruthy();
        expect(screen.findByTestId('session-rightpanel-git-subtab:update')).toBeNull();
        expect(screen.findHostByTestId('session-rightpanel-git-surface:history')).toBeNull();

        await screen.pressByTestIdAsync('session-rightpanel-git-subtab:history');

        expect(observedState?.scopes?.['session:s1']?.right?.tabState?.git?.activeSubTabId).toBe('history');
        expect(screen.findByTestId('session-rightpanel-git-surface:history')).toBeTruthy();
    });


    it('shows Unified without a sub-tab bar', async () => {
        paneLayout = 'unified';
        scmSnapshotMock = buildScmSnapshotMock({ readLog: true, writeCommit: true });
        const { SessionRightPanel } = await import('./SessionRightPanel');
        const screen = await renderScreen(<AppPaneProvider><SessionRightPanel sessionId="s1" scopeId="session:s1" /></AppPaneProvider>);
        expect(screen.findByTestId('session-rightpanel-git-surface:commit'), screen.getTextContent()).toBeTruthy();
        expect(screen.findAllByTestId('session-rightpanel-git-subtab:commit')).toHaveLength(0);
        expect(screen.findAllByTestId('session-rightpanel-git-subtab:history')).toHaveLength(0);
    });

    it('hides the commit composer when the repository does not support commits', async () => {
        const { SessionRightPanel } = await import('./SessionRightPanel');

        scmWriteEnabledMock = false;
        scmSnapshotMock = buildScmSnapshotMock({
            readLog: true,
            writeCommit: false,
            writeRemoteFetch: false,
            writeRemotePull: false,
            writeRemotePush: false,
            writeDiscard: false,
            writeInclude: false,
            writeExclude: false,
        });

        const screen = await renderScreen(<AppPaneProvider>
                    <SessionRightPanel sessionId="s1" scopeId="session:s1" />
                </AppPaneProvider>);
        expect(screen.findAllHostsByTestId('scm-commit-message')).toHaveLength(0);
        expect(screen.findAllHostsByTestId('session-rightpanel-git-subtab:update')).toHaveLength(0);
        expect(screen.findAllHostsByTestId('session-rightpanel-git-subtab:history'), screen.getTextContent()).toHaveLength(1);
    });

    it('does not crash when SCM snapshot loads after mount', async () => {
        const { SessionRightPanelGitView } = await import('./git/SessionRightPanelGitView');

        type HarnessHandle = { bump: () => void };
        const Harness = React.forwardRef<HarnessHandle>((_props, ref) => {
            const [scopeId, setScopeId] = React.useState('session:s1');
            React.useImperativeHandle(ref, () => ({ bump: () => setScopeId((prev) => `${prev}:bump`) }), []);
            return <SessionRightPanelGitView sessionId="s1" scopeId={scopeId} />;
        });

        scmSnapshotMock = null;
        const harnessRef = React.createRef<HarnessHandle>();
        const screen = await renderScreen(<AppPaneProvider>
                    <Harness ref={harnessRef} />
                </AppPaneProvider>);

        await act(async () => {
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        scmSnapshotMock = {
            ...buildScmSnapshotMock({
                readLog: true,
                writeCommit: true,
                writeRemoteFetch: true,
                writeRemotePull: true,
                writeRemotePush: true,
                writeDiscard: true,
                writeInclude: true,
                writeExclude: true,
            }),
            branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
        };

        await act(async () => {
            harnessRef.current?.bump();
        });

        expect(screen.findAllByTestId('session-rightpanel-git-surface:commit').length, screen.getTextContent()).toBeGreaterThan(0);
    });
});
