import * as React from 'react';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { resetSessionDraftValueCachesForTests } from '@/dev/testkit/sessionDraftRepositoryTestkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const publishBranchMock = vi.hoisted(() => vi.fn(async () => true));
const usePublishBranchActionMock = vi.hoisted(() => vi.fn<(input: unknown) => unknown>());
const setScmRemoteConfirmPolicyMock = vi.hoisted(() => vi.fn());
const confirmCommitAdjacentPushMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<boolean>>(async () => true));
const scmOperationsState = vi.hoisted(() => ({
    pullPreflight: { allowed: false, reason: 'upstream_required', message: 'Set a tracking target before pull or push.' } as any,
    pushPreflight: { allowed: false, reason: 'upstream_required', message: 'Set a tracking target before pull or push.' } as any,
    runRemoteOperation: vi.fn(),
    createCommitFromMessage: vi.fn(),
}));
let activeGitSubTab: 'commit' | 'history' = 'commit';
let scmSnapshotMock: any = null;
let scmWriteEnabledMock = true;
let selectedPaths: string[] = [];

vi.mock('@/sync/domains/state/browserRecordStorage', async () => {
    const { createBrowserRecordStorageModuleMock } = await import('@/dev/testkit/mocks/browserRecordStorage');
    return createBrowserRecordStorageModuleMock();
});

// Secure credential storage is the boundary; the draft hook and repository stay real.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async () => ({
                token: `header.${Buffer.from(JSON.stringify({ sub: 'account-git-header' })).toString('base64')}.signature`,
                secret: '',
            }),
        },
    });
});


// Hoist boundaries before any static dependency can cache its real module.
vi.mock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: any) => React.createElement('View', props, props.children),
            Pressable: (props: any) => React.createElement('Pressable', props, props.children),
            Text: (props: any) => React.createElement('Text', props, props.children),
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'web',
                select: (value: any) => value?.default ?? null,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
        });
});
vi.mock('@/text', async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useSetting: () => null,
            useSettingMutable: (key: string) => (
                key === 'scmRemoteConfirmPolicy'
                    ? ['always', setScmRemoteConfirmPolicyMock]
                    : [null, vi.fn()]
            ),
            useAllMachines: () => [{ id: 'm1', active: true, activeAt: 1, metadata: { host: 'mbp', homeDir: '/tmp' } }],
            useProjectForSession: () => null,
            useProjectSessions: () => [],
            useMachine: () => ({ online: true }),
            useSession: () => ({ active: true, metadata: { machineId: 'm1', path: '/repo' } }),
            useSessionListRenderableWithServerScope: () => createSessionListRenderableSessionFixture({ id: 's1', ...{ active: true, metadata: { host: 'test-machine', machineId: 'm1', path: '/repo' } } }),
            useSessionProjectScmCommitSelectionPaths: () => selectedPaths,
            useSessionProjectScmCommitSelectionPatches: () => [],
            useSessionProjectScmInFlightOperation: () => null,
            useSessionProjectScmOperationLog: () => [],
            useSessionProjectScmSnapshot: () => scmSnapshotMock,
            useSessionProjectScmSnapshotError: () => null,
            useWorkspaceScmTouchedPathsForSession: () => [],
            useSessionProjectScmOperationLogEntryIds: () => [],
            useWorkspaceScmTouchedPathsForSessionCount: () => 0,
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
vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        scopeState: {},
        openRight: vi.fn(),
        setRightTab: vi.fn(),
        openDetailsTab: vi.fn(),
    }),
}));

vi.mock('@/components/workspaces/scm/useWorkspaceScmTabState', () => ({
    useWorkspaceScmTabState: () => ({
        activeGitSubTab,
        setActiveGitSubTab: vi.fn(),
        commitDraftMessage: '',
        setCommitDraftMessage: vi.fn(),
    }),
}));

vi.mock('./useSessionRightPanelGitOpenDetails', () => ({
    useSessionRightPanelGitOpenDetails: () => ({
        openFileInDetails: vi.fn(),
        openFileInDetailsPinned: vi.fn(),
        openCommitInDetails: vi.fn(),
    }),
}));

vi.mock('@/hooks/session/files/useScmCommitHistory', () => ({
    useScmCommitHistory: () => ({
        historyEntries: [],
        historyLoading: false,
        historyHasMore: false,
        loadCommitHistory: vi.fn(),
    }),
}));

