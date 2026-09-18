import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderScreen, standardCleanup } from '@/dev/testkit';
import type { IModal } from '@/modal';
import type { WorkflowDefinitionGetResultV1 } from '@happier-dev/protocol';
import type { WorkflowRunNowRequest } from '../run/useWorkflowRunNowController';

type WorkflowEditorBodyProps = React.ComponentProps<
    typeof import('./WorkflowEditorBody').WorkflowEditorBody
>;

const modalShowSpy = vi.fn<IModal['show']>(() => 'workflow-run-input-modal');
const modalHideSpy = vi.fn<IModal['hide']>();
const modalUpdateSpy = vi.fn<IModal['update']>();
let latestBodyProps: WorkflowEditorBodyProps | null = null;
const focusPromptSpy = vi.fn<(blockId: string) => void>();

const editorAccountScope = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const state = {
        current: { serverId: 'server-a', accountId: 'account-a' } as { serverId: string; accountId: string } | null,
    };
    return {
        state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        switchTo(next: { serverId: string; accountId: string } | null) {
            state.current = next;
            for (const listener of listeners) listener();
        },
    };
});

const routerSpy = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));

const definitionActions = vi.hoisted(() => ({
    get: vi.fn(),
}));
const workflowDocumentPicker = vi.hoisted(() => ({ pick: vi.fn() }));
const projectBrowser = vi.hoisted(() => ({ open: vi.fn() }));

const editorMachines = vi.hoisted(() => ({
    current: [] as Array<{ id: string; metadata?: { homeDir?: string; platform?: string } }>,
}));

/** What the route guard was told about unsaved changes, in order. */
const guardedDirtyStates = vi.hoisted(() => [] as boolean[]);

const issuedIds = vi.hoisted(() => ({ next: 0 }));

/** Whether the selected Machine's daemon projection has resolved, and to what. */
const daemonProjection = vi.hoisted(() => ({
    resolves: false,
    inputs: {
        mergedProviderProjectionById: {},
        mergedBackendProjectionById: {},
        discoveredBackendIds: [] as string[],
    } as Record<string, unknown>,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', () => ({
    useRouter: () => routerSpy,
    useNavigation: () => ({}),
}));
// Ids must be genuinely distinct here: a constant would make a re-created draft
// compare equal to its baseline and hide exactly the initialization defect these
// cases exist to catch.
vi.mock('expo-crypto', () => ({
    randomUUID: () => {
        issuedIds.next += 1;
        return `generated-id-${issuedIds.next}`;
    },
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: { show: modalShowSpy, hide: modalHideSpy, update: modalUpdateSpy },
    }).module;
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    return {
        // Only the reads this screen steers are substituted. Everything else —
        // the store handle the shared authoring controls reach for — stays the
        // real module rather than growing a hand-maintained stub surface.
        ...actual,
        useAllMachines: () => editorMachines.current,
        useSetting: (name: keyof typeof settingsDefaults) => settingsDefaults[name],
        // The Connected Services control reads the whole Account settings
        // record for its label/default-auth facts, the same way New Session
        // does. Defaults keep that boundary inert here.
        useSettings: () => settingsDefaults,
        useActiveServerAccountScope: () => React.useSyncExternalStore(
            editorAccountScope.subscribe,
            () => editorAccountScope.state.current,
            () => editorAccountScope.state.current,
        ),
    };
});
// The exact Machine's daemon projection is a transport boundary; the Agent
// catalog projection beneath the host adapter stays real. The stub keeps the
// real enablement contract — no selected Machine means no projection — because
// "after the exact Machine's projection resolved" is the condition under test.
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: (params: { enabled?: boolean }) => (
        params.enabled === true && daemonProjection.resolves
            ? { phase: 'ready', inputs: daemonProjection.inputs }
            : { phase: 'idle', inputs: null }
    ),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    // Only the lifetime capture this screen steers is substituted; the scope
    // reads the shared authoring controls make stay real.
    captureActiveServerAccountScopeLifetime: () => {
        const captured = editorAccountScope.state.current;
        return captured === null ? null : {
            isCurrent: () => editorAccountScope.state.current?.serverId === captured.serverId
                && editorAccountScope.state.current?.accountId === captured.accountId,
        };
    },
}));
vi.mock('@/sync/domains/workflows/workflowDefinitionActions', () => ({
    createWorkflowDefinition: vi.fn(),
    getWorkflowDefinition: definitionActions.get,
    isWorkflowDefinitionConflictError: () => false,
    updateWorkflowDefinition: vi.fn(),
}));
vi.mock('@/sync/domains/workflows/workflowScheduleSeed', () => ({
    buildWorkflowScheduleSeed: () => ({ kind: 'unavailable' }),
    storeWorkflowScheduleSeed: () => 'seed-id',
}));
vi.mock('@/sync/domains/workflows/workflowDocumentFile', () => ({
    pickWorkflowDocumentText: workflowDocumentPicker.pick,
    saveWorkflowDocument: vi.fn(),
    workflowDocumentFileName: () => 'workflow.json',
}));
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: projectBrowser.open,
}));
const runNowSpy = vi.hoisted(() => vi.fn<(request: WorkflowRunNowRequest) => Promise<null>>(async () => null));
vi.mock('../run/useWorkflowRunNowController', () => ({
    useWorkflowRunNowController: () => ({ runNow: runNowSpy, stateFor: () => 'idle' }),
}));
vi.mock('@/components/ui/layout/layout', () => ({
    useLayoutMaxWidthStyle: () => ({ maxWidth: 960 }),
}));
// Navigation interception is a host boundary; this records the dirty verdict the
// editor reports so pristine/dirty can be asserted without a navigation event.
vi.mock('@/utils/navigation/useUnsavedChangesBeforeRemoveGuard', () => ({
    useUnsavedChangesBeforeRemoveGuard: (params: { isDirty: boolean }) => {
        guardedDirtyStates.push(params.isDirty);
    },
}));
vi.mock('@/utils/navigation/useActiveUnsavedChangesGuard', () => ({
    useActiveUnsavedChangesGuard: () => {},
}));
vi.mock('./WorkflowEditorBody', async () => {
    const ReactModule = await import('react');
    return {
        // The host reaches the page commands only through `commandsRef`; this
        // stand-in forwards them to the effect owners without the page gate.
        WorkflowEditorBody: (props: WorkflowEditorBodyProps) => {
            latestBodyProps = props;
            ReactModule.useImperativeHandle(props.commandsRef, () => ({
                runNow: () => props.onRunNow?.(),
                save: () => props.onSave?.(),
                schedule: () => props.onSchedule?.(),
                exportJson: () => props.onExportJson?.(),
                focusPrompt: (blockId: string) => { focusPromptSpy(blockId); },
            }), [props]);
            return ReactModule.createElement('WorkflowEditorBody', { testID: 'workflow-editor-body' });
        },
        setWorkflowStepExecutionField: (value: unknown) => value,
    };
});

