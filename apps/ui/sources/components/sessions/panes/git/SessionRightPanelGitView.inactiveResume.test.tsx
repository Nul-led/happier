import * as React from 'react';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionResumeProvider } from '@/components/sessions/model/SessionResumeContext';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let capturedInactiveProps: any = null;
const emitSessionResumeRequestSpy = vi.hoisted(() => vi.fn(async (_sessionId: string) => true));
const loadCommitHistorySpy = vi.hoisted(() => vi.fn());
let machineReachable = false;
let machineRpcTargetAvailable = false;
let sessionPath: string | null = '/repo';
let projectPath: string | null = '/repo';
let activeGitSubTab: 'commit' | 'update' | 'history' = 'commit';
let retainedSnapshot: any = null;

// Hoist boundaries before any static dependency can cache its real module.
vi.mock('@/sync/domains/state/storage', async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: () => null,
            useProjectForSession: () => (
                projectPath
                    ? { key: { machineId: 'm1', rootPath: projectPath } }
                    : null
            ),
            useProjectSessions: () => [],
            useAllMachines: () => (
                machineReachable
                    ? [{ id: 'm1', active: true, activeAt: 1, metadata: { host: 'mbp', platform: 'darwin', happyCliVersion: '0', happyHomeDir: '/tmp/.h', homeDir: '/tmp' } }]
                    : [{ id: 'm1', active: false, activeAt: 1, metadata: { host: 'mbp', platform: 'darwin', happyCliVersion: '0', happyHomeDir: '/tmp/.h', homeDir: '/tmp' } }]
            ),
            useSession: () => ({ active: false, metadata: { machineId: 'm1', path: sessionPath } }),
            useSessionListRenderableWithServerScope: () => createSessionListRenderableSessionFixture({ id: 's1', ...{ active: false, metadata: { host: 'test-machine', machineId: 'm1', path: sessionPath ?? '' } } }),
            useSessionProjectScmCommitSelectionPaths: () => [],
            useSessionProjectScmCommitSelectionPatches: () => [],
            useSessionProjectScmInFlightOperation: () => null,
            useSessionProjectScmOperationLog: () => [],
            useSessionProjectScmSnapshot: () => retainedSnapshot,
            useSessionProjectScmSnapshotError: () => ({ message: 'RPC method not available', at: 1 }),
            useWorkspaceScmTouchedPathsForSession: () => [],
            useSessionRealtimeScmTranscriptConsumer: () => {},
        });
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
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
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        scopeState: {},
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
        createCommitFromMessage: vi.fn(),
        commitMessageGeneratorEnabled: false,
        generateCommitMessageSuggestion: vi.fn(),
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/components/workspaces/scm/states', () => ({
    SourceControlStaleSnapshotNotice: () => null,
    NotSourceControlRepositoryState: () => React.createElement('NotSourceControlRepositoryState'),
    SourceControlUnavailableState: () => React.createElement('SourceControlUnavailableState'),
    SourceControlSessionInactiveState: (props: any) => {
        capturedInactiveProps = props;
        return React.createElement('SourceControlSessionInactiveState', props);
    },
}));

vi.mock('./SessionRightPanelGitCommitTabContent', () => ({
    SessionRightPanelGitCommitTabContent: (props: any) => React.createElement('CommitTab', { ...props, testID: 'session-right-panel-git-commit-tab' }),
}));

vi.mock('@/components/sessions/model/sessionResumeRequests', () => ({
    emitSessionResumeRequest: (sessionId: string) => emitSessionResumeRequestSpy(sessionId),
}));

vi.mock('@/components/sessions/model/useSessionMachineReachability', async (importOriginal) => {
    const { installSessionMachineReachabilityModuleMock } = await import('@/dev/testkit/mocks/sessionMachineReachability');
    return installSessionMachineReachabilityModuleMock({
        useSessionMachineReachability: () => ({
            machineReachable,
            machineOnline: machineReachable,
            machineRpcTargetAvailable,
            machineReachability: machineReachable ? 'reachable' : 'unreachable',
        }),
    })(importOriginal);
});

