import * as React from 'react';
import { Platform } from 'react-native';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import type { ParticipantComposerPreparedSubmission } from '@/components/sessions/participants/composer/SessionParticipantComposer';
import { SessionInteractiveExecutionRunDraftView } from './SessionInteractiveExecutionRunDraftView';
import { t } from '@/text';

const composerPropsSpy = vi.hoisted(() => vi.fn());
const startSpy = vi.hoisted(() => vi.fn());
const listSpy = vi.hoisted(() => vi.fn());
const submitSpy = vi.hoisted(() => vi.fn());
const writeDraftSpy = vi.hoisted(() => vi.fn());
const clearAcceptedSpy = vi.hoisted(() => vi.fn());
const randomUUIDSpy = vi.hoisted(() => vi.fn());
const ensureActiveSpy = vi.hoisted(() => vi.fn());
const secretOverlayFieldPropsSpy = vi.hoisted(() => vi.fn());
const executionRunProtocolCheckSpy = vi.hoisted(() => vi.fn());
const secretOverlayTestState = vi.hoisted(() => ({
    unavailable: false,
    overlay: null as null | Readonly<{
        v: 1;
        bindings: Readonly<Record<string, Readonly<{ ref: string; revision?: number }>>>;
    }>,
}));
const exactSessionState = vi.hoisted(() => ({
    current: { id: 'session_1', active: true, metadata: { flavor: 'claude' } } as Record<string, unknown> | null,
}));
const launcherCapabilityState = vi.hoisted(() => ({
    enabledAgentIds: ['claude', 'codex'],
    executionRunsBackends: {
        claude: { available: true, intents: ['delegate'] },
        codex: { available: true, intents: ['delegate'] },
    } as Record<string, { available: boolean; intents: string[] }>,
    mergedBackendProjectionById: {} as Record<string, {
        backendId: string;
        agentId: string;
        title: string;
        subtitle: string;
        catalogAgentId: string | null;
        iconAgentId: string | null;
    }>,
    mergedProviderProjectionById: {} as Record<string, {
        agentId: string;
        qualifiedId: string;
        identity: { pluginId: string; localId: string };
        title: string;
        subtitle: string;
        channel: 'plugin';
        isBuiltIn: false;
        catalogAgentId: null;
        iconAgentId: null;
    }>,
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('@/components/sessions/participants/composer/SessionParticipantComposer', () => ({
    SessionParticipantComposer: (props: unknown) => {
        composerPropsSpy(props);
        return React.createElement('SessionParticipantComposer', props as object);
    },
}));

vi.mock('@/components/sessions/browser/sessionBrowserContextRuntime', () => ({
    useSessionBrowserContextRuntimeContext: () => ({ composerContext: { state: { selected: [] } } }),
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({ useEnabledAgentIds: () => launcherCapabilityState.enabledAgentIds }));
vi.mock('@/agents/catalog/enabled', () => ({ getEnabledAgentIds: () => launcherCapabilityState.enabledAgentIds }));
vi.mock('@/agents/hooks/useResumeCapabilityOptions', () => ({ useResumeCapabilityOptions: () => ({ resumeCapabilityOptions: {} }) }));
vi.mock('@/components/sessions/model/useSessionMachineReachability', () => ({ useSessionMachineReachability: () => ({ machineReachable: true }) }));
vi.mock('@/components/sessions/model/useSessionMachineTarget', () => ({ useSessionMachineTarget: () => ({ machineId: 'machine_1', basePath: '/repo' }) }));
vi.mock('@/sync/domains/state/storage', () => ({
    useSession: () => ({ id: 'session_1', active: true, metadata: { flavor: 'claude' } }),
    useSettings: () => ({ acpCatalogSettingsV1: { v: 2, backends: [] } }),
}));
vi.mock('@/sync/store/settingsWriters', () => ({
    useAccountSettingsScope: () => ({ serverId: 'server_1', accountId: 'account_1' }),
}));
vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: () => exactSessionState.current,
}));
vi.mock('@/sync/domains/session/resolveSessionActionDefaultBackend', () => ({
    resolveSessionActionDefaultBackend: () => ({
        agentTarget: {
            kind: 'agent',
            identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
        },
        backendTarget: null,
        defaultAgentId: 'claude',
        defaultBackendId: 'claude',
        displayAgentType: 'claude',
    }),
    resolveSessionActionDefaultTarget: () => ({
        kind: 'agent',
        identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
    }),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession', () => ({
    usePreferredServerIdForSession: () => 'server_1',
}));
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeBindings: () => new Map([['server_1', {
        serverId: 'server_1',
        accountId: 'account_1',
        scope: { serverId: 'server_1', accountId: 'account_1' },
        isCurrent: () => true,
    }]]),
}));
vi.mock('@/sync/ops/sessionExecutionRuns', () => ({
    sessionExecutionRunStart: (...args: unknown[]) => startSpy(...args),
    sessionExecutionRunList: (...args: unknown[]) => listSpy(...args),
}));
vi.mock('@/sync/ops/actions/executionRunActionDeps', () => ({
    createUiExecutionRunActionDeps: () => ({
        executionRunCheckProtocolV2: (...args: unknown[]) => executionRunProtocolCheckSpy(...args),
    }),
}));
vi.mock('@/hooks/session/useSessionExecutionRunLaunchability', () => ({
    useSessionExecutionRunLaunchability: () => ({
        canLaunchExecutionRuns: true,
        canShowExecutionRunLauncher: true,
        executionRunsBackends: launcherCapabilityState.executionRunsBackends,
        executionRunsSupported: true,
        sessionServerId: 'server_1',
    }),
}));
vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
    useMachineCapabilitiesCache: () => ({ state: { status: 'idle' } }),
}));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => false }));
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({
        phase: 'ready',
        inputs: {
            mergedBackendProjectionById: launcherCapabilityState.mergedBackendProjectionById,
            mergedProviderProjectionById: launcherCapabilityState.mergedProviderProjectionById,
        },
    }),
}));
vi.mock('@/sync/ops/sessionDrafts/sessionDraftRepository', () => ({
    writeExistingSessionDraft: (...args: unknown[]) => writeDraftSpy(...args),
}));
vi.mock('@/components/sessions/composer/repositoryComposerDocumentOwner', () => ({
    createRepositoryComposerDocumentOwner: () => ({
        captureCurrentness: () => ({ revision: 1 }),
        clearAccepted: (...args: unknown[]) => clearAcceptedSpy(...args),
    }),
}));
vi.mock('@/platform/randomUUID', () => ({ randomUUID: () => randomUUIDSpy() }));
vi.mock('@/sync/sync', () => ({ sync: { submitMessage: (...args: unknown[]) => submitSpy(...args) } }));
vi.mock('./ensureExecutionRunHostSessionActive', () => ({
    ensureExecutionRunHostSessionActive: (...args: unknown[]) => ensureActiveSpy(...args),
}));
vi.mock('./ExecutionRunSecretReferenceOverlayField', () => ({
    ExecutionRunSecretReferenceOverlayField: (props: Record<string, unknown>) => {
        secretOverlayFieldPropsSpy(props);
        React.useEffect(() => {
            const overlay = secretOverlayTestState.overlay;
            (props.onChange as (value: unknown) => void)(secretOverlayTestState.unavailable
                ? { readiness: { ok: false, reason: 'saved_secret_selection_unavailable' } }
                : overlay
                ? { readiness: { ok: true, secretReferenceOverlay: overlay }, overlay }
                : { readiness: { ok: true } });
        }, [props.onChange]);
        return React.createElement('ExecutionRunSecretReferenceOverlayField', props);
    },
    resolveExecutionRunSessionLaunchProfile: () => null,
}));

