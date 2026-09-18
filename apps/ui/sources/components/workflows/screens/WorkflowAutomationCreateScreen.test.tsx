import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import {
    createWorkflowEditorDraft,
    setWorkflowDefaultField,
    setWorkflowStepText,
} from '@/sync/domains/workflows/workflowEditorDraft';
import { buildWorkflowScheduleSeed } from '@/sync/domains/workflows/workflowScheduleSeed';

const routerBackSpy = vi.fn();
const routerReplaceSpy = vi.fn();
const modalAlertSpy = vi.hoisted(() => vi.fn());
/** What React Navigation was told to intercept, so native Back is falsifiable. */
const preventRemoveState = vi.hoisted(() => ({
    enabled: false,
    handler: null as null | ((event: Readonly<{ data: Readonly<{ action: unknown }> }>) => void),
}));
vi.mock('@react-navigation/native', () => ({
    usePreventRemove: (
        enabled: boolean,
        handler: (event: Readonly<{ data: Readonly<{ action: unknown }> }>) => void,
    ) => {
        preventRemoveState.enabled = enabled;
        preventRemoveState.handler = handler;
    },
}));
const saveAutomationEditorDraftSpy = vi.fn(
    async (_draft: unknown, _options?: unknown) => ({ id: 'automation-created' }),
);
let latestWorkflowEditorProps: Record<string, any> | null = null;
let latestTriggerEditorProps: Record<string, any> | null = null;
let scopeCurrent = true;
const activeAccountScope = vi.hoisted(() => ({
    value: { serverId: 'server-1', accountId: 'account-1' },
}));

// The canonical server feature-decision seam, primed per test. `workflows`
// depends on `automations`, so automations-enabled + workflows-unavailable is a
// supported configuration and must be exercised as one.
const featureDecisions = vi.hoisted(() => ({
    workflows: { state: 'enabled' } as Record<string, unknown> | null,
}));
vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string) => (
        featureId === 'workflows' ? featureDecisions.workflows : { state: 'enabled' }
    ),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: { back: routerBackSpy, replace: routerReplaceSpy },
    }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: modalAlertSpy } }).module;
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    return {
        // Only the reads this screen steers are substituted; the store handle
        // the shared authoring controls reach for stays the real module.
        ...actual,
        storage: { getState: () => ({ sessions: {}, settings: {} }) },
        useAllMachines: () => [{
            id: 'machine-1',
            metadata: { displayName: 'Mac Studio', homeDir: '/Users/me' },
        }],
        useSessions: () => [],
        useSettings: () => ({}),
        useActiveServerAccountScope: () => activeAccountScope.value,
        // The shared host adapter reads the Account's Agent catalog settings.
        useSetting: (name: keyof typeof settingsDefaults) => settingsDefaults[name],
    };
});
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({ phase: 'idle', inputs: null }),
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-1' }),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    captureActiveServerAccountScopeLifetime: () => ({ isCurrent: () => scopeCurrent }),
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: async () => ({ mode: 'plain' }),
    subscribeAccountEncryptionModeCacheInvalidation: () => () => {},
}));
vi.mock('@/sync/sync', () => ({
    sync: {
        encryption: null,
        getCredentials: () => ({ token: 'token' }),
        saveAutomationEditorDraft: saveAutomationEditorDraftSpy,
        refreshSessions: vi.fn(),
    },
}));
vi.mock('@/utils/platform/deferOnWeb', () => ({
    navigateWithBlurOnWeb: (navigate: () => void) => navigate(),
}));
// The shared metadata/trigger composition is the seam under test, so the
// stand-in keeps the one thing that decides ordering: the host's recipe editor
// is composed *inside* it, exactly as the real contents component does.
vi.mock('@/components/automations/editor/AutomationPluralEditorScreen', () => ({
    AutomationTriggerEditor: (props: Record<string, unknown>) => {
        latestTriggerEditorProps = props;
        return React.createElement(
            'AutomationTriggerEditor',
            { testID: 'automation-trigger-editor' },
            (props.recipeEditor as React.ReactNode) ?? null,
        );
    },
}));
vi.mock('@/components/automations/editor/PluginEventAutomationEditor', () => ({
    PluginEventAutomationEditor: () => React.createElement('PluginEventAutomationEditor'),
}));
vi.mock('./WorkflowEditorBody', () => ({
    WorkflowEditorBody: (props: Record<string, unknown>) => {
        latestWorkflowEditorProps = props;
        return React.createElement('WorkflowEditorBody', { testID: 'workflow-definition-editor' });
    },
}));