beforeEach(() => {
    latestBodyProps = null;
    focusPromptSpy.mockClear();
    editorMachines.current = [];
    guardedDirtyStates.length = 0;
    issuedIds.next = 0;
    routerSpy.push.mockClear();
    routerSpy.back.mockClear();
    runNowSpy.mockClear();
    modalShowSpy.mockClear();
    modalHideSpy.mockClear();
    modalUpdateSpy.mockClear();
    definitionActions.get.mockReset();
    workflowDocumentPicker.pick.mockReset();
    projectBrowser.open.mockReset();
    daemonProjection.resolves = false;
    editorAccountScope.switchTo({ serverId: 'server-a', accountId: 'account-a' });
});

afterEach(async () => {
    await standardCleanup();
});

describe('WorkflowEditorHostScreen composition', () => {
    it('threads captured Session context and its exact project target into the canonical editor', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const draft = {
            draftId: 'captured-draft',
            name: 'Captured workflow',
            description: '',
            inputs: [],
            defaults: {},
            blocks: [{
                kind: 'step' as const,
                id: 'captured-step',
                document: { text: '', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' as const },
            }],
        };
        const project = { machineId: 'machine-1', directory: '/repo/project' };

        await renderScreen(<WorkflowEditorHostScreen source={{
            kind: 'capturedSession',
            sessionId: 'session-1',
            serverId: 'server-1',
            draft,
            project,
        }} />);

        expect(latestBodyProps).toMatchObject({
            draft,
            projectTarget: project,
            // A captured Session keeps its own live scope; it is never replaced
            // by the Machine the project happens to sit on.
            composerScope: {
                kind: 'session',
                sessionId: 'session-1',
                serverId: 'server-1',
            },
        });
    });

    /**
     * A brand-new Workflow must be able to choose its Agent before Save or Run,
     * because the strict Workflow schema requires an effective one. The neutral
     * host contributes the incumbent Agent catalog for the selected Machine, and
     * every step prompt is scoped to that same Machine and project folder.
     */
    it('contributes the incumbent Agent catalog and the Machine composer scope to the editor', async () => {
        editorMachines.current = [{ id: 'machine-1', metadata: { homeDir: '/Users/me', platform: 'darwin' } }];
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);

        await act(async () => latestBodyProps?.onChangeProjectTarget?.({
            machineId: 'machine-1',
            directory: '/Users/me/project',
        }));

        const agentTargets = latestBodyProps?.authoringFacts?.agentTargets ?? [];
        expect(agentTargets.length).toBeGreaterThan(0);
        for (const option of agentTargets) {
            expect(option.target.kind).toBe('agent');
            expect(option.target.identity.pluginId).toBeTruthy();
        }
        expect(latestBodyProps?.composerScope).toEqual({
            kind: 'machine',
            machineId: 'machine-1',
            serverId: 'server-a',
            directory: '/Users/me/project',
            machineHomeDir: '/Users/me',
        });
    });

    /**
     * Route hosts rebuild `source` on every render. Keying initialization on
     * that object identity re-created the draft continuously, which threw away
     * the prompt text and made an untouched editor read as dirty.
     */
    it('initializes one logical source exactly once across rerenders', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        // Every route host builds `source` inline, so a parent rerender hands
        // the editor a structurally identical but referentially new object.
        const host = () => <WorkflowEditorHostScreen source={{ kind: 'new' }} />;
        const screen = await renderScreen(host());
        const initialDraft = latestBodyProps?.draft;
        if (initialDraft === undefined) throw new Error('Expected the new Workflow draft');

        await act(async () => latestBodyProps?.onChange({
            ...initialDraft,
            blocks: [{
                ...initialDraft.blocks[0],
                document: { text: 'Analyze the repository', references: [], attachments: [] },
            }],
        } as never));
        await screen.update(host());
        await screen.update(host());

        expect(latestBodyProps?.draft.draftId).toBe(initialDraft.draftId);
        expect(latestBodyProps?.draft.blocks[0]?.document.text).toBe('Analyze the repository');
    });

    /**
     * UX §2.2 J1: a neutral new workflow opens with its first prompt focused.
     * The intent is source-scoped and consumed exactly once through the page's
     * focus owner; a rerender does not replay it, and an opened saved
     * definition or a captured Session never claims it.
     */
    it('focuses the first prompt of a neutral new draft once, and never for another source', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const host = () => <WorkflowEditorHostScreen source={{ kind: 'new' }} />;
        const screen = await renderScreen(host());
        await act(async () => {});
        const firstBlockId = latestBodyProps?.draft.blocks[0]?.id;
        expect(focusPromptSpy).toHaveBeenCalledTimes(1);
        expect(focusPromptSpy).toHaveBeenCalledWith(firstBlockId);

        await screen.update(host());
        await act(async () => latestBodyProps?.onChange({ ...latestBodyProps.draft, name: 'Named' } as never));
        await screen.update(host());
        expect(focusPromptSpy).toHaveBeenCalledTimes(1);
        await screen.unmount();

        focusPromptSpy.mockClear();
        const captured = await renderScreen(<WorkflowEditorHostScreen source={{
            kind: 'capturedSession',
            sessionId: 'session-1',
            serverId: 'server-1',
            draft: {
                draftId: 'captured-draft',
                name: 'Captured workflow',
                inputs: [],
                defaults: {},
                blocks: [{
                    kind: 'step' as const,
                    id: 'captured-step',
                    document: { text: '', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' as const },
                }],
            },
            project: { machineId: 'machine-1', directory: '/repo/project' },
        }} />);
        await act(async () => {});
        expect(focusPromptSpy).not.toHaveBeenCalled();
        await captured.unmount();
    });

    /**
     * The pristine baseline must be the exact draft the editor started from. A
     * second construction has a different draft id, so an untouched editor
     * compares unequal and reports itself dirty.
     */
    it('treats an untouched new draft as pristine', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
        await act(async () => {});

        expect(guardedDirtyStates.at(-1)).toBe(false);
        await screen.unmount();
    });

    /**
     * A brand-new workflow starts from the same Agent New Session would start
     * from (UX §2.3/J1) — and from nothing at all until that answer is real.
     *
     * The strict Workflow schema requires an effective Agent, so an empty
     * neutral draft is unrunnable; but the honest repair is the contextual
     * Agent for the exact selected Machine, not the bundled fallback, which is
     * what an unresolved projection can still produce.
     */
    describe('contextual Agent for a pristine neutral draft', () => {
        const selectMachine = async () => {
            await act(async () => latestBodyProps?.onChangeProjectTarget?.({
                machineId: 'machine-1',
                directory: '/Users/me/project',
            }));
        };

        beforeEach(() => {
            editorMachines.current = [{ id: 'machine-1', metadata: { homeDir: '/Users/me', platform: 'darwin' } }];
        });

        it('adopts the contextual Agent once the exact Machine projection resolves, without becoming dirty', async () => {
            daemonProjection.resolves = true;
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            await selectMachine();
            await act(async () => {});

            const seeded = latestBodyProps?.draft.defaults.agentTarget;
            const offered = latestBodyProps?.authoringFacts?.agentTargets ?? [];
            expect(seeded).toBeDefined();
            // Only an Agent this Machine actually offers: seeding a target the
            // ingress normalizer would reject is the same defect with a nicer
            // chip label.
            expect(offered.some((option) => (
                option.target.identity.pluginId === seeded?.identity.pluginId
                && option.target.identity.localId === seeded?.identity.localId
            ))).toBe(true);
            expect(seeded).toEqual(latestBodyProps?.authoringFacts?.contextualDefaultAgentTarget);
            // Initialization, not an edit: the person has changed nothing.
            expect(guardedDirtyStates.at(-1)).toBe(false);

            await screen.unmount();
        });

        it('leaves the draft honestly unresolved when no projection can name an Agent', async () => {
            daemonProjection.resolves = false;
            const { validateWorkflowEditorDraft } = await import('@/sync/domains/workflows/workflowAuthoring');
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);

            await selectMachine();
            await act(async () => {});

            expect(latestBodyProps?.authoringFacts?.contextualDefaultAgentTarget ?? null).toBeNull();
            expect(latestBodyProps?.draft.defaults.agentTarget).toBeUndefined();

            // And the draft still says so: an unresolved Agent is refused by the
            // canonical validator rather than papered over at the chip.
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the new Workflow draft');
            const withPrompt = {
                ...draft,
                name: 'Review',
                blocks: [{
                    ...draft.blocks[0],
                    document: { text: 'Analyze the repository', references: [], attachments: [] },
                }],
            } as typeof draft;
            const validation = validateWorkflowEditorDraft(withPrompt);
            expect(validation.valid).toBe(false);
            expect(validation.issues.some((issue) => issue.code === 'target_unavailable')).toBe(true);

            await screen.unmount();
        });

        it('never re-seeds a captured Session draft, which names its own Agent', async () => {
            daemonProjection.resolves = true;
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{
                kind: 'capturedSession',
                sessionId: 'session-1',
                serverId: 'server-1',
                draft: {
                    draftId: 'captured-draft',
                    name: 'Captured workflow',
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step' as const,
                        id: 'captured-step',
                        document: { text: '', references: [], attachments: [] },
                        input: [],
                        result: { kind: 'text' as const },
                    }],
                } as never,
                project: { machineId: 'machine-1', directory: '/repo/project' },
            }} />);
            await act(async () => {});

            expect(latestBodyProps?.draft.defaults.agentTarget).toBeUndefined();
            await screen.unmount();
        });

        it('never re-seeds a hydrated saved definition', async () => {
            daemonProjection.resolves = true;
            definitionActions.get.mockResolvedValueOnce({
                definitionId: 'saved-definition',
                revision: { headerVersion: 1, bodyVersion: 1 },
                metadata: { title: 'Saved workflow' },
                definition: {
                    version: 1,
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step', id: 'review',
                        document: { text: 'Review', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                },
            });
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(
                <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'saved-definition' }} />,
            );
            await act(async () => {});
            await selectMachine();
            await act(async () => {});

            expect(latestBodyProps?.draft).toMatchObject({ name: 'Saved workflow' });
            expect(latestBodyProps?.draft.defaults.agentTarget).toBeUndefined();
            await screen.unmount();
        });

        it('never overwrites an Agent the person already chose', async () => {
            daemonProjection.resolves = false;
            const authored = {
                kind: 'agent' as const,
                identity: { pluginId: 'acme.review-bot', localId: 'reviewer' },
            };
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the new Workflow draft');
            await act(async () => latestBodyProps?.onChange({
                ...draft,
                defaults: { ...draft.defaults, agentTarget: authored },
            } as never));

            daemonProjection.resolves = true;
            await selectMachine();
            await act(async () => {});

            expect(latestBodyProps?.draft.defaults.agentTarget).toEqual(authored);
            await screen.unmount();
        });
    });

    /**
     * A reviewed Run copy and a captured Session arrive as already-decrypted
     * Account-private bytes held in memory. Re-initialization is keyed on the
     * Account, so the Account-only change used to re-adopt those exact bytes and
     * stamp them with the new scope — presenting, and offering to save, one
     * Account's private workflow as another's.
     */
    describe('private seed custody across an Account change', () => {
        it('withdraws a reviewed Run copy instead of re-presenting it to the next Account', async () => {
            const { storeWorkflowReviewedRunSeed } = await import(
                '@/sync/domains/workflows/workflowReviewedRunSeed'
            );
            const seedId = storeWorkflowReviewedRunSeed({
                name: 'Account A reviewed run',
                definition: {
                    version: 1,
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step', id: 'review',
                        document: { text: 'Account A private prompt', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                },
                project: { machineId: 'machine-1', directory: '/repo/project' },
                executionTarget: { kind: 'session' },
            } as never);
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(
                <WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedId }} />,
            );
            await act(async () => {});
            expect(latestBodyProps?.draft).toMatchObject({ name: 'Account A reviewed run' });

            await act(async () => {
                editorAccountScope.switchTo({ serverId: 'server-a', accountId: 'account-b' });
            });

            expect(screen.findByTestId('workflow-editor-account-changed')).toBeTruthy();
            expect(screen.findByTestId('workflow-editor-body')).toBeNull();
            await screen.unmount();
        });

        it('withdraws a captured Session draft instead of re-presenting it to the next Account', async () => {
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{
                kind: 'capturedSession',
                sessionId: 'session-1',
                serverId: 'server-a',
                draft: {
                    draftId: 'captured-draft',
                    name: 'Account A captured workflow',
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step' as const,
                        id: 'captured-step',
                        document: { text: 'Account A private prompt', references: [], attachments: [] },
                        input: [],
                        result: { kind: 'text' as const },
                    }],
                } as never,
                project: { machineId: 'machine-1', directory: '/repo/project' },
            }} />);
            await act(async () => {});
            expect(latestBodyProps?.draft).toMatchObject({ name: 'Account A captured workflow' });

            await act(async () => {
                editorAccountScope.switchTo({ serverId: 'server-a', accountId: 'account-b' });
            });

            expect(screen.findByTestId('workflow-editor-account-changed')).toBeTruthy();
            expect(screen.findByTestId('workflow-editor-body')).toBeNull();
            await screen.unmount();
        });
    });

    /**
     * A different logical source is a different editor. Anything the previous
     * source collected — Run inputs, an open input sheet, a pending Run id, the
     * page-level Run as choice — and anything it started that has not resolved
     * must not surface in the next one.
     */
    describe('source-local state and slower publications', () => {
        it('adopts a different reviewed Run seed as a different logical source on the same mount', async () => {
            const { storeWorkflowReviewedRunSeed } = await import(
                '@/sync/domains/workflows/workflowReviewedRunSeed'
            );
            const reviewedSeed = (name: string, prompt: string, machineId: string) => ({
                name,
                definition: {
                    version: 1 as const,
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step' as const,
                        id: 'review',
                        document: { text: prompt, references: [], attachments: [] },
                        input: [],
                        result: { kind: 'text' as const },
                    }],
                },
                project: { machineId, directory: `/repo/${machineId}` },
                executionTarget: { kind: 'session' as const },
                inputs: {},
                supersededRunId: `run-${machineId}`,
                reasonCode: 'workspace_missing',
            });
            const seedA = storeWorkflowReviewedRunSeed(reviewedSeed('Run A', 'Prompt A', 'machine-a'));
            const seedB = storeWorkflowReviewedRunSeed(reviewedSeed('Run B', 'Prompt B', 'machine-b'));
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(
                <WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedA }} />,
            );
            expect(latestBodyProps?.draft).toMatchObject({ name: 'Run A' });

            await screen.update(
                <WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedB }} />,
            );
            await act(async () => {});

            expect(latestBodyProps?.draft).toMatchObject({
                name: 'Run B',
                blocks: [expect.objectContaining({
                    document: expect.objectContaining({ text: 'Prompt B' }),
                })],
            });
            expect(latestBodyProps?.projectTarget).toEqual({
                machineId: 'machine-b',
                directory: '/repo/machine-b',
            });
            await screen.unmount();
        });

        it('resets a plain new draft before opening a newly requested import', async () => {
            const importSelection = createDeferred<string | null>();
            workflowDocumentPicker.pick.mockImplementationOnce(() => importSelection.promise);
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            const firstDraft = latestBodyProps?.draft;
            if (!firstDraft) throw new Error('Expected the first new Workflow draft');
            await act(async () => latestBodyProps?.onChange({ ...firstDraft, name: 'Unsaved source A' }));

            await screen.update(
                <WorkflowEditorHostScreen source={{ kind: 'new', requestImport: true }} />,
            );
            await act(async () => {});

            expect(workflowDocumentPicker.pick).toHaveBeenCalledTimes(1);
            expect(latestBodyProps?.draft).toMatchObject({ name: '' });
            expect(latestBodyProps?.draft?.draftId).not.toBe(firstDraft.draftId);

            importSelection.resolve(null);
            await act(async () => {});
            await screen.unmount();
        });

        it('does not let a project browser opened by source A retarget source B', async () => {
            const directorySelection = createDeferred<string | null>();
            projectBrowser.open.mockImplementationOnce(() => directorySelection.promise);
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            await act(async () => latestBodyProps?.onChangeProjectTarget({
                machineId: 'machine-a',
                directory: '/repo/a',
            }));
            await act(async () => latestBodyProps?.onBrowseProjectDirectory?.());

            await screen.update(<WorkflowEditorHostScreen source={{
                kind: 'capturedSession',
                sessionId: 'session-b',
                serverId: 'server-a',
                draft: {
                    draftId: 'captured-b',
                    name: 'Source B',
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step',
                        id: 'review',
                        document: { text: 'Prompt B', references: [], attachments: [] },
                        input: [],
                        result: { kind: 'text' },
                    }],
                } as never,
                project: { machineId: 'machine-b', directory: '/repo/b' },
            }} />);
            await act(async () => {});

            directorySelection.resolve('/repo/a-picked');
            await act(async () => {});

            expect(latestBodyProps?.projectTarget).toEqual({
                machineId: 'machine-b',
                directory: '/repo/b',
            });
            await screen.unmount();
        });

        it('resets collected Run inputs, the open input sheet and Run as when the source changes', async () => {
            definitionActions.get.mockResolvedValue({
                definitionId: 'definition-b',
                revision: { headerVersion: 1, bodyVersion: 1 },
                metadata: { title: 'Definition B' },
                definition: {
                    version: 1,
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step', id: 'review',
                        document: { text: 'Review', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                },
            });
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the new Workflow draft');

            await act(async () => latestBodyProps?.onChange({
                ...draft,
                inputs: [{ name: 'topic', valueType: 'string', required: true }],
            } as never));
            await act(async () => latestBodyProps?.onChangeExecutionTarget('attached_run'));
            await act(async () => latestBodyProps?.onRunNow());
            expect(modalShowSpy).toHaveBeenCalledTimes(1);
            modalHideSpy.mockClear();

            await screen.update(
                <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'definition-b' }} />,
            );
            await act(async () => {});

            // The sheet that was collecting the previous workflow's inputs is
            // closed, and the page-level Run as choice is the new source's own.
            expect(modalHideSpy).toHaveBeenCalled();
            expect(latestBodyProps?.executionTarget).toBe('session');
            expect(latestBodyProps?.draft).toMatchObject({ name: 'Definition B' });
            await screen.unmount();
        });

        it('does not let a source-A save publish its revision into source B', async () => {
            const { createWorkflowDefinition } = await import(
                '@/sync/domains/workflows/workflowDefinitionActions'
            );
            const slowCreate = createDeferred<{
                definitionId: string;
                revision: { headerVersion: number; bodyVersion: number };
            }>();
            (createWorkflowDefinition as unknown as ReturnType<typeof vi.fn>)
                .mockImplementationOnce(() => slowCreate.promise);
            definitionActions.get.mockResolvedValue({
                definitionId: 'definition-b',
                revision: { headerVersion: 9, bodyVersion: 9 },
                metadata: { title: 'Definition B' },
                definition: {
                    version: 1,
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step', id: 'review',
                        document: { text: 'Review', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                },
            });
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the new Workflow draft');
            await act(async () => latestBodyProps?.onChange({
                ...draft,
                name: 'Source A',
                defaults: {
                    ...draft.defaults,
                    agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
                },
                blocks: [{
                    kind: 'step',
                    id: 'analyze',
                    document: { text: 'Analyze the repository', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                }],
            } as never));
            await act(async () => latestBodyProps?.onSave?.());

            await screen.update(
                <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'definition-b' }} />,
            );
            await act(async () => {});
            expect(latestBodyProps?.draft).toMatchObject({ name: 'Definition B' });

            slowCreate.resolve({
                definitionId: 'source-a-definition',
                revision: { headerVersion: 1, bodyVersion: 1 },
            });
            await act(async () => {});

            // Source B is showing its own hydrated revision, not the one source
            // A's save just created.
            expect(latestBodyProps?.savedRevision).toEqual({ headerVersion: 9, bodyVersion: 9 });
            await screen.unmount();
        });

        /**
         * Leaving the editor is the same question as changing its source.
         *
         * The Run really is admitted — the person asked for it — but taking over
         * whatever page they are on now with this editor's navigation is not
         * this call's decision, exactly as it is not when the source changed
         * underneath it.
         */
        it('does not let a Run admitted before the editor closed navigate afterwards', async () => {
            const admission = createDeferred<Readonly<{ run: { id: string } }>>();
            runNowSpy.mockImplementationOnce(() => admission.promise as never);
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the new Workflow draft');
            await act(async () => latestBodyProps?.onChange({
                ...draft,
                name: 'Review',
                defaults: {
                    ...draft.defaults,
                    agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
                },
                blocks: [{
                    kind: 'step',
                    id: 'analyze',
                    document: { text: 'Analyze the repository', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                }],
            }));
            await act(async () => latestBodyProps?.onChangeProjectTarget({
                machineId: 'machine-1',
                directory: '/Users/me/project',
            }));
            await act(async () => latestBodyProps?.onRunNow());
            expect(runNowSpy).toHaveBeenCalledTimes(1);

            await screen.unmount();

            admission.resolve({ run: { id: 'admitted-after-close' } });
            await act(async () => {});

            expect(routerSpy.push).not.toHaveBeenCalled();
        });
    });

    /**
     * The editor body owns this page's one scroll, because the pinned command
     * surface has to stay on screen while the document scrolls beneath it. The
     * host must not wrap it in a second scroll owner.
     */
    it('adds no second scroll owner around the body that owns the page scroll', async () => {
        const { KeyboardAwareScrollView } = await import('@/components/ui/keyboardAvoidance/KeyboardAwareScrollView');
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);

        expect(screen.findAllByType(KeyboardAwareScrollView as never)).toHaveLength(0);
        expect(screen.findByTestId('workflow-editor-body')).not.toBeNull();
    });

    it('keeps the editor mounted while canonical modal chrome collects Run inputs', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
        const initialDraft = latestBodyProps?.draft;
        expect(initialDraft).toBeDefined();
        if (initialDraft === undefined) throw new Error('Expected the new Workflow draft');

        await act(async () => latestBodyProps?.onChange({
            ...initialDraft,
            inputs: [{ name: 'topic', valueType: 'string', required: true }],
        }));
        await act(async () => latestBodyProps?.onRunNow());

        expect(screen.findByTestId('workflow-editor-body')).not.toBeNull();
        expect(modalShowSpy).toHaveBeenCalledTimes(1);
        expect(modalShowSpy.mock.calls[0]?.[0]).toMatchObject({
            chrome: { kind: 'card', bodyScroll: 'auto' },
            closeOnBackdrop: true,
        });
    });

    it('owns Run as at page scope and carries the selected target into admission', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
        expect(latestBodyProps?.executionTarget).toBe('session');
        expect(latestBodyProps?.runAsTargets).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'attached_run', available: true }),
            expect.objectContaining({ kind: 'detached_run', available: false }),
        ]));

        const draft = latestBodyProps?.draft;
        if (draft === undefined) throw new Error('Expected the new Workflow draft');
        await act(async () => latestBodyProps?.onChange({
            ...draft,
            name: 'Review',
            defaults: {
                ...draft.defaults,
                agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
            },
            blocks: [{
                kind: 'step',
                id: 'analyze',
                document: { text: 'Analyze the repository', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        }));
        await act(async () => latestBodyProps?.onChangeProjectTarget({
            machineId: 'machine-1',
            directory: '/Users/me/project',
        }));
        await act(async () => latestBodyProps?.onChangeExecutionTarget('attached_run'));
        await act(async () => latestBodyProps?.onRunNow());

        expect(runNowSpy).toHaveBeenCalledTimes(1);
        expect(runNowSpy.mock.calls[0]?.[0]).toMatchObject({
            executionTarget: { kind: 'attached_run' },
        });
    });

    /**
     * UX §2.2 J1: one prompt is a workflow and Run now needs no name. The
     * admission metadata title is `min(1)` at the Protocol owner, so an
     * unnamed draft admits with no metadata at all — an empty title would be
     * refused after the page had already said Run now could proceed.
     */
    it('admits an unnamed draft without a title, and a named draft with exactly its trimmed title', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
        const draft = latestBodyProps?.draft;
        if (draft === undefined) throw new Error('Expected the new Workflow draft');
        const authored = {
            ...draft,
            defaults: {
                ...draft.defaults,
                agentTarget: { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
            },
            blocks: [{
                kind: 'step' as const,
                id: 'analyze',
                document: { text: 'Analyze the repository', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' as const },
            }],
        };
        await act(async () => latestBodyProps?.onChange({ ...authored, name: '   ' }));
        await act(async () => latestBodyProps?.onChangeProjectTarget({
            machineId: 'machine-1',
            directory: '/Users/me/project',
        }));
        await act(async () => latestBodyProps?.onRunNow());
        expect(runNowSpy).toHaveBeenCalledTimes(1);
        expect(runNowSpy.mock.calls[0]?.[0]).not.toHaveProperty('metadata');

        await act(async () => latestBodyProps?.onChange({ ...authored, name: '  Review  ' }));
        await act(async () => latestBodyProps?.onRunNow());
        expect(runNowSpy).toHaveBeenCalledTimes(2);
        expect(runNowSpy.mock.calls[1]?.[0]).toMatchObject({ metadata: { title: 'Review' } });
    });

    /**
     * A read that failed is not proof the workflow was deleted, and a blank page
     * is not an explanation. The neutral host states what happened and offers
     * the read again.
     */
    it('states a failed hydration with a retry rather than a blank page', async () => {
        definitionActions.get
            .mockRejectedValueOnce(new Error('transport failed'))
            .mockResolvedValueOnce({
                definitionId: 'saved-definition',
                revision: { headerVersion: 1, bodyVersion: 1 },
                metadata: { title: 'Recovered workflow' },
                definition: {
                    version: 1,
                    inputs: [],
                    defaults: {},
                    blocks: [{
                        kind: 'step', id: 'review',
                        document: { text: 'Review', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                },
            });
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const screen = await renderScreen(
            <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'saved-definition' }} />,
        );
        await act(async () => {});

        expect(screen.findByTestId('workflow-editor-error')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-body')).toBeNull();

        await screen.pressByTestIdAsync('workflow-editor-error-action');
        await act(async () => {});

        expect(definitionActions.get).toHaveBeenCalledTimes(2);
        expect(latestBodyProps?.draft).toMatchObject({ name: 'Recovered workflow' });
    });

    it('retires a saved private draft immediately and refetches it on Account switch', async () => {
        const accountB = createDeferred<WorkflowDefinitionGetResultV1>();
        const definition = (text: string): WorkflowDefinitionGetResultV1 => ({
            definitionId: 'same-definition-id',
            revision: { headerVersion: 1, bodyVersion: 1 },
            metadata: { title: text },
            definition: {
                version: 1,
                inputs: [],
                defaults: {},
                blocks: [{
                    kind: 'step', id: 'review',
                    document: { text, references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                }],
            },
        });
        definitionActions.get
            .mockResolvedValueOnce(definition('Account A private prompt'))
            .mockImplementationOnce(() => accountB.promise);
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'same-definition-id' }} />);
        await act(async () => {});
        expect(latestBodyProps?.draft).toMatchObject({ name: 'Account A private prompt' });

        await act(async () => {
            editorAccountScope.switchTo({ serverId: 'server-a', accountId: 'account-b' });
        });
        expect(screen.findByTestId('workflow-editor-loading')).toBeTruthy();
        expect(screen.findByTestId('workflow-editor-body')).toBeNull();
        expect(definitionActions.get).toHaveBeenCalledTimes(2);

        accountB.resolve(definition('Account B private prompt'));
        await act(async () => {});
        expect(latestBodyProps?.draft).toMatchObject({ name: 'Account B private prompt' });
    });
});