function preparedSubmission(): ParticipantComposerPreparedSubmission {
    return {
        text: 'Inspect this',
        displayText: 'Inspect this',
        metaOverrides: { source: 'browser' },
        draft: { text: 'Inspect this', mentions: [], attachments: [] },
        onOutboundHandoff: vi.fn(),
    };
}

describe('SessionInteractiveExecutionRunDraftView', () => {
    beforeEach(() => {
        composerPropsSpy.mockClear();
        startSpy.mockReset();
        listSpy.mockReset();
        submitSpy.mockReset();
        writeDraftSpy.mockClear();
        clearAcceptedSpy.mockClear();
        ensureActiveSpy.mockReset();
        secretOverlayFieldPropsSpy.mockClear();
        secretOverlayTestState.overlay = null;
        secretOverlayTestState.unavailable = false;
        executionRunProtocolCheckSpy.mockReset();
        executionRunProtocolCheckSpy.mockResolvedValue({ ok: true, exactMachineId: 'machine_1' });
        ensureActiveSpy.mockResolvedValue({ ok: true });
        randomUUIDSpy.mockReset();
        randomUUIDSpy.mockReturnValueOnce('correlation_1').mockReturnValueOnce('input_1');
        submitSpy.mockResolvedValue({ localId: 'input_1' });
        exactSessionState.current = { id: 'session_1', active: true, metadata: { flavor: 'claude' } };
        launcherCapabilityState.enabledAgentIds = ['claude', 'codex'];
        launcherCapabilityState.executionRunsBackends = {
            claude: { available: true, intents: ['delegate'] },
            codex: { available: true, intents: ['delegate'] },
        };
        launcherCapabilityState.mergedBackendProjectionById = {};
        launcherCapabilityState.mergedProviderProjectionById = {};
    });

    afterEach(() => standardCleanup());

    it('creates nothing until first Send, then admits the captured input to the exact new Run with one stable identity', async () => {
        startSpy.mockResolvedValue({ runId: 'run_1' });
        const onRunStarted = vi.fn();
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={onRunStarted} />);

        expect(startSpy).not.toHaveBeenCalled();
        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as { submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void> };
        expect(composerPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            serverId: 'server_1',
            initialLocalId: 'input_1',
            draftOccurrenceId: 'input_1',
        }));
        await act(async () => {
            await props.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledWith('session_1', expect.objectContaining({
            intent: 'delegate',
            runClass: 'long_lived',
            launchOrigin: expect.objectContaining({ draftCorrelationId: 'correlation_1' }),
        }), { serverId: 'server_1', expectedMachineId: 'machine_1' });
        expect(onRunStarted).toHaveBeenCalledWith('run_1');
        expect(writeDraftSpy).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run_1', patch: expect.objectContaining({ text: 'Inspect this' }) }));
        expect(submitSpy).toHaveBeenCalledWith(
            'session_1',
            'Inspect this',
            'Inspect this',
            { source: 'browser' },
            expect.objectContaining({
                serverId: 'server_1',
                recipient: { kind: 'execution_run', runId: 'run_1' },
                localId: 'input_1',
            }),
        );
    });

    it('preflights and forwards a selected value-free overlay, and creates no Run when the exact daemon lacks support', async () => {
        secretOverlayTestState.overlay = {
            v: 1,
            bindings: {
                OPENAI_API_KEY: { ref: 'happier:shared-secret:v1:shared-1', revision: 7 },
            },
        };
        executionRunProtocolCheckSpy.mockResolvedValue({
            ok: false,
            errorCode: 'execution_run_protocol_unsupported',
            error: 'execution_run_protocol_unsupported',
        });
        const screen = await renderScreen(
            <SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />,
        );
        await flushHookEffects({ cycles: 3 });
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };

        await act(async () => {
            await expect(composer.submitPreparedMessage(preparedSubmission()))
                .rejects.toThrow('execution_run_secret_reference_overlay_update_required');
        });

        expect(executionRunProtocolCheckSpy).toHaveBeenCalledWith(
            'session_1',
            {
                detachedScope: false,
                startAndWait: false,
                exactInputResults: false,
                runScopedAgentBindings: false,
                secretReferenceOverlay: true,
            },
            { serverId: 'server_1', targetMachineId: 'machine_1' },
        );
        expect(startSpy).not.toHaveBeenCalled();
        // The presentation boundary resolves the code to copy; the raw snake_case code is never shown.
        expect(screen.tree.root.findAll((node) => (
            String(node.type) === 'Text'
            && node.children.includes('execution_run_secret_reference_overlay_update_required')
        ))).toHaveLength(0);
        expect(screen.findByTestId('execution-run-conversation-error')?.props.children)
            .toBe(t('sessionDrafts.executionRunStart.secretReferenceOverlayUpdateRequired'));
    });

    it('passes the reviewed overlay into the incumbent rowless Run start after exact-target acceptance', async () => {
        secretOverlayTestState.overlay = {
            v: 1,
            bindings: {
                OPENAI_API_KEY: { ref: 'happier:shared-secret:v1:shared-1', revision: 7 },
            },
        };
        startSpy.mockResolvedValue({ runId: 'run_overlay' });
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />);
        await flushHookEffects({ cycles: 3 });
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };

        await act(async () => {
            await composer.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledWith('session_1', expect.objectContaining({
            secretReferenceOverlay: secretOverlayTestState.overlay,
        }), { serverId: 'server_1', expectedMachineId: 'machine_1' });
    });


    it('creates no rowless Run when a retained Saved Secret selection becomes stale or feature-unavailable', async () => {
        secretOverlayTestState.unavailable = true;
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />);
        await flushHookEffects({ cycles: 3 });
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            canSendMessages: boolean;
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };

        expect(composer.canSendMessages).toBe(false);
        await expect(composer.submitPreparedMessage(preparedSubmission())).rejects.toThrow();
        expect(executionRunProtocolCheckSpy).not.toHaveBeenCalled();
        expect(startSpy).not.toHaveBeenCalled();
    });

    it('clears the accepted Run draft before navigation can retire its exact Account binding', async () => {
        startSpy.mockResolvedValue({ runId: 'run_1' });
        submitSpy.mockImplementation(async (...args: unknown[]) => {
            const options = args[4] as { onOutboundHandoff?: () => void };
            options.onOutboundHandoff?.();
            return { localId: 'input_1' };
        });
        const clearCountAtNavigation: number[] = [];
        const onRunStarted = vi.fn(() => clearCountAtNavigation.push(clearAcceptedSpy.mock.calls.length));
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={onRunStarted} />);

        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };
        await act(async () => {
            await composer.submitPreparedMessage(preparedSubmission());
        });

        expect(clearAcceptedSpy).toHaveBeenCalledTimes(1);
        expect(clearCountAtNavigation).toEqual([1]);
    });

    it('starts the first message with the one eligible Agent selected in the shared launcher options', async () => {
        startSpy.mockResolvedValue({ runId: 'run_codex' });
        const screen = await renderScreen(
            <SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />,
        );

        await screen.pressByTestIdAsync('execution-run-launcher-target:agent:codex');
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };
        await act(async () => {
            await composer.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledWith('session_1', expect.objectContaining({
            backendTarget: {
                kind: 'agent',
                identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
            },
            permissionMode: expect.any(String),
            retentionPolicy: 'resumable',
            runClass: 'long_lived',
            ioMode: 'streaming',
        }), { serverId: 'server_1', expectedMachineId: 'machine_1' });
        expect(submitSpy).toHaveBeenCalledWith(
            'session_1',
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ recipient: { kind: 'execution_run', runId: 'run_codex' } }),
        );
    });

    it('does not let an unavailable default Agent hide another eligible built-in or installed-plugin Agent', async () => {
        launcherCapabilityState.executionRunsBackends = {
            claude: { available: false, intents: ['delegate'] },
            'acme.external/worker': { available: true, intents: ['delegate'] },
        };
        launcherCapabilityState.enabledAgentIds = ['claude', 'acme.external/worker'];
        launcherCapabilityState.mergedBackendProjectionById = {
            'acme.external/worker': {
                backendId: 'acme.external/worker',
                agentId: 'acme.external/worker',
                title: 'External Worker',
                subtitle: 'acme.external/worker',
                catalogAgentId: null,
                iconAgentId: null,
            },
        };
        launcherCapabilityState.mergedProviderProjectionById = {
            'acme.external/worker': {
                agentId: 'acme.external/worker',
                qualifiedId: 'acme.external/worker',
                identity: { pluginId: 'acme.external', localId: 'worker' },
                title: 'External Worker',
                subtitle: 'acme.external/worker',
                channel: 'plugin',
                isBuiltIn: false,
                catalogAgentId: null,
                iconAgentId: null,
            },
        };
        startSpy.mockResolvedValue({ runId: 'run_external' });

        await renderScreen(
            <SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />,
        );
        await flushHookEffects();
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            canSendMessages: boolean;
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };
        expect(composer.canSendMessages).toBe(true);
        await act(async () => {
            await composer.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledWith('session_1', expect.objectContaining({
            backendTarget: {
                kind: 'agent',
                identity: { pluginId: 'acme.external', localId: 'worker' },
            },
        }), { serverId: 'server_1', expectedMachineId: 'machine_1' });
    });

    it('re-joins exactly one correlated Run after an outcome-unknown start and never starts another automatically', async () => {
        startSpy.mockResolvedValue({ ok: false, error: 'unknown', details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } } });
        listSpy.mockResolvedValue({ runs: [{ runId: 'run_rejoined', launchOrigin: { kind: 'session', sessionId: 'session_1', draftCorrelationId: 'correlation_1' } }] });
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />);

        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as { submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void> };
        await act(async () => {
            await props.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledWith(
            'session_1', expect.anything(), expect.anything(), expect.anything(),
            expect.objectContaining({ recipient: { kind: 'execution_run', runId: 'run_rejoined' }, localId: 'input_1' }),
        );
    });

    it('does not guess when correlation has zero matches and leaves the composer draft unaccepted', async () => {
        startSpy.mockResolvedValue({ ok: false, error: 'unknown', details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } } });
        listSpy.mockResolvedValue({ runs: [] });
        const submission = preparedSubmission();
        const screen = await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />);

        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as { submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void> };
        await act(async () => {
            await expect(props.submitPreparedMessage(submission)).rejects.toThrow();
        });

        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy).not.toHaveBeenCalled();
        expect(submission.onOutboundHandoff).not.toHaveBeenCalled();
        const startAnother = screen.findByTestId('execution-run-conversation-start-another');
        expect(startAnother?.props).toEqual(expect.objectContaining({
            accessibilityRole: 'button',
            accessibilityLabel: 'Start another',
        }));
        // The shared platform policy owns this number; asserting a literal here is
        // how a Run-local 44 survived next to it and under-sized Android.
        const recoveryTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
        expect(flattenTestStyle(startAnother?.props.style)).toEqual(expect.objectContaining({
            minWidth: recoveryTargetSize,
            minHeight: recoveryTargetSize,
        }));
        // An unknown outcome is not a failure: the copy must say the outcome is unknown and warn that
        // starting another may create a second conversation, never "Request failed.".
        expect(screen.findByTestId('execution-run-conversation-error')?.props.children)
            .toBe(t('sessionDrafts.executionRunStart.unresolved'));
        expect(screen.tree.root.findAll((node) => (
            String(node.type) === 'Text' && node.children.includes(t('common.requestFailed'))
        ))).toHaveLength(0);
    });

    it('says it is checking whether the conversation started and offers no second Start while reconciling', async () => {
        startSpy.mockResolvedValue({ ok: false, error: 'unknown', details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } } });
        let resolveList: (value: unknown) => void = () => undefined;
        listSpy.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
        const screen = await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />);

        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as { submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void> };
        let submission: Promise<void> = Promise.resolve();
        await act(async () => {
            submission = props.submitPreparedMessage(preparedSubmission());
            submission.catch(() => undefined);
            await flushHookEffects({ cycles: 2 });
        });

        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('execution-run-conversation-phase')?.props.children)
            .toBe(t('sessionDrafts.executionRunStart.reconciling'));
        expect(screen.findByTestId('execution-run-conversation-start-another')).toBeNull();

        await act(async () => {
            resolveList({ runs: [] });
            await expect(submission).rejects.toThrow();
        });
        expect(screen.findByTestId('execution-run-conversation-error')?.props.children)
            .toBe(t('sessionDrafts.executionRunStart.unresolved'));
        expect(screen.findByTestId('execution-run-conversation-start-another')).not.toBeNull();
    });

    it('uses a fresh start correlation and input identity only after explicit unresolved-start recovery', async () => {
        randomUUIDSpy.mockReset();
        randomUUIDSpy
            .mockReturnValueOnce('correlation_1')
            .mockReturnValueOnce('input_1')
            .mockReturnValueOnce('correlation_2')
            .mockReturnValueOnce('input_2');
        startSpy
            .mockResolvedValueOnce({ ok: false, error: 'unknown', details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } } })
            .mockResolvedValueOnce({ runId: 'run_2' });
        listSpy.mockResolvedValue({ runs: [] });
        const screen = await renderScreen(
            <SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />,
        );
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };

        await act(async () => {
            await expect(composer.submitPreparedMessage(preparedSubmission())).rejects.toThrow();
        });
        expect(startSpy).toHaveBeenCalledTimes(1);

        await screen.pressByTestIdAsync('execution-run-conversation-start-another');
        const recoveredComposer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };
        await act(async () => {
            await recoveredComposer.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledTimes(2);
        expect(startSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            launchOrigin: expect.objectContaining({ draftCorrelationId: 'correlation_1' }),
        }));
        expect(startSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            launchOrigin: expect.objectContaining({ draftCorrelationId: 'correlation_2' }),
        }));
        expect(submitSpy).toHaveBeenCalledWith(
            'session_1', expect.anything(), expect.anything(), expect.anything(),
            expect.objectContaining({ localId: 'input_2' }),
        );
    });

    it('preserves the selected Agent and stable draft correlation across a deliberate no-run retry', async () => {
        startSpy
            .mockResolvedValueOnce({ ok: false, error: 'not started', details: { executionRunStart: { v: 1, runCreation: 'noRunCreated' } } })
            .mockResolvedValueOnce({ runId: 'run_codex_retry' });
        const screen = await renderScreen(
            <SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />,
        );
        await screen.pressByTestIdAsync('execution-run-launcher-target:agent:codex');
        const composer = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };
        await act(async () => {
            await expect(composer.submitPreparedMessage(preparedSubmission())).rejects.toThrow('not started');
        });
        await act(async () => {
            await composer.submitPreparedMessage(preparedSubmission());
        });

        expect(startSpy).toHaveBeenCalledTimes(2);
        expect(startSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            backendTarget: {
                kind: 'agent',
                identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
            },
            launchOrigin: expect.objectContaining({ draftCorrelationId: 'correlation_1' }),
        }));
        expect(startSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            backendTarget: {
                kind: 'agent',
                identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
            },
            launchOrigin: expect.objectContaining({ draftCorrelationId: 'correlation_1' }),
        }));
    });

    it('does not guess when correlation has multiple matches', async () => {
        startSpy.mockResolvedValue({ ok: false, error: 'unknown', details: { executionRunStart: { v: 1, runCreation: 'outcomeUnknown' } } });
        listSpy.mockResolvedValue({
            runs: [
                { runId: 'run_a', launchOrigin: { kind: 'session', sessionId: 'session_1', draftCorrelationId: 'correlation_1' } },
                { runId: 'run_b', launchOrigin: { kind: 'session', sessionId: 'session_1', draftCorrelationId: 'correlation_1' } },
            ],
        });
        const submission = preparedSubmission();
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={vi.fn()} />);

        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as { submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void> };
        await act(async () => {
            await expect(props.submitPreparedMessage(submission)).rejects.toThrow();
        });

        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy).not.toHaveBeenCalled();
        expect(submission.onOutboundHandoff).not.toHaveBeenCalled();
    });

    it('keeps the materialized Run and exact Run draft when input admission fails before durable handoff', async () => {
        startSpy.mockResolvedValue({ runId: 'run_1' });
        submitSpy.mockRejectedValue(new Error('input rejected'));
        const submission = preparedSubmission();
        const onRunStarted = vi.fn();
        await renderScreen(<SessionInteractiveExecutionRunDraftView sessionId="session_1" onRunStarted={onRunStarted} />);

        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as { submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void> };
        await act(async () => {
            await expect(props.submitPreparedMessage(submission)).rejects.toThrow('input rejected');
        });

        expect(onRunStarted).toHaveBeenCalledWith('run_1', { retryInputLocalId: 'input_1' });
        expect(writeDraftSpy).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run_1' }));
        expect(submission.onOutboundHandoff).not.toHaveBeenCalled();
        expect(clearAcceptedSpy).not.toHaveBeenCalled();
    });

    it('does not start a Run from an ambient same-ID Session when the exact Home Session is unavailable', async () => {
        exactSessionState.current = null;
        startSpy.mockResolvedValue({ runId: 'run_wrong_home' });
        await renderScreen(
            <SessionInteractiveExecutionRunDraftView
                sessionId="session_1"
                serverId="server_exact"
                onRunStarted={vi.fn()}
            />,
        );

        const props = composerPropsSpy.mock.calls.at(-1)?.[0] as {
            submitPreparedMessage: (value: ParticipantComposerPreparedSubmission) => Promise<void>;
        };
        await act(async () => {
            await expect(props.submitPreparedMessage(preparedSubmission())).rejects.toThrow();
        });

        expect(startSpy).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
    });
});
