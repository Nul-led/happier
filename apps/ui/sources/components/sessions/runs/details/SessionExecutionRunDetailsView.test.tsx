import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenTestStyle, renderScreen } from '@/dev/testkit';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { installSessionExecutionRunDetailsCommonModuleMocks } from './sessionExecutionRunDetailsTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const getRunSpy = vi.fn<(sessionId: string, request: { runId: string }, options?: { serverId?: string | null }) => Promise<any>>(async (_sessionId, _request) => ({
    run: {
        runId: 'run_1',
        callId: 'toolu_1',
        sidechainId: 'toolu_1',
        intent: 'review',
        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        runClass: 'bounded',
        ioMode: 'streaming',
        status: 'running',
        startedAtMs: 1,
    },
}));

const executionRunInfoCardSpy = vi.fn();
const messageDetailsSpy = vi.fn();
const browserContextState = vi.hoisted(() => ({ current: null as null | { marker: string } }));
const participantComposerSpy = vi.fn();
const participantComposerMountSpy = vi.hoisted(() => vi.fn());
const participantComposerUnmountSpy = vi.hoisted(() => vi.fn());
const pendingBlockSpy = vi.fn();
const chainTranscriptSpy = vi.fn();
const sidechainMessagesState = vi.hoisted(() => ({ current: [] as any[] }));
const targetPendingState = vi.hoisted(() => ({
    current: { messages: [] as any[], discarded: [] as any[], isLoaded: true },
}));
const exactSessionState = vi.hoisted(() => ({
    current: {
        id: 's1',
        active: true,
        metadata: { flavor: 'codex' },
        access: {
            level: 'edit',
            capabilities: {
                readTranscript: true,
                submitAgentInput: true,
                approveRuntimePermissions: true,
            },
        },
    } as Record<string, unknown> | null,
}));
const sessionMessagesState = vi.hoisted(() => ({
    isLoaded: true,
    messages: [
        {
            id: 'tool-msg-1',
            kind: 'tool-call',
            localId: null,
            tool: {
                id: 'toolu_1',
                name: 'SubAgentRun',
                state: 'running',
                input: {
                    runId: 'run_1',
                    backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                    intent: 'review',
                    runClass: 'bounded',
                    ioMode: 'streaming',
                    permissionMode: 'read-only',
                    retentionPolicy: 'ephemeral',
                    label: 'Reviewer A',
                },
                result: {
                    runId: 'run_1',
                    backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                    intent: 'review',
                    runClass: 'bounded',
                    ioMode: 'streaming',
                    permissionMode: 'read-only',
                    retentionPolicy: 'ephemeral',
                    status: 'succeeded',
                    sidechainId: 'toolu_1',
                    callId: 'toolu_1',
                },
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
                description: null,
            },
            children: [],
            createdAt: 1,
        },
    ] as any[],
}));

/** Exactly what the daemon projects for a live run backed by the retained Agent Session adapter. */
const RETAINED_INTERACTION = {
    kind: 'retained_agent_session.v1',
    capabilities: {
        open: ['create', 'resume'],
        delivery: ['newTurn', 'steer'],
        cancel: true,
    },
} as const;

function createExecutionRunGetResponse(overrides?: Record<string, unknown>) {
    return {
        run: {
            runId: 'run_1',
            callId: 'toolu_1',
            sidechainId: 'toolu_1',
            intent: 'review',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            runClass: 'bounded',
            ioMode: 'streaming',
            status: 'running',
            startedAtMs: 1,
            ...overrides,
        },
    };
}

installSessionExecutionRunDetailsCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key, values) => {
                if (key === 'sessionPages.newRun.transcriptReadOnly') {
                    return 'This is saved history. Reconnect to this Home to continue the conversation.';
                }
                if (key === 'sessionPages.newRun.daemonReadOnly') {
                    return 'This history comes from the agent process. Reconnect to this Home to continue the conversation.';
                }
                if (key === 'executionRuns.details.labels.statusValue' && values?.value) {
                    return `Status: ${String(values.value)}`;
                }
                return values ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})` : key;
            },
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            storage: {
                getState: () => ({ sessions: { s1: { metadata: { machineId: 'm1' } } } }),
            },
            useSession: () => ({
                id: 's1',
                active: true,
                metadata: { flavor: 'codex' },
                access: {
                    level: 'edit',
                    capabilities: {
                        readTranscript: true,
                        submitAgentInput: true,
                        approveRuntimePermissions: true,
                    },
                },
            }),
            useSessionMessages: () => ({ messages: sessionMessagesState.messages, isLoaded: sessionMessagesState.isLoaded }),
            useResolvedSessionMessageRouteId: () => 'tool-msg-1',
            useMessage: () => sessionMessagesState.messages[0] ?? null,
            useSessionPendingMessages: () => targetPendingState.current,
            useSessionSidechainMessages: () => sidechainMessagesState.current,
        });
    },
});

vi.mock('@/components/sessions/transcript/ChainTranscriptList', () => ({
    ChainTranscriptList: (props: any) => {
        chainTranscriptSpy(props);
        return React.createElement('ChainTranscriptList', props);
    },
}));

vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: () => exactSessionState.current,
    selectSessionViewShellSessionForRouteState: (
        state: { sessions?: Record<string, Record<string, unknown> | null> },
        sessionId: string,
        expectedServerId?: string | null,
    ) => {
        const session = state.sessions?.[sessionId] ?? null;
        if (!session || (expectedServerId && session.serverId !== expectedServerId)) return null;
        return session;
    },
}));

vi.mock('@/sync/ops/sessionExecutionRuns', () => ({
    sessionExecutionRunGet: (sessionId: string, request: { runId: string }, options?: { serverId?: string | null }) =>
        getRunSpy(sessionId, request, options),
    sessionExecutionRunSend: vi.fn(async () => ({ ok: true })),
    sessionExecutionRunStop: vi.fn(async () => ({ ok: true })),
    sessionExecutionRunCancelTurn: vi.fn(async () => ({ ok: true })),
    sessionExecutionRunResume: vi.fn(async () => ({ ok: true })),
    isExecutionRunNotRunningMutationError: (result: unknown) => {
        if (!result || typeof result !== 'object' || (result as any).ok !== false) return false;
        const errorCode = typeof (result as any).errorCode === 'string' ? String((result as any).errorCode).trim().toLowerCase() : '';
        if (errorCode === 'execution_run_not_allowed' || errorCode === 'execution_run_not_running') {
            const error = typeof (result as any).error === 'string' ? String((result as any).error).trim().toLowerCase() : '';
            return error.includes('not running') || error.includes('already finished');
        }
        return false;
    },
    isExecutionRunNotRunningSendError: (result: unknown) => {
        if (!result || typeof result !== 'object' || (result as any).ok !== false) return false;
        const errorCode = typeof (result as any).errorCode === 'string' ? String((result as any).errorCode).trim().toLowerCase() : '';
        if (errorCode === 'execution_run_not_allowed' || errorCode === 'execution_run_not_running') {
            const error = typeof (result as any).error === 'string' ? String((result as any).error).trim().toLowerCase() : '';
            return error.includes('not running') || error.includes('already finished');
        }
        return false;
    },
}));

vi.mock('@/sync/ops/machineExecutionRuns', () => ({
    machineExecutionRunsList: vi.fn(async () => ({ ok: true, runs: [] })),
}));

vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeBindings: () => new Map(),
    useServerCredentialAccountScopeResolution: (serverId: string | null | undefined) => serverId
        ? { kind: 'bound', scope: { serverId, accountId: 'account-1' } }
        : { kind: 'resolving' },
}));

vi.mock('@/components/sessions/runs/details/SessionExecutionRunInfoCard', () => ({
    SessionExecutionRunInfoCard: (props: any) => {
        executionRunInfoCardSpy(props);
        return React.createElement(
            'SessionExecutionRunInfoCard',
            props,
            props.stopAction ? React.createElement('Pressable', {
                testID: 'session-run-details-stop',
                accessibilityState: { disabled: props.stopAction.stopping, busy: props.stopAction.stopping },
                onPress: props.stopAction.onStop,
            }) : null,
            // Cancel response lives in the header's ⋯ menu; the stand-in exposes the same control.
            props.cancelResponseAction ? React.createElement('Pressable', {
                testID: 'session-run-details-cancel-turn',
                accessibilityState: { disabled: props.cancelResponseAction.pending, busy: props.cancelResponseAction.pending },
                onPress: props.cancelResponseAction.onCancel,
            }) : null,
        );
    },
}));

vi.mock('@/components/sessions/transcript/details/SessionMessageDetailsView', () => ({
    SessionMessageDetailsView: (props: any) => {
        messageDetailsSpy(props);
        return React.createElement('SessionMessageDetailsView', props);
    },
}));

vi.mock('@/components/sessions/participants/composer/SessionParticipantComposer', () => ({
    SessionParticipantComposer: (props: any) => {
        participantComposerSpy(props);
        // Mount identity, not render count: a destructive reload replaces the
        // loaded tree with a spinner and remounts this composer from scratch.
        React.useEffect(() => {
            participantComposerMountSpy();
            return () => participantComposerUnmountSpy();
        }, []);
        return React.createElement('SessionParticipantComposer', props);
    },
}));

vi.mock('@/components/sessions/pending/PendingMessagesTranscriptBlock', () => ({
    PendingMessagesTranscriptBlock: (props: any) => {
        pendingBlockSpy(props);
        return React.createElement('PendingMessagesTranscriptBlock', props);
    },
}));

vi.mock('@/components/sessions/browser/sessionBrowserContextRuntime', () => ({
    useSessionBrowserContextRuntimeContext: () => ({
        composerContext: { state: browserContextState.current },
    }),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: ({ ...props }: any) => React.createElement('TextInput', props),
}));

vi.mock('@/components/ui/layout/ConstrainedScreenContent', () => ({
    ConstrainedScreenContent: ({ children, ...props }: any) => React.createElement('ConstrainedScreenContent', props, children),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/sync/sync', () => ({
    sync: {
        fetchPendingMessages: vi.fn(async () => undefined),
        ensureSidechainMessagesLoaded: vi.fn(async () => 'loaded'),
        loadOlderMessages: vi.fn(async () => ({
            loaded: 1,
            hasMore: false,
            status: 'loaded',
        })),
        loadOlderSidechainMessages: vi.fn(async () => ({
            loaded: 0,
            hasMore: false,
            status: 'loaded',
        })),
    },
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>) => void promise,
}));

const machineStopSessionSpy = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock('@/sync/ops/machines', () => ({
    machineStopSession: (...args: unknown[]) => machineStopSessionSpy(...args),
}));
// The session's live agent counts are a store projection; the stop fallback only reads `counts.live`.
const liveAgentCountState = vi.hoisted(() => ({ current: 1 }));
// The roster's merged entry per Run: the canonical attention the Run header reads.
const rosterRunEntryState = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('@/hooks/session/useSessionAgentActivity', () => ({
    useSessionAgentActivity: () => ({ entries: [], counts: { live: liveAgentCountState.current, total: liveAgentCountState.current } }),
    useSessionAgentActivityRoster: () => ({
        entries: [],
        subagents: [],
        readSubagentForEntry: () => null,
        readExecutionRunEntry: (runId: string) => rosterRunEntryState.current?.runId === runId ? rosterRunEntryState.current : null,
    }),
}));

describe('SessionExecutionRunDetailsView', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    beforeEach(() => {
        getRunSpy.mockReset();
        getRunSpy.mockImplementation(async () => createExecutionRunGetResponse());
        executionRunInfoCardSpy.mockClear();
        messageDetailsSpy.mockClear();
        participantComposerSpy.mockClear();
        participantComposerMountSpy.mockClear();
        participantComposerUnmountSpy.mockClear();
        pendingBlockSpy.mockClear();
        chainTranscriptSpy.mockClear();
        sidechainMessagesState.current = [];
        targetPendingState.current = { messages: [], discarded: [], isLoaded: true };
        browserContextState.current = null;
        exactSessionState.current = {
            id: 's1',
            active: true,
            metadata: { flavor: 'codex' },
            access: {
                level: 'edit',
                capabilities: {
                    readTranscript: true,
                    submitAgentInput: true,
                    approveRuntimePermissions: true,
                },
            },
        };
        sessionMessagesState.isLoaded = true;
        sessionMessagesState.messages = [
            {
                id: 'tool-msg-1',
                kind: 'tool-call',
                localId: null,
                tool: {
                    id: 'toolu_1',
                    name: 'SubAgentRun',
                    state: 'running',
                    input: {
                        runId: 'run_1',
                        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                        intent: 'review',
                        runClass: 'bounded',
                        ioMode: 'streaming',
                        permissionMode: 'read-only',
                        retentionPolicy: 'ephemeral',
                        label: 'Reviewer A',
                    },
                    result: {
                        runId: 'run_1',
                        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                        intent: 'review',
                        runClass: 'bounded',
                        ioMode: 'streaming',
                        permissionMode: 'read-only',
                        retentionPolicy: 'ephemeral',
                        status: 'succeeded',
                        sidechainId: 'toolu_1',
                        callId: 'toolu_1',
                    },
                    createdAt: 1,
                    startedAt: 1,
                    completedAt: 2,
                    description: null,
                },
                children: [],
                createdAt: 1,
            },
        ];
    });

    afterEach(async () => {
        if (!tree) return;
        await act(async () => {
            tree?.unmount();
        });
        tree = null;
    });

    it('hands the header the Run waiting on a person, from the roster attention, so it says Needs your answer', async () => {
        rosterRunEntryState.current = {
            id: 'execution_run:run_1', kind: 'execution_run', status: 'waiting', title: 'Run', metaDetail: null,
            startedAtMs: 1, endedAtMs: null, provenance: 'merged', detailState: 'loaded', parentId: null,
            runId: 'run_1', sidechainId: null, subagentId: 'execution_run:run_1', attentionKinds: ['user_action'],
        };
        try {
            const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
            const screen = await renderScreen(<SessionExecutionRunDetailsView sessionId="s1" runId="run_1" presentation="panel" />);
            tree = screen.tree;

            expect(executionRunInfoCardSpy).toHaveBeenLastCalledWith(expect.objectContaining({
                attention: expect.objectContaining({ label: 'sessionAgentActivity.attention.userAction' }),
            }));
        } finally {
            rosterRunEntryState.current = null;
        }
    });

    it('renders transcript details alongside the execution-run info card when the run has a transcript tool route', async () => {
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(tree).toBeTruthy();
        const { SessionTranscriptSourceProvider } = await import('@/components/sessions/transcript/source/SessionTranscriptSourceContext');
        expect(screen.findAllByType(SessionTranscriptSourceProvider).map((root) => root.props.source)).toEqual([
            expect.objectContaining({ kind: 'app', sessionId: 's1' }),
        ]);
        expect(executionRunInfoCardSpy).toHaveBeenCalledWith(expect.objectContaining({
            run: expect.objectContaining({
                runId: 'run_1',
                backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            }),
        }));
        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            message: expect.objectContaining({
                id: 'tool-msg-1',
                kind: 'tool-call',
            }),
            recipientOverride: { kind: 'execution_run', runId: 'run_1' },
        }));
        expect(messageDetailsSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('presentation');
    });

    it('carries the mounted Session browser context into the tool-call Run composer host', async () => {
        browserContextState.current = { marker: 'browser-context' };
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            browserContextState: { marker: 'browser-context' },
        }));
    });

    /**
     * A run result is arbitrary JSON, so `false`, `0`, `''` and `null` are all
     * results the run really produced. Only absence means there is nothing to
     * show, and absence on this wire is `undefined` — the field is optional.
     */
    it.each([
        ['false', false],
        ['zero', 0],
        ['an empty string', ''],
        ['null', null],
    ])('shows the latest tool result when the run settled on %s', async (_label, latestToolResult) => {
        getRunSpy.mockImplementation(async () => ({
            ...createExecutionRunGetResponse(),
            latestToolResult,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(screen.findAllHostsByTestId('session-run-details-latest-tool-result')).toHaveLength(1);
    });

    /**
     * The result region is not a JSON dump. The incumbent structured projection
     * owns a recognizable payload, and the arbitrary payload a trusted plugin may
     * return stays reachable one tap away instead of being the primary content.
     */
    it('projects a recognizable tool result and keeps the raw payload subordinate', async () => {
        getRunSpy.mockImplementation(async () => ({
            ...createExecutionRunGetResponse(),
            latestToolResult: { stdout: 'built 3 targets', exitCode: 0, marker: 'plugin-private-field' },
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        // The projection renders the result's own readable content...
        expect(JSON.stringify(screen.tree.toJSON())).toContain('built 3 targets');
        // ...while the raw payload is behind its own disclosure, not above the transcript.
        expect(screen.findAllHostsByTestId('session-run-details-latest-tool-result-raw')).toHaveLength(0);
        await screen.pressByTestIdAsync('session-run-details-latest-tool-result-raw-toggle');
        expect(screen.findAllHostsByTestId('session-run-details-latest-tool-result-raw')).toHaveLength(1);
        // Nothing is removed: the plugin-private field the projection ignores is
        // still reachable in the raw payload.
        expect(JSON.stringify(screen.tree.toJSON())).toContain('plugin-private-field');
    });

    it('hides the latest tool result only when the run reported no result at all', async () => {
        getRunSpy.mockImplementation(async () => createExecutionRunGetResponse());
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(screen.findAllHostsByTestId('session-run-details-latest-tool-result')).toHaveLength(0);
    });

    it('passes explicit server scope through execution-run get and stop RPCs', async () => {
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        const stopSpy = vi.mocked(sessionExecutionRuns.sessionExecutionRunStop);
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    serverId="server-route"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(getRunSpy).toHaveBeenCalledWith('s1', { runId: 'run_1', includeStructured: true }, { serverId: 'server-route' });

        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-stop');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(stopSpy).toHaveBeenCalledWith('s1', { runId: 'run_1' }, { serverId: 'server-route' });
    });

    it('mounts exact-turn cancel and explicit resume separately from whole-Run stop', async () => {
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            lifecycle: { v: 1, state: 'current' },
            interaction: RETAINED_INTERACTION,
            inputTurns: {
                occurrenceId: 'occurrence-1',
                current: { turnId: 'turn-1', inputIds: ['input-1'], state: 'active' },
            },
        }));
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        vi.mocked(sessionExecutionRuns.sessionExecutionRunStop).mockClear();
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(screen.findByTestId('session-run-details-cancel-turn')).toBeTruthy();
        expect(screen.findByTestId('session-run-details-resume')).toBeNull();
        expect(screen.findByTestId('session-run-details-stop')).toBeTruthy();

        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-cancel-turn');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });
        expect(vi.mocked(sessionExecutionRuns.sessionExecutionRunCancelTurn)).toHaveBeenCalledWith(
            's1',
            { runId: 'run_1', occurrenceId: 'occurrence-1', turnId: 'turn-1' },
            { serverId: 'server-route' },
        );
        expect(vi.mocked(sessionExecutionRuns.sessionExecutionRunStop)).not.toHaveBeenCalled();

        expect(vi.mocked(sessionExecutionRuns.sessionExecutionRunResume)).not.toHaveBeenCalled();
        expect(vi.mocked(sessionExecutionRuns.sessionExecutionRunStop)).not.toHaveBeenCalled();
    });

    it('announces exact-turn cancellation as busy and disables only interaction controls', async () => {
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            lifecycle: { v: 1, state: 'current' },
            interaction: RETAINED_INTERACTION,
            inputTurns: {
                occurrenceId: 'occurrence-1',
                current: { turnId: 'turn-1', inputIds: ['input-1'], state: 'active' },
            },
        }));
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        type CancelTurnResult = Awaited<ReturnType<typeof sessionExecutionRuns.sessionExecutionRunCancelTurn>>;
        let resolveCancel!: (value: CancelTurnResult) => void;
        vi.mocked(sessionExecutionRuns.sessionExecutionRunCancelTurn).mockImplementationOnce(
            () => new Promise((resolve) => { resolveCancel = resolve; }),
        );
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        act(() => {
            screen.findByTestId('session-run-details-cancel-turn')?.props.onPress();
        });
        await flushHookEffects({ cycles: 2 });

        expect(screen.findByTestId('session-run-details-cancel-turn')?.props.accessibilityState)
            .toMatchObject({ disabled: true, busy: true });
        expect(screen.findByTestId('session-run-details-stop')?.props.accessibilityState)
            .toMatchObject({ disabled: false, busy: false });

        await act(async () => {
            resolveCancel({
                ok: true,
                status: 'requested',
                runId: 'run_1',
                occurrenceId: 'occurrence-1',
                turnId: 'turn-1',
            });
            await flushHookEffects({ cycles: 2 });
        });
    });

    it('offers explicit Resume for a daemon-proven recoverable Run without a live interaction', async () => {
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'succeeded',
            lifecycle: { v: 1, state: 'recoverable' },
        }));
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        vi.mocked(sessionExecutionRuns.sessionExecutionRunResume).mockClear();
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(screen.findByTestId('session-run-details-resume')).toBeTruthy();
        expect(screen.findByTestId('session-run-details-stop')).toBeNull();

        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-resume');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });
        expect(vi.mocked(sessionExecutionRuns.sessionExecutionRunResume)).toHaveBeenCalledWith(
            's1',
            { runId: 'run_1' },
            { serverId: 'server-route' },
        );
    });

    it('announces Resume as disabled and busy while its existing interaction is pending', async () => {
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'succeeded',
            lifecycle: { v: 1, state: 'recoverable' },
        }));
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        let resolveResume!: (value: { ok: true }) => void;
        vi.mocked(sessionExecutionRuns.sessionExecutionRunResume).mockImplementationOnce(
            () => new Promise((resolve) => { resolveResume = resolve; }),
        );
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        act(() => {
            screen.findByTestId('session-run-details-resume')?.props.onPress();
        });
        await flushHookEffects({ cycles: 2 });

        expect(screen.findByTestId('session-run-details-resume')?.props.accessibilityState)
            .toMatchObject({ disabled: true, busy: true });

        await act(async () => {
            resolveResume({ ok: true });
            await flushHookEffects({ cycles: 2 });
        });
    });

    it('does not offer turn cancellation without the exact current occurrence and turn witness', async () => {
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            lifecycle: { v: 1, state: 'current' },
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(screen.findByTestId('session-run-details-cancel-turn')).toBeNull();
        expect(screen.findByTestId('session-run-details-resume')).toBeNull();
        expect(screen.findByTestId('session-run-details-stop')).toBeTruthy();
    });

    it('never sends run input through the direct execution.run.send route', async () => {
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        // The plain input and its direct send are gone: the run's transcript host owns
        // the one canonical composer, which reaches canonical Session input admission.
        expect(screen.findByTestId('session-run-details-send-input')).toBeNull();
        expect(screen.findByTestId('session-run-details-send')).toBeNull();
    });

    it('offers the canonical composer only when the run projects a live retained interaction', async () => {
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            showComposer: true,
            recipientOverride: { kind: 'execution_run', runId: 'run_1' },
        }));
    });

    it('mounts the exact Run composer before a transcript tool marker arrives', async () => {
        sessionMessagesState.messages = [];
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            retryInputLocalId="first-input-1"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(messageDetailsSpy).not.toHaveBeenCalled();
        expect(participantComposerSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            serverId: 'server-route',
            canSendMessages: true,
            recipient: { kind: 'execution_run', runId: 'run_1' },
            initialLocalId: 'first-input-1',
            // The direct Run composer carries the same canonical send-mode control (queue / steer /
            // send now) as the tool-marker branch, not the silent default.
            executionRunRequestedAction: { v: 1, kind: 'enqueue' },
            extraActionChips: expect.arrayContaining([
                expect.objectContaining({ key: 'execution-run-requested-action', controlId: 'delivery' }),
            ]),
        }));
        const { sync } = await import('@/sync/sync');
        expect(sync.fetchPendingMessages).toHaveBeenCalledWith(
            's1',
            { serverId: 'server-route', accountId: 'account-1' },
            { kind: 'execution_run', runId: 'run_1' },
        );
    });

    it('shows the canonical waiting state before a Run has a transcript marker or queued rows', async () => {
        sessionMessagesState.messages = [];
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            callId: undefined,
            sidechainId: undefined,
            interaction: undefined,
            status: 'running',
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(screen.findByTestId('session-run-details-pre-marker-state')).toBeTruthy();
        expect(screen.getTextContent()).toContain('status.awaitingUpdates');
    });

    it('renders the committed direct-start Run transcript with its exact pending queue and one composer', async () => {
        sessionMessagesState.messages = [];
        sidechainMessagesState.current = [
            { id: 'sc-user', kind: 'user-text', localId: null, createdAt: 1, text: 'Start the run' },
            { id: 'sc-agent', kind: 'agent-text', localId: null, createdAt: 2, text: 'Working on it' },
        ];
        targetPendingState.current = {
            messages: [{ localId: 'queued-1', recipient: { kind: 'execution_run', runId: 'run_1' } }],
            discarded: [],
            isLoaded: true,
        };
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        tree = screen.tree;

        // No parent tool marker exists for a Run its profile never materializes,
        // so the committed rows arrive by sidechain id through the shared list.
        expect(messageDetailsSpy).not.toHaveBeenCalled();
        expect(chainTranscriptSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            serverId: 'server-route',
            messages: [
                expect.objectContaining({ id: 'sc-user' }),
                expect.objectContaining({ id: 'sc-agent' }),
            ],
            pendingMessages: targetPendingState.current.messages,
            pendingRecipient: { kind: 'execution_run', runId: 'run_1' },
        }));
        // One transcript projection owns the pending-to-committed crossover.
        expect(pendingBlockSpy).not.toHaveBeenCalled();
        expect(screen.root.findAllByType('SessionParticipantComposer' as never)).toHaveLength(1);

        await screen.update(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        expect(screen.root.findAllByType('SessionParticipantComposer' as never)).toHaveLength(1);
    });

    it('applies live Run state from the canonical activity bus without unmounting the loaded surface', async () => {
        sessionMessagesState.messages = [];
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { notifyExecutionRunActivity } = await import('@/sync/runtime/executionRuns/executionRunActivityBus');
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        tree = screen.tree;
        expect(getRunSpy).toHaveBeenCalledTimes(1);
        expect(participantComposerMountSpy).toHaveBeenCalledTimes(1);

        // Neither another Session nor another Run of this Session is this surface.
        await act(async () => {
            notifyExecutionRunActivity({ serverId: 'server-route', sessionId: 'other-session' }, { runId: 'run_1' });
            notifyExecutionRunActivity({ serverId: 'server-route', sessionId: 's1' }, { runId: 'run_other' });
            await flushHookEffects({ cycles: 1, turns: 1 });
        });
        expect(getRunSpy).toHaveBeenCalledTimes(1);

        // A still-sendable refresh must leave the mounted composer completely alone:
        // a destructive reload would unmount it and remount it from scratch.
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
            inputTurns: {
                occurrenceId: 'occurrence-1',
                current: { turnId: 'turn-1', inputIds: ['input-1'], state: 'active' },
            },
        }));
        await act(async () => {
            notifyExecutionRunActivity({ serverId: 'server-route', sessionId: 's1' }, { runId: 'run_1' });
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(getRunSpy).toHaveBeenCalledTimes(2);
        expect(executionRunInfoCardSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            run: expect.objectContaining({
                inputTurns: expect.objectContaining({ occurrenceId: 'occurrence-1' }),
            }),
        }));
        expect(participantComposerMountSpy).toHaveBeenCalledTimes(1);
        expect(participantComposerUnmountSpy).not.toHaveBeenCalled();

        // Terminal completion arrives on the same signal and updates the Run. Live
        // delivery is correctly retired with it — but the surface is never remounted,
        // which is exactly what a `status: 'loading'` reload would have done.
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'completed',
            interaction: RETAINED_INTERACTION,
        }));
        await act(async () => {
            notifyExecutionRunActivity({ serverId: 'server-route', sessionId: 's1' }, { runId: 'run_1' });
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(getRunSpy).toHaveBeenCalledTimes(3);
        expect(executionRunInfoCardSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            run: expect.objectContaining({ status: 'completed' }),
        }));
        expect(participantComposerMountSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores a Run response that resolves after a newer one', async () => {
        sessionMessagesState.messages = [];
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({ status: 'running' }));
        const { notifyExecutionRunActivity } = await import('@/sync/runtime/executionRuns/executionRunActivityBus');
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-route"
            presentation="panel"
        />);
        tree = screen.tree;

        let resolveOlder: ((value: unknown) => void) | null = null;
        const olderResponse = new Promise((resolve) => { resolveOlder = resolve as (value: unknown) => void; });
        getRunSpy.mockImplementationOnce(() => olderResponse as Promise<any>);

        await act(async () => {
            notifyExecutionRunActivity({ serverId: 'server-route', sessionId: 's1' }, { runId: 'run_1' });
            await flushHookEffects({ cycles: 1, turns: 1 });

            getRunSpy.mockResolvedValue(createExecutionRunGetResponse({ status: 'completed' }));
            notifyExecutionRunActivity({ serverId: 'server-route', sessionId: 's1' }, { runId: 'run_1' });
            await flushHookEffects({ cycles: 1, turns: 1 });

            resolveOlder?.(createExecutionRunGetResponse({ status: 'queued' }));
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(executionRunInfoCardSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            run: expect.objectContaining({ status: 'completed' }),
        }));
    });

    it('does not expose Run input from an ambient same-ID Session when the exact Home Session is unavailable', async () => {
        exactSessionState.current = null;
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            serverId="server-exact"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(getRunSpy).not.toHaveBeenCalled();
        expect(executionRunInfoCardSpy).not.toHaveBeenCalled();
        expect(messageDetailsSpy).not.toHaveBeenCalled();
        expect(participantComposerSpy).not.toHaveBeenCalled();
    });

    it('stays read-only for a running long-lived run the daemon never projected an interaction for', async () => {
        // The exact shape of a run whose live controller is gone: status and class still
        // look interactive, but no retained adapter is behind it. Inferring sendability
        // from those fields is what let a reconstructed run paint a composer.
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            showComposer: false,
        }));
    });

    it('keeps a bounded job read-only even while its turn is in flight', async () => {
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'bounded',
            status: 'running',
            turnInFlight: true,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            showComposer: false,
        }));
    });

    it('shows a finished review as its result, with no conversation composer (lab convo-R1)', async () => {
        getRunSpy.mockImplementation(async () => ({
            ...createExecutionRunGetResponse({ status: 'succeeded', finishedAtMs: 2, runClass: 'bounded' }),
            structuredMeta: {
                kind: 'review_findings.v2',
                payload: {
                    runRef: { runId: 'run_1', callId: 'toolu_1', backendId: 'codex' },
                    summary: 'Two findings, one high.',
                    overviewMarkdown: 'The retry banner can double-charge.',
                    findings: [],
                    generatedAtMs: 2,
                },
            },
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView sessionId="s1" runId="run_1" presentation="panel" />);
        tree = screen.tree;

        expect(JSON.stringify(screen.tree.toJSON())).toContain('Two findings, one high.');
        expect(screen.root.findAllByType('SessionParticipantComposer' as never)).toHaveLength(0);
        expect(messageDetailsSpy).not.toHaveBeenCalledWith(expect.objectContaining({ showComposer: true }));
    });

    it('skips the execution-run info card when embedded under the subagent details header', async () => {
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        executionRunInfoCardSpy.mockClear();
        messageDetailsSpy.mockClear();

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                    showInfoCard={false}
                />);
        tree = screen.tree;

        expect(tree).toBeTruthy();
        expect(executionRunInfoCardSpy).not.toHaveBeenCalled();
        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
        }));
        expect(messageDetailsSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('presentation');
    });

    it('withholds the composer from a body-only host that owns its own composition', async () => {
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'running',
            interaction: RETAINED_INTERACTION,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                    showSendComposer={false}
                />);
        tree = screen.tree;

        expect(tree).toBeTruthy();
        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            showComposer: false,
        }));
    });

    it('reloads and hides the stop control when stopping races with a terminal run', async () => {
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        const stopSpy = vi.mocked(sessionExecutionRuns.sessionExecutionRunStop);
        stopSpy.mockResolvedValueOnce({
            ok: false,
            error: 'Not running',
            errorCode: 'execution_run_not_allowed',
        });
        getRunSpy
            .mockResolvedValueOnce(createExecutionRunGetResponse({ status: 'running' }))
            .mockResolvedValueOnce(createExecutionRunGetResponse({
                status: 'failed',
                finishedAtMs: 2,
                error: { code: 'execution_run_failed', message: 'startup timeout' },
            }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(screen.findByTestId('session-run-details-stop')).toBeTruthy();

        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-stop');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(stopSpy).toHaveBeenCalledWith('s1', expect.objectContaining({ runId: 'run_1' }));
        await vi.waitFor(() => {
            expect(screen.findByTestId('session-run-details-stop')).toBeNull();
        });
        expect(executionRunInfoCardSpy.mock.calls.at(-1)?.[0]?.run).toEqual(expect.objectContaining({
            runId: 'run_1',
            status: 'failed',
        }));
    });

    it('announces whole-Run Stop as disabled and busy while stopping', async () => {
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        let resolveStop!: (value: { ok: true }) => void;
        vi.mocked(sessionExecutionRuns.sessionExecutionRunStop).mockImplementationOnce(
            () => new Promise((resolve) => { resolveStop = resolve; }),
        );
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        act(() => {
            screen.findByTestId('session-run-details-stop')?.props.onPress();
        });
        await flushHookEffects({ cycles: 2 });

        expect(screen.findByTestId('session-run-details-stop')?.props.accessibilityState)
            .toMatchObject({ disabled: true, busy: true });

        await act(async () => {
            resolveStop({ ok: true });
            await flushHookEffects({ cycles: 2 });
        });
    });

    it('falls back to the persisted transcript when execution.run.get no longer finds the run', async () => {
        getRunSpy.mockResolvedValueOnce({
            ok: false,
            error: 'Not found',
            errorCode: 'execution_run_not_found',
        });
        sessionMessagesState.messages = [
            {
                ...sessionMessagesState.messages[0],
                tool: {
                    ...sessionMessagesState.messages[0]!.tool,
                    state: 'completed',
                    result: {
                        ...sessionMessagesState.messages[0]!.tool.result,
                        status: 'succeeded',
                        permissionMode: 'read-only',
                    },
                },
            },
        ];
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(tree).toBeTruthy();
        expect(executionRunInfoCardSpy).toHaveBeenCalledWith(expect.objectContaining({
            run: expect.objectContaining({
                runId: 'run_1',
                backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                status: 'succeeded',
                permissionMode: 'read-only',
            }),
        }));
        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            message: expect.objectContaining({
                id: 'tool-msg-1',
                kind: 'tool-call',
            }),
        }));
        expect(messageDetailsSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('presentation');
    });

    it('hides the transcript composer when the run is no longer sendable', async () => {
        getRunSpy.mockResolvedValueOnce(createExecutionRunGetResponse({
            status: 'succeeded',
            turnInFlight: false,
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            showComposer: false,
        }));
        expect(messageDetailsSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('presentation');
    });

    it('loads main transcript messages before failing closed on execution.run.get not-found responses', async () => {
        getRunSpy.mockResolvedValueOnce({
            ok: false,
            error: 'Not found',
            errorCode: 'execution_run_not_found',
        });
        sessionMessagesState.isLoaded = false;
        sessionMessagesState.messages = [];
        const { sync } = await import('@/sync/sync');
        const loadOlderMessagesSpy = vi.mocked(sync.loadOlderMessages);
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(loadOlderMessagesSpy).toHaveBeenCalledWith('s1');
        expect(screen.findByTestId('session-run-details-load-error-action')).toBeTruthy();
    });

    it('does not query daemon execution-run markers without an exact Home', async () => {
        getRunSpy.mockResolvedValueOnce({
            ok: false,
            error: 'RPC method not available',
            errorCode: 'RPC_METHOD_NOT_AVAILABLE',
        });
        const machineExecutionRuns = await import('@/sync/ops/machineExecutionRuns');
        vi.mocked(machineExecutionRuns.machineExecutionRunsList).mockResolvedValueOnce({
            ok: true,
            runs: [{
                happyHomeDir: '/tmp/happier',
                pid: 123,
                happySessionId: 's1',
                runId: 'run_1',
                callId: 'toolu_1',
                sidechainId: 'toolu_1',
                intent: 'review',
                backendTarget: { kind: 'backend', backendId: 'codex' },
                runClass: 'bounded',
                ioMode: 'streaming',
                retentionPolicy: 'ephemeral',
                status: 'running',
                startedAtMs: 1,
                updatedAtMs: 2,
            }],
        });
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(executionRunInfoCardSpy).toHaveBeenCalledWith(expect.objectContaining({
            run: expect.objectContaining({
                runId: 'run_1',
                backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                status: 'running',
            }),
        }));
        expect(messageDetailsSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 's1',
            message: expect.objectContaining({
                id: 'tool-msg-1',
                kind: 'tool-call',
            }),
        }));
        expect(messageDetailsSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('presentation');
        expect(screen.findByTestId('session-run-details-send-input')).toBeNull();
        expect(vi.mocked(machineExecutionRuns.machineExecutionRunsList)).not.toHaveBeenCalled();
    });

    it('does not expose mutable run controls when only transcript fallback state is available', async () => {
        getRunSpy.mockResolvedValueOnce({
            ok: false,
            error: 'RPC method not available',
            errorCode: 'RPC_METHOD_NOT_AVAILABLE',
        });
        sessionMessagesState.messages = [
            {
                ...sessionMessagesState.messages[0],
                tool: {
                    ...sessionMessagesState.messages[0]!.tool,
                    state: 'running',
                    result: {
                        ...sessionMessagesState.messages[0]!.tool.result,
                        status: 'running',
                        permissionMode: 'read-only',
                    },
                },
            },
        ];
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    presentation="panel"
                />);
        tree = screen.tree;

        expect(tree).toBeTruthy();
        expect(screen.findByTestId('session-run-details-send-input')).toBeNull();
        expect(screen.findByTestId('session-run-details-cancel-turn')).toBeNull();
        expect(screen.findByTestId('session-run-details-resume')).toBeNull();
        expect(screen.findByTestId('session-run-details-stop')).toBeNull();
        expect(screen.findByTestId('session-run-details-read-only-reason')?.props.children)
            .toBe('This is saved history. Reconnect to this Home to continue the conversation.');
    });

    it('announces one semantic Run-status change without re-speaking an unchanged refresh', async () => {
        getRunSpy
            .mockResolvedValueOnce(createExecutionRunGetResponse({ status: 'running' }))
            .mockResolvedValueOnce(createExecutionRunGetResponse({ status: 'succeeded', finishedAtMs: 2 }))
            .mockResolvedValueOnce(createExecutionRunGetResponse({ status: 'succeeded', finishedAtMs: 2 }));
        const { notifyExecutionRunActivity } = await import('@/sync/runtime/executionRuns/executionRunActivityBus');
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView sessionId="s1" serverId="server-a" runId="run_1" presentation="panel" />);
        tree = screen.tree;

        await act(async () => {
            notifyExecutionRunActivity({ serverId: 'server-a', sessionId: 's1' }, { runId: 'run_1' });
            await flushHookEffects({ cycles: 2 });
        });
        const first = screen.findByTestId('session-run-details-accessibility-status');
        expect(first?.props.children.props.children).toContain('succeeded');
        const firstAnnouncementNode = first?.props.children;

        await act(async () => {
            notifyExecutionRunActivity({ serverId: 'server-a', sessionId: 's1' }, { runId: 'run_1' });
            await flushHookEffects({ cycles: 2 });
        });
        expect(screen.findByTestId('session-run-details-accessibility-status')?.props.children).toBe(firstAnnouncementNode);
    });


    /**
     * Only the phone route wraps this view with a header Refresh bound to its
     * `reload` handle. The desktop Details workspace and the subagent panel host
     * it without any header, so a failed first load used to be a dead end that
     * could only be escaped by closing and reopening the Run.
     */
    it('recovers a failed load in place through the view-owned loader', async () => {
        getRunSpy.mockReset();
        getRunSpy
            .mockResolvedValueOnce({ ok: false, error: 'Home unreachable', errorCode: 'unavailable' })
            .mockResolvedValue(createExecutionRunGetResponse());
        sessionMessagesState.messages = [];
        executionRunInfoCardSpy.mockClear();
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');

        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        // Pane-states lab 0 "X": what failed in words and one recovery; the raw failure is a
        // diagnostic behind the collapsed Details, never the headline.
        expect(screen.findByTestId('session-run-details-load-error')).toBeTruthy();
        expect(screen.getTextContent()).not.toContain('Home unreachable');
        expect(screen.findByTestId('session-run-details-load-error-diagnostic-Home unreachable')).toBeTruthy();
        expect(executionRunInfoCardSpy).not.toHaveBeenCalled();

        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-load-error-action');
            await flushHookEffects({ cycles: 2, turns: 1 });
        });

        expect(getRunSpy).toHaveBeenCalledTimes(2);
        expect(screen.findByTestId('session-run-details-load-error')).toBeNull();
        expect(executionRunInfoCardSpy).toHaveBeenCalledWith(expect.objectContaining({
            run: expect.objectContaining({ runId: 'run_1' }),
        }));
    });

    it('keeps the inline recovery action out of the way once the Run loads', async () => {
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        expect(screen.findByTestId('session-run-details-load-error')).toBeNull();
    });

    it('gives every actionable Run control the shared platform interactive target', async () => {
        // The view's own control (Resume); Stop, Cancel response and ⋯ belong to the header owner
        // and its menu rows, which carry their own target policy.
        getRunSpy.mockResolvedValue(createExecutionRunGetResponse({
            runClass: 'long_lived',
            retentionPolicy: 'resumable',
            status: 'succeeded',
            lifecycle: { v: 1, state: 'recoverable' },
        }));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        // `react-native` is mocked by a shared helper at runtime, so this file's
        // static import would bind the unmocked stub. Read the mocked module.
        const { Platform } = await import('react-native');
        const originalPlatform = Platform.OS;

        try {
            for (const platform of ['android', 'ios', 'web'] as const) {
                Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
                const screen = await renderScreen(<SessionExecutionRunDetailsView
                    sessionId="s1"
                    runId="run_1"
                    serverId="server-route"
                    presentation="panel"
                />);
                const targetSize = resolveMinimumInteractiveTargetSize(platform);

                for (const testID of [
                    'session-run-details-resume',
                ]) {
                    const target = screen.findByTestId(testID);
                    expect(target, testID).not.toBeNull();
                    const style = flattenTestStyle(target?.props.style);
                    expect(style.minWidth, testID).toBe(targetSize);
                    expect(style.minHeight, testID).toBe(targetSize);
                }

                await screen.unmount();
            }
        } finally {
            Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
        }
    });


    it('names the wait while it opens, and where it is reading from', async () => {
        getRunSpy.mockReset();
        getRunSpy.mockImplementation(() => new Promise(() => undefined));
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
            openingTitle="Review the settings modal fix"
        />);
        tree = screen.tree;

        const text = screen.getTextContent();
        expect(screen.findByTestId('session-run-details-loading')).toBeTruthy();
        expect(text).toContain('surfaceState.opening(name=Review the settings modal fix)');
        expect(text).toContain('runPage.opening.reading(machine=runPage.thisMachine)');
    });

    it('says the run is gone, with a way out, instead of spinning when neither its host nor the transcript has it', async () => {
        getRunSpy.mockReset();
        getRunSpy.mockResolvedValue({ ok: false, error: 'Run not found', errorCode: 'execution_run_not_found' });
        sessionMessagesState.messages = [];
        const onRequestClose = vi.fn();
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
            onRequestClose={onRequestClose}
        />);
        tree = screen.tree;

        await vi.waitFor(() => {
            expect(screen.findByTestId('session-run-details-gone')).toBeTruthy();
        });
        expect(screen.findByTestId('session-run-details-loading')).toBeNull();
        expect(screen.findByTestId('session-run-details-load-error')).toBeNull();
        expect(screen.getTextContent()).toContain('runPage.gone.title(machine=runPage.thisMachine)');
        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-gone-action');
        });
        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('says what stopping the whole session would also stop when the run does not confirm its stop', async () => {
        const sessionExecutionRuns = await import('@/sync/ops/sessionExecutionRuns');
        const stopSpy = vi.mocked(sessionExecutionRuns.sessionExecutionRunStop);
        stopSpy.mockResolvedValueOnce({ ok: false, error: 'timed out', errorCode: 'rpc_timeout' } as any);
        machineStopSessionSpy.mockClear();
        liveAgentCountState.current = 4;
        exactSessionState.current = { ...exactSessionState.current!, metadata: { flavor: 'codex', machineId: 'm1' } };
        const { Modal } = await import('@/modal');
        vi.mocked(Modal.confirm).mockResolvedValueOnce(true);
        const { SessionExecutionRunDetailsView } = await import('./SessionExecutionRunDetailsView');
        const screen = await renderScreen(<SessionExecutionRunDetailsView
            sessionId="s1"
            runId="run_1"
            presentation="panel"
        />);
        tree = screen.tree;

        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-stop');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });
        await vi.waitFor(() => {
            expect(screen.findByTestId('session-run-details-stop-failed')).toBeTruthy();
        });
        // The consequence is said before it happens: this run plus 3 others.
        expect(screen.getTextContent()).toContain('count=3');
        await act(async () => {
            await screen.pressByTestIdAsync('session-run-details-stop-failed-secondary-action');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });
        expect(machineStopSessionSpy).toHaveBeenCalledWith('m1', 's1', expect.anything());
        liveAgentCountState.current = 1;
    });

});