vi.mock('@/hooks/session/files/useFilesScmOperations', () => ({
    useFilesScmOperations: () => ({
        scmOperationBusy: false,
        scmOperationStatus: null,
        commitPreflight: { allowed: true, message: null },
        pullPreflight: scmOperationsState.pullPreflight,
        pushPreflight: scmOperationsState.pushPreflight,
        runRemoteOperation: scmOperationsState.runRemoteOperation,
        createCommitFromMessage: scmOperationsState.createCommitFromMessage,
        commitMessageGeneratorEnabled: false,
        generateCommitMessageSuggestion: vi.fn(),
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => scmWriteEnabledMock,
}));

vi.mock('@/hooks/session/sourceControl/usePublishBranchAction', () => ({
    usePublishBranchAction: (input: unknown) => usePublishBranchActionMock(input),
}));

vi.mock('@/scm/operations/commitAdjacentPushConfirmation', () => ({
    confirmCommitAdjacentPush: (input: unknown) => confirmCommitAdjacentPushMock(input),
}));

vi.mock('@/components/workspaces/scm/states', () => ({
    SourceControlStaleSnapshotNotice: () => null,
    NotSourceControlRepositoryState: () => React.createElement('NotSourceControlRepositoryState'),
    SourceControlUnavailableState: () => React.createElement('SourceControlUnavailableState'),
    SourceControlSessionInactiveState: () => React.createElement('SourceControlSessionInactiveState'),
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
        invalidateFromUserAndAwait: vi.fn(),
        invalidateFromAutoRefreshAndAwait: vi.fn(),
        invalidateFromMutationAndAwait: vi.fn(async () => {}),
    },
}));

vi.mock('./SessionRightPanelGitCommitTabContent', () => ({
    SessionRightPanelGitCommitTabContent: (props: any) => React.createElement('CommitTab', { ...props, testID: 'session-right-panel-git-commit-tab' }),
}));

function createScmSnapshot(overrides?: Partial<NonNullable<typeof scmSnapshotMock>>) {
    return {
        fetchedAt: 1,
        projectKey: 'm1:/repo',
        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
        capabilities: {
            readStatus: true,
            readDiffFile: true,
            readDiffCommit: true,
            readLog: true,
            writeCommit: true,
            writeInclude: true,
            writeExclude: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            supportedDiffAreas: ['included', 'pending'],
        },
        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
        ...overrides,
    };
}

// Owner loading belongs to setup, not an individual interaction's timeout.
const { SessionRightPanelGitView } = await import('./SessionRightPanelGitView');

describe('SessionRightPanelGitView (remote action visibility)', () => {
    beforeEach(() => {
        resetSessionDraftValueCachesForTests();
        selectedPaths = [];
        publishBranchMock.mockClear();
        setScmRemoteConfirmPolicyMock.mockClear();
        confirmCommitAdjacentPushMock.mockClear();
        scmOperationsState.runRemoteOperation.mockReset();
        scmOperationsState.createCommitFromMessage.mockReset();
        scmOperationsState.pullPreflight = { allowed: false, reason: 'upstream_required', message: 'Set a tracking target before pull or push.' };
        scmOperationsState.pushPreflight = { allowed: false, reason: 'upstream_required', message: 'Set a tracking target before pull or push.' };
        activeGitSubTab = 'commit';
        scmSnapshotMock = createScmSnapshot();
        scmWriteEnabledMock = true;
        usePublishBranchActionMock.mockReturnValue({
            canPublish: true,
            publishBusy: false,
            publishBranch: publishBranchMock,
        });
    });

    // Session-tabs lab H1/G1: Push is the pane header's next step (one trailing action), not a second
    // push button beside the commit card.
    it('publishes the branch line and Push N as the pane header next step, and pushes from there', async () => {
        activeGitSubTab = 'commit';
        scmOperationsState.pushPreflight = { allowed: true };
        scmOperationsState.pullPreflight = { allowed: true };
        scmSnapshotMock = createScmSnapshot({
            repo: {
                isRepo: true,
                rootPath: '/repo',
                backendId: 'git',
                mode: '.git',
                remotes: [{ name: 'origin', fetchUrl: 'git@example.com:repo.git', pushUrl: 'git@example.com:repo.git' }],
            },
            branch: { head: 'v0.3', upstream: 'origin/v0.3', ahead: 2, behind: 0, detached: false },
        });
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePublishedPaneHeaderContent } = await import('@/components/appShell/panes/paneHeaderSlot');
        let published: ReturnType<typeof usePublishedPaneHeaderContent> = null;
        function HeaderReader() {
            published = usePublishedPaneHeaderContent('git');
            return React.createElement(React.Fragment, null, published?.line?.leading, published?.action);
        }

        const screen = await renderScreen(
            <PaneHeaderSlotProvider>
                <HeaderReader />
                <PaneHeaderSlotScope slotKey="git">
                    <SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />
                </PaneHeaderSlotScope>
            </PaneHeaderSlotProvider>,
        );

        const line = (published as any)?.line;
        expect(screen.findByTestId('scm-branch-menu-trigger')).toBeTruthy();
        expect(screen.getTextContent()).toContain('v0.3');
        expect(line?.segments).not.toContain('sessionGitPane.header.toPush');
        expect(screen.findByTestId('session-git-header-action-menu')).toBeTruthy();
        expect(screen.findAllByTestId('session-right-panel-git-update-tab')).toHaveLength(0);
        const commitTab = screen.findByTestId('session-right-panel-git-commit-tab');
        expect((commitTab?.props as any)?.commitAdjacentPushAction).toBeUndefined();

        await screen.pressByTestIdAsync('session-git-header-action:push');
        expect(scmOperationsState.runRemoteOperation).toHaveBeenCalledWith('push');
    });

    it('publishes Publish as the next step when tracking is required', async () => {
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePublishedPaneHeaderContent } = await import('@/components/appShell/panes/paneHeaderSlot');
        function HeaderReader() {
            const published = usePublishedPaneHeaderContent('git');
            return <>{published?.line?.leading}{published?.action}</>;
        }
        const screen = await renderScreen(<PaneHeaderSlotProvider><HeaderReader /><PaneHeaderSlotScope slotKey="git"><SessionRightPanelGitView sessionId="s1" scopeId="session:s1" /></PaneHeaderSlotScope></PaneHeaderSlotProvider>);
        expect(screen.findByTestId('session-git-header-action:publish')).toBeTruthy();
        expect(screen.findByTestId('scm-branch-menu-trigger')).toBeTruthy();
        expect(screen.findAllByTestId('session-rightpanel-git-subtab:update')).toHaveLength(0);
        await screen.pressByTestIdAsync('session-git-header-action:publish');
        expect(publishBranchMock).toHaveBeenCalled();
    });

    it('keeps Push N secondary when a selected change and persisted message make the commit ready', async () => {
        const { upsertServerProfile, resolveServerProfileScopeIdForIdentifier } = await import('@/sync/domains/server/serverProfiles');
        const { writeExistingSessionDraft } = await import('@/sync/ops/sessionDrafts/sessionDraftRepository');
        const { prepareSessionDraftPersistenceStorage } = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
        const profile = await upsertServerProfile({ serverUrl: 'https://git-header.example.test', name: 'Git header test' });
        await prepareSessionDraftPersistenceStorage();
        writeExistingSessionDraft({
            scope: { serverId: resolveServerProfileScopeIdForIdentifier(profile.id), accountId: 'account-git-header' },
            sessionId: 's1',
            patch: { scmCommitMessageV1: 'Keep the change' },
        });
        selectedPaths = ['src/a.ts'];
        scmOperationsState.pushPreflight = { allowed: true };
        scmOperationsState.pullPreflight = { allowed: true };
        scmSnapshotMock = createScmSnapshot({
            branch: { head: 'v0.3', upstream: 'origin/v0.3', ahead: 2, behind: 0, detached: false },
            entries: [{
                path: 'src/a.ts', kind: 'modified', hasIncludedDelta: false, hasPendingDelta: true,
                stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 1, pendingRemoved: 0, isBinary: false },
            }],
        });
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePublishedPaneHeaderContent } = await import('@/components/appShell/panes/paneHeaderSlot');
        let published: ReturnType<typeof usePublishedPaneHeaderContent> = null;
        function HeaderReader() {
            published = usePublishedPaneHeaderContent('git');
            return <>{published?.line?.leading}{published?.action}</>;
        }
        const screen = await renderScreen(<PaneHeaderSlotProvider><HeaderReader /><PaneHeaderSlotScope slotKey="git"><SessionRightPanelGitView sessionId="s1" serverId={profile.id} scopeId="session:s1" /></PaneHeaderSlotScope></PaneHeaderSlotProvider>);
        await flushHookEffects({ cycles: 3 });

        expect(screen.findByTestId('session-right-panel-git-commit-tab')?.props.commitDraftMessage).toBe('Keep the change');
        const action = (published as ReturnType<typeof usePublishedPaneHeaderContent>)?.action;
        expect(React.isValidElement<{ primary: { key: string; count: number; emphasis: string } }>(action) && action.props.primary).toMatchObject({ key: 'push', count: 2, emphasis: 'secondary' });
        await screen.pressByTestIdAsync('session-git-header-action:push');
        expect(scmOperationsState.runRemoteOperation).toHaveBeenCalledWith('push');
    });

    it('keeps the branch readable with a writes-off notice and no header write action, commit form or selection', async () => {
        scmWriteEnabledMock = false;
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePublishedPaneHeaderContent } = await import('@/components/appShell/panes/paneHeaderSlot');
        function HeaderReader() {
            const published = usePublishedPaneHeaderContent('git');
            return <>{published?.line?.leading}{published?.action}</>;
        }
        const screen = await renderScreen(<PaneHeaderSlotProvider><HeaderReader /><PaneHeaderSlotScope slotKey="git"><SessionRightPanelGitView sessionId="s1" scopeId="session:s1" /></PaneHeaderSlotScope></PaneHeaderSlotProvider>);

        expect(screen.findByTestId('scm-branch-menu-trigger')).toBeTruthy();
        expect(screen.findByTestId('session-git-writes-off')).toBeTruthy();
        expect(screen.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('session-git-header-action'))).toHaveLength(0);
        expect(screen.findByTestId('session-right-panel-git-commit-tab')?.props).toMatchObject({
            commitWriteEnabled: false,
            commitSelectionUiEnabled: false,
        });
    });
});