const AGENT_TARGET = {
    kind: 'agent' as const,
    identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
};
const PROJECT = { machineId: 'machine-1', directory: '/repo/project' } as const;
const REVISION = { headerVersion: 2, bodyVersion: 5 } as const;

function scheduleSeed() {
    const draft = setWorkflowDefaultField(
        createWorkflowEditorDraft({
            draftId: 'source-draft',
            name: 'Release check',
            blocks: [{
                kind: 'step',
                id: 'analyze',
                document: { text: 'Analyze the release', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        }),
        'agentTarget',
        AGENT_TARGET,
    );
    const built = buildWorkflowScheduleSeed({
        draft,
        project: PROJECT,
        saved: { definitionId: 'definition-1', revision: REVISION, definition: draft },
    });
    if (built.kind !== 'available') throw new Error('Fixture must be schedulable');
    return built.seed;
}

beforeEach(() => {
    latestWorkflowEditorProps = null;
    latestTriggerEditorProps = null;
    routerBackSpy.mockClear();
    routerReplaceSpy.mockClear();
    saveAutomationEditorDraftSpy.mockClear();
    modalAlertSpy.mockClear();
    preventRemoveState.enabled = false;
    preventRemoveState.handler = null;
    scopeCurrent = true;
    featureDecisions.workflows = { state: 'enabled' };
});

afterEach(async () => {
    await standardCleanup();
});

describe('WorkflowAutomationCreateScreen', () => {
    it('retargets an adopted exact turn without replacing the mounted authored draft', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const exactTurn = (sourceTurnId: string) => ({
            kind: 'sessionLifecycle' as const,
            enabled: true,
            sourceSessionId: 'source-session',
            events: ['parentTurnCompleted' as const],
            policy: { kind: 'currentTurn' as const, sourceTurnId },
        });
        const screen = await renderScreen(
            <WorkflowAutomationCreateScreen initialTriggers={[exactTurn('turn-7')]} />,
        );
        const initialWorkflow = latestWorkflowEditorProps?.draft;
        if (!initialWorkflow) throw new Error('Expected mounted Workflow draft');
        const authoredWorkflow = setWorkflowStepText(
            initialWorkflow,
            initialWorkflow.blocks[0].id,
            'Keep this authored prompt',
        );
        await act(async () => latestWorkflowEditorProps?.onChange(authoredWorkflow));

        const initialTriggerEditor = latestTriggerEditorProps?.value;
        if (!initialTriggerEditor) throw new Error('Expected mounted trigger editor');
        const exactTrigger = initialTriggerEditor.triggers[0];
        if (!exactTrigger) throw new Error('Expected exact-turn trigger');
        await act(async () => latestTriggerEditorProps?.onChange({
            ...initialTriggerEditor,
            name: 'Keep this name',
            description: 'Keep this description',
            triggers: [
                {
                    ...exactTrigger,
                    definition: {
                        ...exactTrigger.definition,
                        events: ['parentTurnFailed', 'userActionRequired'],
                    },
                },
                {
                    clientId: 'extra-schedule',
                    persisted: null,
                    definition: {
                        kind: 'schedule',
                        enabled: true,
                        schedule: {
                            kind: 'interval',
                            scheduleExpr: null,
                            everyMs: 120_000,
                            timezone: null,
                        },
                    },
                },
            ],
        }));

        await screen.update(
            <WorkflowAutomationCreateScreen initialTriggers={[exactTurn('turn-8')]} />,
        );
        await act(async () => {});

        expect(latestWorkflowEditorProps?.draft).toMatchObject({
            draftId: initialWorkflow.draftId,
            blocks: [expect.objectContaining({
                document: expect.objectContaining({ text: 'Keep this authored prompt' }),
            })],
        });
        expect(latestTriggerEditorProps?.value).toMatchObject({
            name: 'Keep this name',
            description: 'Keep this description',
            triggers: [
                expect.objectContaining({
                    clientId: exactTrigger.clientId,
                    definition: expect.objectContaining({
                        events: ['parentTurnFailed', 'userActionRequired'],
                        policy: { kind: 'currentTurn', sourceTurnId: 'turn-8' },
                    }),
                }),
                expect.objectContaining({ clientId: 'extra-schedule' }),
            ],
        });
    });

    /**
     * Create and edit are one authoring page. The recipe belongs in the shared
     * composition's recipe slot — the position edit already uses — not rendered
     * ahead of the Automation's own name and triggers by a second create form.
     */
    it('composes the recipe through the shared metadata/trigger seam instead of ahead of it', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const screen = await renderScreen(<WorkflowAutomationCreateScreen />);

        const shared = screen.findByTestId('automation-trigger-editor');
        expect(shared).not.toBeNull();
        expect(shared?.findAll((node) => node.props?.testID === 'workflow-definition-editor'))
            .toHaveLength(1);
        expect(latestTriggerEditorProps?.recipeEditor).toBeDefined();

        // The shared editor owns the one page scroll with Create pinned above
        // the document; a host scroll around it would nest two owners and push
        // Create back below the long recipe. (The editor is a stand-in here, so
        // any scroll owner found is the host's.)
        const { KeyboardAwareScrollView } = await import('@/components/ui/keyboardAvoidance/KeyboardAwareScrollView');
        expect(screen.findAllByType(KeyboardAwareScrollView as never)).toHaveLength(0);
        expect(latestTriggerEditorProps?.onSubmit).toBeTypeOf('function');
        expect(latestTriggerEditorProps?.onCancel).toBeTypeOf('function');
    });

    it('states an unavailable Workflow conversion inside the same shared recipe slot', async () => {
        featureDecisions.workflows = { state: 'disabled', blockedBy: 'server' };
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const screen = await renderScreen(<WorkflowAutomationCreateScreen />);

        await act(async () => latestWorkflowEditorProps?.onChangeProjectTarget(PROJECT));
        await act(async () => latestWorkflowEditorProps?.onChange({
            ...latestWorkflowEditorProps.draft,
            blocks: [
                latestWorkflowEditorProps.draft.blocks[0],
                {
                    kind: 'step',
                    id: 'step-2',
                    document: { text: 'Then publish it', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                },
            ],
        }));

        const shared = screen.findByTestId('automation-trigger-editor');
        expect(shared?.findAll((node) => (
            node.props?.testID === 'workflow-automation-create-workflows-unavailable'
        )).length).toBeGreaterThan(0);
    });

    /**
     * Cancel and native Back are the same decision. Before this, Cancel called
     * `router.back()` outright: a reviewed recipe, an Automation name, authored
     * triggers and the chosen project were all discarded with no prompt.
     */
    it('protects an authored recipe from Cancel and from native Back', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen />);

        expect(preventRemoveState.enabled).toBe(false);
        await act(async () => latestWorkflowEditorProps?.onChange(setWorkflowStepText(
            latestWorkflowEditorProps.draft,
            latestWorkflowEditorProps.draft.blocks[0].id,
            'Summarize the release notes',
        )));
        expect(preventRemoveState.enabled).toBe(true);

        await act(async () => latestTriggerEditorProps?.onCancel());
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(modalAlertSpy).toHaveBeenCalledTimes(1);

        const buttons = modalAlertSpy.mock.calls[0]?.[2] as Array<{ onPress?: () => void }>;
        await act(async () => buttons[0]?.onPress?.());
        expect(routerBackSpy).toHaveBeenCalledTimes(1);

        await act(async () => preventRemoveState.handler?.({ data: { action: { type: 'GO_BACK' } } }));
        expect(modalAlertSpy).toHaveBeenCalledTimes(1);
    });

    it('treats an authored name, trigger or project choice as protected unsaved work', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen />);

        await act(async () => latestTriggerEditorProps?.onChange({
            ...latestTriggerEditorProps.value,
            name: 'Nightly notes',
        }));
        expect(preventRemoveState.enabled).toBe(true);

        await act(async () => latestTriggerEditorProps?.onCancel());
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(modalAlertSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves immediately when nothing has been authored', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen />);

        await act(async () => latestTriggerEditorProps?.onCancel());
        expect(modalAlertSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).toHaveBeenCalledTimes(1);
    });

    /**
     * A route-driven exact-turn retarget is URL truth, not authored work: it must
     * not make an untouched page prompt on Back.
     */
    it('does not report a route-driven exact-turn retarget as unsaved authoring', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const exactTurn = (sourceTurnId: string) => ({
            kind: 'sessionLifecycle' as const,
            enabled: true,
            sourceSessionId: 'source-session',
            events: ['parentTurnCompleted' as const],
            policy: { kind: 'currentTurn' as const, sourceTurnId },
        });
        const screen = await renderScreen(
            <WorkflowAutomationCreateScreen initialTriggers={[exactTurn('turn-7')]} />,
        );
        expect(preventRemoveState.enabled).toBe(false);

        await screen.update(
            <WorkflowAutomationCreateScreen initialTriggers={[exactTurn('turn-8')]} />,
        );
        await act(async () => {});

        expect(preventRemoveState.enabled).toBe(false);
        await act(async () => latestTriggerEditorProps?.onCancel());
        expect(modalAlertSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).toHaveBeenCalledTimes(1);
    });

    it('composes the canonical workflow editor with the exact copied machine and the incumbent trigger editor', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const screen = await renderScreen(<WorkflowAutomationCreateScreen seed={scheduleSeed()} />);

        expect(screen.findByTestId('workflow-definition-editor')).not.toBeNull();
        expect(screen.findByTestId('automation-trigger-editor')).not.toBeNull();
        expect(latestWorkflowEditorProps).toMatchObject({
            machineName: 'Mac Studio',
            projectTarget: PROJECT,
            projectMachines: [expect.objectContaining({ id: 'machine-1' })],
            primaryAction: 'save',
            testIDPrefix: 'workflow-schedule-definition',
        });
        expect(latestWorkflowEditorProps?.onRunNow).toBeUndefined();
        expect(latestWorkflowEditorProps?.onSave).toBeUndefined();
        expect(latestWorkflowEditorProps?.onSchedule).toBeUndefined();
    });

    it('freezes the currently reviewed workflow through the sole Automation writer', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen seed={scheduleSeed()} />);

        const edited = setWorkflowStepText(latestWorkflowEditorProps?.draft, 'analyze', 'Analyze the release candidate');
        await act(async () => latestWorkflowEditorProps?.onChange(edited));
        await act(async () => {
            await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
        });

        expect(saveAutomationEditorDraftSpy).toHaveBeenCalledTimes(1);
        const saved = saveAutomationEditorDraftSpy.mock.calls[0]?.[0] as any;
        expect(saved.assignments).toEqual([{ machineId: 'machine-1', enabled: true, priority: 100 }]);
        expect(saved.executionRecipe.workflow).toMatchObject({
            t: 'plain',
            v: {
                project: PROJECT,
                definition: {
                    blocks: [expect.objectContaining({
                        id: 'analyze',
                        document: expect.objectContaining({ text: 'Analyze the release candidate' }),
                    })],
                },
            },
        });
        expect(saved.executionRecipe.workflow.v.source).toBeUndefined();
        expect(routerReplaceSpy).toHaveBeenCalledWith('/automations/automation-created');
    });

    it('cannot save the opened seed into a different Account lifetime', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen seed={scheduleSeed()} />);

        scopeCurrent = false;
        await act(async () => {
            await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
        });

        expect(saveAutomationEditorDraftSpy).not.toHaveBeenCalled();
        expect(routerReplaceSpy).not.toHaveBeenCalled();
    });
    it('opens the composed New Session handoff with its prompt, triggers and placement', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const handoff = {
            name: 'Nightly notes',
            description: null,
            enabled: true,
            draft: createWorkflowEditorDraft({
                draftId: 'handoff-source',
                name: 'Nightly notes',
                blocks: [{
                    kind: 'step',
                    id: 'step-1',
                    document: { text: 'Summarize the release notes', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                }],
            }),
            project: PROJECT,
            triggers: [{
                clientId: 'schedule-1',
                definition: {
                    kind: 'schedule' as const,
                    enabled: true,
                    schedule: { kind: 'interval' as const, scheduleExpr: null, everyMs: 60_000, timezone: null },
                },
            }],
        };

        await renderScreen(<WorkflowAutomationCreateScreen handoff={handoff} />);

        expect(latestWorkflowEditorProps?.draft.blocks[0].document.text).toBe('Summarize the release notes');
        expect(latestWorkflowEditorProps?.projectTarget).toEqual(PROJECT);
        expect(latestTriggerEditorProps?.value.name).toBe('Nightly notes');
        expect(latestTriggerEditorProps?.value.triggers).toEqual([expect.objectContaining({
            persisted: null,
            definition: handoff.triggers[0]!.definition,
        })]);
    });

    /**
     * A refused Create names the exact repairable cause. The screen already
     * resolved every blocker to disable the button; carrying the same fact to
     * the surface is what turns an inert control into an actionable one, and
     * deriving the boolean from it keeps the two from disagreeing.
     */
    it('names the exact blocker Create is refused for, and clears it once repaired', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen />);

        // Unnamed: the canonical Save-eligibility owner's own reason.
        expect(latestTriggerEditorProps?.submitDisabled).toBe(true);
        expect(latestTriggerEditorProps?.submitDisabledReason).toBe('workflows.save.nameRequired');

        await act(async () => latestTriggerEditorProps?.onChange({
            ...latestTriggerEditorProps.value,
            name: 'Nightly notes',
        }));

        // Named, but the prompt is still empty and no target is placed: the
        // reason moves to the next real blocker rather than going silent.
        expect(latestTriggerEditorProps?.submitDisabled).toBe(true);
        expect(latestTriggerEditorProps?.submitDisabledReason).toBe('workflows.editor.targetRequired');

        await act(async () => latestWorkflowEditorProps?.onChangeProjectTarget(PROJECT));
        expect(latestTriggerEditorProps?.submitDisabledReason)
            .toBe('workflows.issue.invalid_input');

        await act(async () => latestWorkflowEditorProps?.onChange(setWorkflowDefaultField(
            setWorkflowStepText(
                latestWorkflowEditorProps.draft,
                latestWorkflowEditorProps.draft.blocks[0].id,
                'Summarize the release notes',
            ),
            'agentTarget',
            AGENT_TARGET,
        )));

        // Repaired: no reason, and Create is live.
        expect(latestTriggerEditorProps?.submitDisabledReason).toBeNull();
        expect(latestTriggerEditorProps?.submitDisabled).toBe(false);
    });

    it('requires a reviewed machine and project folder before an ordinary create can save', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen />);

        // Nothing is placed yet, so Save states its own blocked reason instead
        // of silently choosing a machine.
        expect(latestWorkflowEditorProps?.projectTarget).toBeNull();
        expect(latestTriggerEditorProps?.submitDisabled).toBe(true);

        await act(async () => latestWorkflowEditorProps?.onChangeProjectTarget(PROJECT));
        await act(async () => latestWorkflowEditorProps?.onChange(setWorkflowDefaultField(
            setWorkflowStepText(
                latestWorkflowEditorProps.draft,
                latestWorkflowEditorProps.draft.blocks[0].id,
                'Summarize the release notes',
            ),
            'agentTarget',
            AGENT_TARGET,
        )));
        await act(async () => latestTriggerEditorProps?.onChange({
            ...latestTriggerEditorProps.value,
            name: 'Nightly notes',
        }));

        expect(latestTriggerEditorProps?.submitDisabled).toBe(false);
        await act(async () => {
            await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
        });

        // One prompt stays a released one-shot Automation recipe: creation
        // only reaches the managed workflow recipe when the author wrote
        // something the one-shot arm cannot express.
        const saved = saveAutomationEditorDraftSpy.mock.calls[0]?.[0] as any;
        expect(saved.executionRecipe.v).toBe(1);
        expect(saved.executionRecipe.template).toEqual({
            t: 'plain',
            v: { v: 1, prompt: 'Summarize the release notes' },
        });
        expect(saved.executionRecipe.target.kind).toBe('newSession');
        expect(saved.executionRecipe.target.spawn.directory).toBe(PROJECT.directory);
        expect(saved.executionRecipe.target.spawn.executionTarget.machineId).toBe(PROJECT.machineId);
        expect(saved.assignments).toEqual([{ machineId: 'machine-1', enabled: true, priority: 100 }]);
    });

    it('saves a grown multi-step draft as the managed workflow recipe', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        await renderScreen(<WorkflowAutomationCreateScreen />);

        await act(async () => latestWorkflowEditorProps?.onChangeProjectTarget(PROJECT));
        await act(async () => latestWorkflowEditorProps?.onChange(setWorkflowDefaultField(
            {
                ...setWorkflowStepText(
                    latestWorkflowEditorProps.draft,
                    latestWorkflowEditorProps.draft.blocks[0].id,
                    'Analyze the release',
                ),
                blocks: [
                    {
                        ...latestWorkflowEditorProps.draft.blocks[0],
                        document: { text: 'Analyze the release', references: [], attachments: [] },
                    },
                    {
                        kind: 'step',
                        id: 'step-2',
                        document: { text: 'Then publish it', references: [], attachments: [] },
                        input: [],
                        result: { kind: 'text' },
                    },
                ],
            },
            'agentTarget',
            AGENT_TARGET,
        )));
        await act(async () => latestTriggerEditorProps?.onChange({
            ...latestTriggerEditorProps.value,
            name: 'Release pipeline',
        }));
        await act(async () => {
            await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
        });

        const saved = saveAutomationEditorDraftSpy.mock.calls[0]?.[0] as any;
        expect(saved.executionRecipe.v).toBe(2);
        expect(saved.executionRecipe.workflow.v.definition.blocks).toHaveLength(2);
        expect(saved.executionRecipe.workflow.v.project).toEqual(PROJECT);
    });
});

