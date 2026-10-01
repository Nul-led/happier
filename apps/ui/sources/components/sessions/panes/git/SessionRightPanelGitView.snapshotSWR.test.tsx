import * as React from 'react';
import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockSnapshot: any = null;
let lastScmOperationsInput: any = null;
const useSessionRealtimeScmTranscriptConsumerMock = vi.hoisted(() => vi.fn());
const invalidateFromUserAndAwaitMock = vi.hoisted(() => vi.fn());
const invalidateFromAutoRefreshAndAwaitMock = vi.hoisted(() => vi.fn());


// Hoist boundaries before any static dependency can cache its real module.
vi.mock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: any) => React.createElement('View', props, props.children),
            Pressable: (props: any) => React.createElement('Pressable', props, props.children),
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
vi.mock('react-native-unistyles', async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                dark: false,
                colors: {
                    textSecondary: '#666',
                    text: '#111',
                },
            },
        });
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(
            importOriginal,
            {
                useSetting: () => null,
                useAllMachines: () => [{ id: 'm1', active: true, activeAt: 1, metadata: { host: 'mbp', homeDir: '/tmp' } }],
                useProjectForSession: () => null,
                useProjectSessions: () => [],
                useMachine: () => ({ online: true }),
                useSession: () => ({ active: true, metadata: { machineId: 'm1', path: '/repo' } }),
                useSessionListRenderableWithServerScope: () => createSessionListRenderableSessionFixture({ id: 's1', ...{ active: true, metadata: { host: 'test-machine', machineId: 'm1', path: '/repo' } } }),
                useSessionProjectScmCommitSelectionPaths: () => [],
                useSessionProjectScmCommitSelectionPatches: () => [],
                useSessionProjectScmInFlightOperation: () => null,
                useSessionProjectScmOperationLog: () => [],
                useSessionProjectScmSnapshot: () => mockSnapshot,
                useSessionProjectScmSnapshotError: () => null,
                useSessionRealtimeScmTranscriptConsumer: useSessionRealtimeScmTranscriptConsumerMock,
                useWorkspaceScmTouchedPathsForSession: () => [],
            },
        );
});
vi.mock('@/text', async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
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
    }),
}));

vi.mock('@/components/workspaces/scm/useWorkspaceScmTabState', () => ({
    useWorkspaceScmTabState: () => ({
        activeGitSubTab: 'commit',
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
    useFilesScmOperations: (input: any) => {
        lastScmOperationsInput = input;
        return {
            scmOperationBusy: false,
            scmOperationStatus: null,
            commitPreflight: { allowed: true, message: null },
            pullPreflight: { allowed: true, message: null },
            pushPreflight: { allowed: true, message: null },
            runRemoteOperation: vi.fn(),
            createCommitFromMessage: vi.fn(),
            commitMessageGeneratorEnabled: false,
            generateCommitMessageSuggestion: vi.fn(),
        };
    },
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
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
            mapCapabilitiesToUiPolicy: () => ({ supportedDiffAreas: ['pending'] }),
        }),
    };
    return {
        scmUiBackendRegistry,
        createScmUiBackendRegistry: () => scmUiBackendRegistry,
    };
});

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: {
        invalidateFromUserAndAwait: invalidateFromUserAndAwaitMock,
        invalidateFromAutoRefreshAndAwait: invalidateFromAutoRefreshAndAwaitMock,
    },
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('./SessionRightPanelGitCommitTabContent', () => ({
    SessionRightPanelGitCommitTabContent: () => React.createElement('CommitTab', { testID: 'session-right-panel-git-commit-tab' }),
}));

