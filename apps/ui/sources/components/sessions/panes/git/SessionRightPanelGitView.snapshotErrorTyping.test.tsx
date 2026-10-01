import * as React from 'react';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionResumeProvider } from '@/components/sessions/model/SessionResumeContext';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const emitSessionResumeRequestSpy = vi.hoisted(() => vi.fn(async (_sessionId: string) => true));
const loadCommitHistorySpy = vi.hoisted(() => vi.fn());
let machineReachable = false;
let machineRpcTargetAvailable = false;
let sessionPath: string | null = '/repo';
let projectPath: string | null = '/repo';
let activeGitSubTab: 'commit' | 'update' | 'history' = 'commit';
let snapshotError: { message: string; at: number; errorCode?: string } = { message: 'RPC method not available', at: 1 };

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
            useSessionProjectScmSnapshot: () => null,
            useSessionProjectScmSnapshotError: () => snapshotError,
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

describe('SessionRightPanelGitView (snapshot error is typed, never raw)', () => {
    beforeEach(() => {
        machineReachable = false;
        machineRpcTargetAvailable = true;
        sessionPath = '/repo';
        projectPath = '/repo';
        activeGitSubTab = 'commit';
        loadCommitHistorySpy.mockReset();
    });

    it('renders the typed unavailability reason instead of a generic retry plus internal detail', async () => {
        // `F-UI-2`: this slot passed only `details` — the raw `scmSnapshotError.message` — and never
        // the structured code, so `SourceControlUnavailableState` fell back to `errors.tryAgain` and
        // printed the detail verbatim. Q1V observed exactly that live:
        //   "Error / Please try again / Retry / Cannot read properties of undefined (reading 'emit')"
        // and this test reproduced that string before the fix. The input below is what the corrected
        // writer (`scmStatusSync.ts`) now stores for a transport failure.
        snapshotError = {
            message: 'RPC method not available',
            errorCode: 'BACKEND_UNAVAILABLE',
            at: 1,
        };

        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);
        const text = screen.getTextContent();

        // The harness renders translation KEYS, so assert the key the typed branch resolves to.
        expect(text).toContain('errors.sourceControlUnavailableForSession');
        expect(text).not.toContain('errors.tryAgain');
        // No internal transport vocabulary reaches the user.
        expect(text).not.toContain('RPC method not available');
        expect(text).not.toContain('emit');
    });

    it('still renders the unsupported-feature copy for a feature-unsupported snapshot error', async () => {
        snapshotError = {
            message: 'Method not found',
            errorCode: 'FEATURE_UNSUPPORTED',
            at: 1,
        };

        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);
        const text = screen.getTextContent();

        expect(text).toContain('deps.installNotSupported');
        expect(text).not.toContain('Method not found');
    });
});