describe('WorkflowAutomationCreateScreen under the canonical Workflows decision', () => {
    async function placeOneShotDraft(name: string) {
        await act(async () => latestWorkflowEditorProps?.onChangeProjectTarget(PROJECT));
        await act(async () => latestWorkflowEditorProps?.onChange(setWorkflowDefaultField(
            setWorkflowStepText(
                latestWorkflowEditorProps.draft,
                latestWorkflowEditorProps.draft.blocks[0].id,
                'Summarize the release notes',
            ),
            'agentTarget',
            AGENT_TARGET,
        )));
        await act(async () => latestTriggerEditorProps?.onChange({
            ...latestTriggerEditorProps.value,
            name,
        }));
    }

    async function growDraftBeyondOneShot() {
        await act(async () => latestWorkflowEditorProps?.onChange({
            ...latestWorkflowEditorProps.draft,
            blocks: [
                latestWorkflowEditorProps.draft.blocks[0],
                {
                    kind: 'step',
                    id: 'step-2',
                    document: { text: 'Then publish it', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                },
            ],
        }));
    }

    it.each([
        ['disabled', { state: 'disabled', blockedBy: 'server' }],
        ['unknown', { state: 'unknown' }],
        ['unresolved', null],
    ] as const)(
        'keeps representable one-shot Automation creation usable while the Workflows decision is %s',
        async (_label, decision) => {
            featureDecisions.workflows = decision as Record<string, unknown> | null;
            const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
            const screen = await renderScreen(<WorkflowAutomationCreateScreen />);

            await placeOneShotDraft('Nightly notes');

            // Automations remains enabled, so the released one-shot arm — which
            // Run admission accepts without the Workflows decision — stays fully
            // authorable and saveable.
            expect(screen.findAllByTestId('workflow-automation-create-workflows-unavailable')).toHaveLength(0);
            expect(latestTriggerEditorProps?.submitDisabled).toBe(false);

            await act(async () => {
                await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
            });

            const saved = saveAutomationEditorDraftSpy.mock.calls[0]?.[0] as any;
            expect(saved.executionRecipe.v).toBe(1);
        },
    );

    it.each([
        ['disabled', { state: 'disabled', blockedBy: 'server' }],
        ['unknown', { state: 'unknown' }],
        ['unresolved', null],
    ] as const)(
        'refuses the Workflow-only expansion instead of writing a v2 recipe while the decision is %s',
        async (_label, decision) => {
            featureDecisions.workflows = decision as Record<string, unknown> | null;
            const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
            const screen = await renderScreen(<WorkflowAutomationCreateScreen />);

            await placeOneShotDraft('Release pipeline');
            await growDraftBeyondOneShot();

            // The draft is no longer representable as a one-shot recipe, and the
            // canonical Workflows decision does not authorize the v2 arm, so the
            // expansion is refused with its reason rather than silently saved as
            // a recipe Workflow Run admission would reject.
            expect(screen.findByTestId('workflow-automation-create-workflows-unavailable')).not.toBeNull();
            expect(latestTriggerEditorProps?.submitDisabled).toBe(true);

            await act(async () => {
                await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
            });

            // Never downgraded to v1 either: nothing is written at all.
            expect(saveAutomationEditorDraftSpy).not.toHaveBeenCalled();
        },
    );

    it('refuses a reviewed Workflow Schedule copy through the canonical Workflows gate', async () => {
        featureDecisions.workflows = { state: 'disabled', blockedBy: 'server' };
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const screen = await renderScreen(<WorkflowAutomationCreateScreen seed={scheduleSeed()} />);

        expect(screen.findByTestId('workflows-gate-disabled')).not.toBeNull();
        expect(screen.findAllByTestId('workflow-definition-editor')).toHaveLength(0);
        expect(latestTriggerEditorProps).toBeNull();
    });

    it('still expands to the managed workflow recipe when Workflows are enabled', async () => {
        const { WorkflowAutomationCreateScreen } = await import('./WorkflowAutomationCreateScreen');
        const screen = await renderScreen(<WorkflowAutomationCreateScreen />);

        await placeOneShotDraft('Release pipeline');
        await growDraftBeyondOneShot();

        expect(screen.findAllByTestId('workflow-automation-create-workflows-unavailable')).toHaveLength(0);
        expect(latestTriggerEditorProps?.submitDisabled).toBe(false);

        await act(async () => {
            await latestTriggerEditorProps?.onSubmit(latestTriggerEditorProps.value);
        });

        const saved = saveAutomationEditorDraftSpy.mock.calls[0]?.[0] as any;
        expect(saved.executionRecipe.v).toBe(2);
    });
});