function createTimeoutCapture() {
    const scheduledTimeouts: Array<() => void> = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((
        callback: Parameters<typeof setTimeout>[0],
        _delay?: number,
        ...args: Array<unknown>
    ) => {
        if (typeof callback === 'function') {
            scheduledTimeouts.push(() => {
                callback(...args);
            });
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    return {
        scheduledTimeouts,
        setTimeoutSpy,
    };
}

function createValidSnapshot() {
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
    };
}

// Owner loading belongs to setup, not an individual interaction's timeout.
const { SessionRightPanelGitView } = await import('./SessionRightPanelGitView');

describe('SessionRightPanelGitView (snapshot SWR)', () => {
    it('registers the mounted git surface as a realtime SCM transcript consumer', async () => {
        const validSnapshot = createValidSnapshot();
        mockSnapshot = validSnapshot;
        useSessionRealtimeScmTranscriptConsumerMock.mockClear();

        await renderScreen(React.createElement(SessionRightPanelGitView, { sessionId: 's1', scopeId: 'session:s1', serverId: 'home-a' }));

        // The exact Home travels with the registration: another Home hosting the same Session
        // id must not receive this surface's realtime SCM routing.
        expect(useSessionRealtimeScmTranscriptConsumerMock)
            .toHaveBeenCalledWith({ serverId: 'home-a', sessionId: 's1' }, validSnapshot);
    });

    it('keeps retrying source-control refresh while the first snapshot is still unavailable', async () => {
        const { scheduledTimeouts, setTimeoutSpy } = createTimeoutCapture();
        mockSnapshot = null;
        invalidateFromUserAndAwaitMock.mockReset();
        invalidateFromAutoRefreshAndAwaitMock.mockReset();

        try {
            await renderScreen(React.createElement(SessionRightPanelGitView, { sessionId: 's1', scopeId: 'session:s1' }));

            expect(invalidateFromUserAndAwaitMock).not.toHaveBeenCalled();
            expect(invalidateFromAutoRefreshAndAwaitMock).toHaveBeenCalledWith('s1', undefined);

            await flushHookEffects({ cycles: 1, turns: 1 });
            expect(invalidateFromAutoRefreshAndAwaitMock).toHaveBeenCalledTimes(2);

            const nextTimeout = scheduledTimeouts.at(-1);
            expect(nextTimeout).toBeDefined();
            nextTimeout?.();
            await flushHookEffects({ cycles: 1, turns: 1 });

            expect(invalidateFromAutoRefreshAndAwaitMock).toHaveBeenCalledTimes(3);
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });

    it('renders the first loaded snapshot without changing hook order', async () => {
        mockSnapshot = null;

        function Wrapper(props: Readonly<{ tick: number }>) {
            return React.createElement(SessionRightPanelGitView, { sessionId: 's1', scopeId: `session:s1:${props.tick}` });
        }

        const screen = await renderScreen(React.createElement(Wrapper, { tick: 0 }));
        expect(screen.findAllByTestId('session-right-panel-git-commit-tab')).toHaveLength(0);

        mockSnapshot = createValidSnapshot();
        await act(async () => { screen.tree.update(React.createElement(Wrapper, { tick: 1 })); });

        expect(screen.findAllByTestId('session-right-panel-git-commit-tab')).toHaveLength(1);
    });

    it('keeps last-known snapshot content visible while snapshot is revalidating', async () => {

        const validSnapshot = createValidSnapshot();

        mockSnapshot = validSnapshot;
        lastScmOperationsInput = null;

        function Wrapper(props: Readonly<{ tick: number }>) {
            return React.createElement(SessionRightPanelGitView, { sessionId: 's1', scopeId: 'session:s1', onOpenFile: () => void props.tick });
        }

        const screen = await renderScreen(React.createElement(Wrapper, { tick: 0 }));

        expect(screen.findAllByTestId('session-right-panel-git-commit-tab')).toHaveLength(1);
        expect(lastScmOperationsInput?.scmSnapshot).toBe(validSnapshot);

        mockSnapshot = null;
        await act(async () => { screen.tree.update(React.createElement(Wrapper, { tick: 1 })); });

        // Should keep the commit surface mounted, rather than falling back to the empty loading state.
        expect(screen.findAllByTestId('session-right-panel-git-commit-tab')).toHaveLength(1);
        expect(lastScmOperationsInput?.scmSnapshot).toBe(validSnapshot);
    });
});