vi.mock('@/scm/registry/scmUiBackendRegistry', () => {
    const scmUiBackendRegistry = {
        getPluginForSnapshot: () => ({
            displayName: 'Git',
            commitActionConfig: () => ({ label: 'Commit' }),
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

// Owner loading belongs to setup, not an individual interaction's timeout.
const { SessionRightPanelGitView } = await import('./SessionRightPanelGitView');

describe('SessionRightPanelGitView (inactive session resume)', () => {
    beforeEach(() => {
        machineReachable = false;
        machineRpcTargetAvailable = false;
        sessionPath = '/repo';
        projectPath = '/repo';
        activeGitSubTab = 'commit';
        retainedSnapshot = null;
        loadCommitHistorySpy.mockReset();
    });

    // Session-tabs lab ST "Git · session not running": the last-known rows stay at full strength under
    // one freshness line that says why they are behind, with Resume as its one recovery.
    it('keeps the last-known changes under a paused freshness line with Resume when the session is not running', async () => {
        machineReachable = true;
        machineRpcTargetAvailable = false;
        capturedInactiveProps = null;
        emitSessionResumeRequestSpy.mockClear();
        retainedSnapshot = {
            fetchedAt: Date.UTC(2026, 8, 29, 9, 58),
            projectKey: 'm1:/repo',
            repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
            capabilities: { readStatus: true, readLog: true, writeCommit: true },
            branch: { head: 'v0.3', upstream: 'origin/v0.3', ahead: 0, behind: 0, detached: false },
            stashCount: 0,
            hasConflicts: false,
            entries: [],
            totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
        };

        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);

        // No terminal "can't reach" card over retained content.
        expect(capturedInactiveProps).toBeNull();
        expect(screen.findAllByType('SourceControlUnavailableState').length).toBe(0);
        expect(screen.findByTestId('session-right-panel-git-commit-tab')).toBeTruthy();
        expect(screen.findByTestId('session-rightpanel-git-paused')).toBeTruthy();

        await screen.pressByTestIdAsync('session-rightpanel-git-paused-action');
        expect(emitSessionResumeRequestSpy).toHaveBeenCalledWith('s1');
    });

    it('provides a resume action when session is inactive', async () => {
        capturedInactiveProps = null;
        machineReachable = false;
        sessionPath = null;
        projectPath = null;
        const onResumeSession = vi.fn(async () => true);


        await renderScreen(<SessionResumeProvider onResumeSession={onResumeSession}>
                    <SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />
                </SessionResumeProvider>);

        expect(capturedInactiveProps).toBeTruthy();
        expect(typeof capturedInactiveProps.onOpenSession).toBe('function');
    });

    it('falls back to emitting a resume request when no resume provider is available', async () => {
        capturedInactiveProps = null;
        machineReachable = false;
        sessionPath = null;
        projectPath = null;
        emitSessionResumeRequestSpy.mockClear();


        await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);

        expect(capturedInactiveProps).toBeTruthy();
        expect(typeof capturedInactiveProps.onOpenSession).toBe('function');
        (capturedInactiveProps.onOpenSession as any)();
        expect(emitSessionResumeRequestSpy).toHaveBeenCalledWith('s1');
    });

    it('keeps the inactive resume state when the machine is reachable but no RPC target is available', async () => {
        capturedInactiveProps = null;
        machineReachable = true;
        machineRpcTargetAvailable = false;


        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);

        expect(capturedInactiveProps).toMatchObject({ machineReachable: true });
        expect(screen.findAllByType('SourceControlUnavailableState').length).toBe(0);
    });

    it('shows unavailable state when machine appears offline but machine RPC target is available', async () => {
        capturedInactiveProps = null;
        machineReachable = false;
        machineRpcTargetAvailable = true;
        sessionPath = '/repo';
        projectPath = '/repo';


        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);

        expect(capturedInactiveProps).toBeNull();
        expect(screen.findAllByType('SourceControlUnavailableState').length).toBe(1);
    });

    it('loads commit history when project path is available even if session metadata path is missing', async () => {
        capturedInactiveProps = null;
        machineReachable = true;
        sessionPath = null;
        projectPath = '/repo';
        activeGitSubTab = 'history';


        await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);

        expect(loadCommitHistorySpy).toHaveBeenCalledWith({ reset: true });
    });
});
