import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import type { IModal } from '@/modal';
import type { WorkflowDefinitionGetResultV1 } from '@happier-dev/protocol';
import type { WorkflowRunNowRequest } from '../run/useWorkflowRunNowController';
import { getStorage } from '@/sync/domains/state/storageStore';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createWorkflowDefinitionFixture, createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { buildWorkflowReviewedRunSeed, storeWorkflowReviewedRunSeed } from '@/sync/domains/workflows/workflowReviewedRunSeed';
import type { Machine } from '@/sync/domains/state/storageTypes';
// Resolve the real screen/store graph during collection, outside a behavioral
// test's timeout; Vitest hoists the system-boundary fixture declarations below.
import { WorkflowEditorHostScreen } from './WorkflowEditorHostScreen';

type WorkflowEditorBodyProps = React.ComponentProps<
    typeof import('./WorkflowEditorBody').WorkflowEditorBody
>;

const modalShowSpy = vi.hoisted(() => vi.fn<IModal['show']>(() => 'workflow-run-input-modal'));
const modalHideSpy = vi.hoisted(() => vi.fn<IModal['hide']>());
const modalUpdateSpy = vi.hoisted(() => vi.fn<IModal['update']>());
let latestBodyProps: WorkflowEditorBodyProps | null = null;
const focusPromptSpy = vi.fn<(blockId: string) => void>();

function requireDefined<T>(value: T | undefined, message: string): T {
    if (value === undefined) throw new Error(message);
    return value;
}

const editorAccountScope = vi.hoisted(() => ({
    state: {
        current: { serverId: 'server-a', accountId: 'account-a' } as { serverId: string; accountId: string } | null,
    },
}));

function switchEditorAccountScope(next: { serverId: string; accountId: string } | null): void {
    editorAccountScope.state.current = next;
    getStorage().setState({ profileScope: next });
}

function setEditorMachines(machines: Machine[]): void {
    getStorage().setState({ machines: Object.fromEntries(machines.map((machine) => [machine.id, machine])), machineListByServerId: {} });
}

function storeReviewedCopyFixture(): string {
    return storeWorkflowReviewedRunSeed(buildWorkflowReviewedRunSeed({
        run: createWorkflowRunSummaryFixture(),
        definition: createWorkflowDefinitionFixture({ inputs: [{ name: 'topic', valueType: 'string', required: true }] }),
        acceptedContext: {
            source: { kind: 'inline' }, machineId: 'machine-1', origin: { kind: 'direct' },
            metadata: { title: 'Accepted title', description: 'Accepted description' },
            inputs: { topic: 'Private accepted input' }, executionTarget: { kind: 'session' }, materializedLeaves: [],
            workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo/project', checkoutRootPath: '/repo/project' } },
        },
    }));
}

const routerSpy = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));

const definitionActions = vi.hoisted(() => ({
    get: vi.fn(),
}));
// Trigger transport responses; the client, schemas and shared-store publication stay real.
const triggerActions = vi.hoisted(() => ({ list: vi.fn(async (_input: unknown) => []), add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
const SAVED_TRIGGER_WORKFLOW_ID = '00000000-0000-4000-8000-000000000005';
const TRIGGER_SET_ID = '00000000-0000-4000-8000-000000000009';
const workflowDocumentPicker = vi.hoisted(() => ({ pick: vi.fn() }));

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
// The applied Account host is a system boundary; its lifetime stays real so
// returning to an identity cannot bypass retirement.
vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerSnapshot: () => ({ serverId: editorAccountScope.state.current?.serverId }),
    isAppliedActiveServerRuntimeAvailable: () => editorAccountScope.state.current !== null,
}));
vi.mock('@/sync/domains/workflows/workflowDefinitionActions', () => ({
    createWorkflowDefinition: vi.fn(),
    getWorkflowDefinition: definitionActions.get,
    isWorkflowDefinitionConflictError: () => false,
    updateWorkflowDefinition: vi.fn(),
}));
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => async (actionId: string, input: unknown) => {
        if (actionId === 'workflow.trigger.list') return { ok: true, result: { sets: await triggerActions.list(input) } };
        const writer = actionId === 'workflow.trigger.add' ? triggerActions.add
            : actionId === 'workflow.trigger.update' ? triggerActions.update
                : actionId === 'workflow.trigger.remove' ? triggerActions.remove : null;
        if (writer === null) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action' };
        return { ok: true, result: await writer(input) };
    },
}));
vi.mock('@/sync/domains/workflows/workflowDocumentFile', () => ({
    pickWorkflowDocumentText: workflowDocumentPicker.pick,
    saveWorkflowDocument: vi.fn(),
    workflowDocumentFileName: () => 'workflow.json',
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
                schedule: () => undefined,
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
    setEditorMachines([]);
    getStorage().setState({ settings: settingsDefaults });
    getStorage().setState({ workflowTriggerSetsById: {}, workflowTriggerSetIdsByQuery: {} });
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
    daemonProjection.resolves = false;
    switchEditorAccountScope({ serverId: 'server-a', accountId: 'account-a' });
});

afterEach(async () => {
    await standardCleanup();
});

describe('WorkflowEditorHostScreen composition', () => {
    it('keeps an unavailable saved trigger in its known query after removal instead of inventing inline membership', async () => {
        const set = { automationId: TRIGGER_SET_ID, revision: 3, enabled: true,
            health: 'source_unavailable' as const, triggers: [] };
        getStorage().getState().applyWorkflowTriggerSetPage({ queryKey: `workflow:${SAVED_TRIGGER_WORKFLOW_ID}`, sets: [set] });
        triggerActions.remove.mockResolvedValueOnce({ set });
        const { removeWorkflowTrigger } = await import('@/sync/domains/workflows/workflowTriggerActions');
        await removeWorkflowTrigger({ automationId: TRIGGER_SET_ID, triggerId: 'trigger-1' });
        expect(getStorage().getState().workflowTriggerSetIdsByQuery[`workflow:${SAVED_TRIGGER_WORKFLOW_ID}`]).toEqual([TRIGGER_SET_ID]);
        expect(getStorage().getState().workflowTriggerSetIdsByQuery.account_inline).toBeUndefined();
    });

    /**
     * A brand-new Workflow must be able to choose its Agent before Save or Run,
     * because the strict Workflow schema requires an effective one. The neutral
     * host contributes the incumbent Agent catalog for the selected Machine, and
     * every step prompt is scoped to that same Machine and project folder.
     */
    it('contributes the incumbent Agent catalog and the Machine composer scope to the editor', async () => {
        setEditorMachines([createMachineFixture({ metadata: {
            host: 'tester.local', happyCliVersion: '0.0.0-test', happyHomeDir: '/Users/tester/.happy-dev',
            homeDir: '/Users/me', platform: 'darwin',
        } })]);
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
        const firstBlock = latestBodyProps?.draft.blocks[0];
        if (firstBlock?.kind !== 'step') throw new Error('Expected the first Workflow block to be a step');
        expect(firstBlock.document.text).toBe('Analyze the repository');
    });

    /**
     * UX §2.2 J1: a neutral new workflow opens with its first prompt focused.
     * The intent is source-scoped and consumed exactly once through the page's
     * focus owner, so a rerender or an ordinary edit does not replay it.
     */
    it('focuses the first prompt of a neutral new draft exactly once', async () => {
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
            setEditorMachines([createMachineFixture({ metadata: {
                host: 'tester.local', happyCliVersion: '0.0.0-test', happyHomeDir: '/Users/tester/.happy-dev',
                homeDir: '/Users/me', platform: 'darwin',
            } })]);
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
        it('opens accepted metadata and run inputs for review without saving or starting', async () => {
            const seedId = storeReviewedCopyFixture();
            await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedId }} />);
            expect(latestBodyProps?.draft.name).toBe('Accepted title');
            expect(latestBodyProps?.description).toBe('Accepted description');
            await act(async () => {
                latestBodyProps?.onChangeDescription?.('Edited description');
            });
            expect(latestBodyProps?.description).toBe('Edited description');
            expect(runNowSpy).not.toHaveBeenCalled();
            const { createWorkflowDefinition } = await import('@/sync/domains/workflows/workflowDefinitionActions');
            expect(createWorkflowDefinition).not.toHaveBeenCalled();
            await act(async () => latestBodyProps?.onRunNow?.());
            const modalProps = modalShowSpy.mock.calls.at(-1)?.[0].props as { values?: Record<string, unknown> } | undefined;
            expect(modalProps?.values).toEqual({ topic: 'Private accepted input' });
            expect(runNowSpy).not.toHaveBeenCalled();
        });

        it('offers reviewed-copy disclosures and Back to its source Run without writing', async () => {
            await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: storeReviewedCopyFixture() }} />);
            expect(latestBodyProps).toHaveProperty('reviewNotice');
            act(() => latestBodyProps?.onBackToRun?.());
            expect(routerSpy.push).toHaveBeenLastCalledWith({ pathname: '/workflows/runs/[runId]', params: { runId: 'run-1' } });
            expect(runNowSpy).not.toHaveBeenCalled();
            const { createWorkflowDefinition } = await import('@/sync/domains/workflows/workflowDefinitionActions');
            expect(createWorkflowDefinition).not.toHaveBeenCalled();
        });

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
                inputs: {}, sourceRunId: 'run-1',
            });
            const screen = await renderScreen(
                <WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedId }} />,
            );
            await act(async () => {});
            expect(latestBodyProps?.draft).toMatchObject({ name: 'Account A reviewed run' });

            await act(async () => {
                switchEditorAccountScope({ serverId: 'server-a', accountId: 'account-b' });
            });

            expect(screen.findByTestId('workflow-editor-account-changed')).toBeTruthy();
            expect(screen.findByTestId('workflow-editor-body')).toBeNull();
            await act(async () => {
                switchEditorAccountScope({ serverId: 'server-a', accountId: 'account-a' });
            });
            // Returning to the same identity is a replacement Account lifetime,
            // not permission to resurrect a previously withdrawn private copy.
            expect(screen.findByTestId('workflow-editor-body')).toBeNull();
            await screen.unmount();
        });

        it('withdraws an already opened private draft when the same Account lifetime retires', async () => {
            const { buildWorkflowReviewedRunSeed, storeWorkflowReviewedRunSeed } = await import('@/sync/domains/workflows/workflowReviewedRunSeed');
            const { createWorkflowDefinitionFixture, createWorkflowRunSummaryFixture } = await import('@/dev/testkit/fixtures/workflowRunFixtures');
            const seedId = storeWorkflowReviewedRunSeed(buildWorkflowReviewedRunSeed({
                run: createWorkflowRunSummaryFixture(), definition: createWorkflowDefinitionFixture(),
                acceptedContext: {
                    source: { kind: 'inline' }, machineId: 'machine-1', origin: { kind: 'direct' },
                    inputs: {}, executionTarget: { kind: 'session' }, materializedLeaves: [],
                    workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo/project', checkoutRootPath: '/repo/project' } },
                },
            }));
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedId }} />);
            expect(screen.findByTestId('workflow-editor-body')).toBeTruthy();
            const { retireActiveServerAccountScopeLifetime } = await import('@/sync/domains/scope/activeServerAccountScope');
            await act(async () => retireActiveServerAccountScopeLifetime());
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
                sourceRunId: `run-${machineId}`,
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
            await act(async () => requireDefined(
                latestBodyProps?.onChangeExecutionTarget,
                'Expected an execution-target change handler',
            )('detached_run'));
            await act(async () => requireDefined(latestBodyProps?.onRunNow, 'Expected a Run now handler')());
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
            // (A leaked save would have stamped B as "saved just now".)
            expect(latestBodyProps?.saveStatus).toEqual({ kind: 'saved', savedAtMs: null });
            await screen.unmount();
        });

        it('saves the definition first, then the trigger delta, and keeps the edits when the trigger write fails', async () => {
            const { createWorkflowDefinition } = await import('@/sync/domains/workflows/workflowDefinitionActions');
            const order: string[] = [];
            (createWorkflowDefinition as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
                order.push('definition');
                return { definitionId: SAVED_TRIGGER_WORKFLOW_ID, revision: { headerVersion: 1, bodyVersion: 1 } };
            });
            triggerActions.add.mockImplementationOnce(async () => {
                order.push('trigger');
                throw Object.assign(new Error('target_unavailable'), { code: 'target_unavailable' });
            });
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the new Workflow draft');
            await act(async () => latestBodyProps?.onChange({
                ...draft,
                name: 'Nightly release',
                defaults: { ...draft.defaults, agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
                blocks: [{ kind: 'step', id: 'analyze', document: { text: 'Prepare the release', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
            } as never));
            // The first trigger's set runs on the editor's Where.
            await act(async () => latestBodyProps?.onChangeProjectTarget?.({ machineId: 'machine-1', directory: '/repo' } as never));
            // Adding a trigger edits the draft only: nothing is written yet.
            const section = latestBodyProps?.triggersSection as React.ReactElement<{ draft: unknown; onChangeDraft: (next: unknown) => void }>;
            const trigger = { kind: 'schedule', enabled: true, schedule: { kind: 'cron', scheduleExpr: '0 2 * * *', everyMs: null, timezone: 'UTC' } };
            await act(async () => section.props.onChangeDraft({ adds: [{ clientId: 'c1', trigger }], updates: {}, removes: [] }));
            expect(triggerActions.add).not.toHaveBeenCalled();
            expect(latestBodyProps?.triggersSummary).toBe('workflows.triggers.summary.everyDayAt(time=02:00)');

            await act(async () => latestBodyProps?.onSave?.());
            await act(async () => {});

            expect(order).toEqual(['definition', 'trigger']);
            expect(triggerActions.add).toHaveBeenCalledWith(expect.objectContaining({ workflow: SAVED_TRIGGER_WORKFLOW_ID, project: { machineId: 'machine-1', directory: '/repo' }, trigger }));
            // "Workflow saved · Triggers not updated", with the pending trigger still in the draft.
            expect(latestBodyProps?.saveStatus).toEqual({ kind: 'failed', reason: 'workflows.triggers.editor.partialSave' });
            expect((latestBodyProps?.triggersSection as React.ReactElement<{ draft: { adds: unknown[] } }>).props.draft.adds).toHaveLength(1);
            await screen.unmount();
        });

        it('Save as workflow: the first Save writes the definition, then points the trigger at it, with the partial state when that fails', async () => {
            const { createWorkflowDefinition } = await import('@/sync/domains/workflows/workflowDefinitionActions');
            const { storeTriggerWorkflowSeed } = await import('../triggers/triggerWorkflowSeed');
            (createWorkflowDefinition as unknown as ReturnType<typeof vi.fn>)
                .mockResolvedValue({ definitionId: SAVED_TRIGGER_WORKFLOW_ID, revision: { headerVersion: 1, bodyVersion: 1 } });
            triggerActions.update.mockRejectedValueOnce(Object.assign(new Error('currentness_conflict'), { code: 'currentness_conflict' }));
            const definition = {
                version: 1, inputs: [],
                defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
                blocks: [{ kind: 'step', id: 'digest', document: { text: 'Morning digest', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
            };
            const seedId = storeTriggerWorkflowSeed({
                definition: definition as never,
                retarget: { scope: 'account', automationId: TRIGGER_SET_ID, triggerId: 'trigger-1', expectedRevision: 3 },
            });
            const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
            const screen = await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new', triggerWorkflowSeedId: seedId }} />);
            // The trigger's own steps open as the draft; nothing is written yet.
            expect(latestBodyProps?.draft.blocks[0]).toMatchObject({ id: 'digest' });
            expect(triggerActions.update).not.toHaveBeenCalled();
            const draft = latestBodyProps?.draft;
            if (draft === undefined) throw new Error('Expected the seeded draft');
            await act(async () => latestBodyProps?.onChange({ ...draft, name: 'Morning digest' } as never));

            await act(async () => latestBodyProps?.onSave?.());
            await act(async () => {});
            const retarget = {
                automationId: TRIGGER_SET_ID, triggerId: 'trigger-1', expectedRevision: 3,
                patch: { target: { kind: 'workflow', ref: SAVED_TRIGGER_WORKFLOW_ID } },
            };
            expect(triggerActions.update).toHaveBeenCalledWith(retarget);
            // "Workflow saved · Trigger not updated": the trigger keeps its own steps until it lands.
            expect(latestBodyProps?.saveStatus).toEqual({ kind: 'failed', reason: 'workflows.triggers.editor.retargetFailed' });

            // Try again: Save retries the retarget, which now lands.
            const { updateWorkflowDefinition } = await import('@/sync/domains/workflows/workflowDefinitionActions');
            (updateWorkflowDefinition as unknown as ReturnType<typeof vi.fn>)
                .mockResolvedValueOnce({ definitionId: SAVED_TRIGGER_WORKFLOW_ID, revision: { headerVersion: 1, bodyVersion: 2 } });
            triggerActions.update.mockResolvedValueOnce({ set: { automationId: TRIGGER_SET_ID,
                revision: 4, enabled: true, health: 'available', triggers: [],
                target: { kind: 'workflow', ref: SAVED_TRIGGER_WORKFLOW_ID } } });
            await act(async () => latestBodyProps?.onSave?.());
            await act(async () => {});
            expect(triggerActions.update).toHaveBeenCalledTimes(2);
            expect(latestBodyProps?.saveStatus?.kind).not.toBe('failed');
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
            await act(async () => requireDefined(
                latestBodyProps?.onChangeProjectTarget,
                'Expected a project-target change handler',
            )({
                machineId: 'machine-1',
                directory: '/Users/me/project',
            }));
            await act(async () => requireDefined(latestBodyProps?.onRunNow, 'Expected a Run now handler')());
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
        await act(async () => requireDefined(latestBodyProps?.onRunNow, 'Expected a Run now handler')());

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
            expect.objectContaining({ kind: 'session', available: true }),
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
        await act(async () => requireDefined(
            latestBodyProps?.onChangeProjectTarget,
            'Expected a project-target change handler',
        )({
            machineId: 'machine-1',
            directory: '/Users/me/project',
        }));
        await act(async () => requireDefined(
            latestBodyProps?.onChangeExecutionTarget,
            'Expected an execution-target change handler',
        )('session'));
        await act(async () => requireDefined(latestBodyProps?.onRunNow, 'Expected a Run now handler')());

        expect(runNowSpy).toHaveBeenCalledTimes(1);
        expect(runNowSpy.mock.calls[0]?.[0]).toMatchObject({
            executionTarget: { kind: 'session' },
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
        await act(async () => requireDefined(
            latestBodyProps?.onChangeProjectTarget,
            'Expected a project-target change handler',
        )({
            machineId: 'machine-1',
            directory: '/Users/me/project',
        }));
        await act(async () => requireDefined(latestBodyProps?.onRunNow, 'Expected a Run now handler')());
        expect(runNowSpy).toHaveBeenCalledTimes(1);
        expect(runNowSpy.mock.calls[0]?.[0]).not.toHaveProperty('metadata');

        await act(async () => latestBodyProps?.onChange({ ...authored, name: '  Review  ' }));
        await act(async () => requireDefined(latestBodyProps?.onRunNow, 'Expected a Run now handler')());
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

    it('offers Share for a saved workflow, opening the one document share sheet with its Artifact', async () => {
        definitionActions.get.mockResolvedValueOnce({
            definitionId: 'shared-definition-id',
            revision: { headerVersion: 1, bodyVersion: 1 },
            metadata: { title: 'Nightly review' },
            definition: {
                version: 1, inputs: [], defaults: {},
                blocks: [{ kind: 'step', id: 'review', document: { text: 'Review', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
            },
        } satisfies WorkflowDefinitionGetResultV1);
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'shared-definition-id' }} />);
        await act(async () => {});

        const ids = (latestBodyProps?.menuActions ?? []).map((action) => action.id);
        expect(ids.indexOf('share')).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf('share')).toBeLessThan(ids.indexOf('export'));

        modalShowSpy.mockClear();
        await act(async () => { latestBodyProps?.menuActions?.find((action) => action.id === 'share')?.onSelect(); });
        expect(modalShowSpy).toHaveBeenCalledTimes(1);
        expect(modalShowSpy.mock.calls[0]?.[0]).toMatchObject({
            props: { kind: 'workflow-definition.v1', artifactId: 'shared-definition-id', linkPath: '/workflows/shared-definition-id' },
            chrome: { testID: 'document-share-modal' },
        });
        // "Send a copy instead" is the editor's existing JSON export.
        expect(typeof modalShowSpy.mock.calls[0]?.[0]?.props?.onSendCopy).toBe('function');
    });

    it('offers no Share for a draft that has never been saved', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'new' }} />);
        await act(async () => {});
        expect((latestBodyProps?.menuActions ?? []).some((action) => action.id === 'share')).toBe(false);
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
            switchEditorAccountScope({ serverId: 'server-a', accountId: 'account-b' });
        });
        expect(screen.findByTestId('workflow-editor-loading')).toBeTruthy();
        expect(screen.findByTestId('workflow-editor-body')).toBeNull();
        expect(definitionActions.get).toHaveBeenCalledTimes(2);

        accountB.resolve(definition('Account B private prompt'));
        await act(async () => {});
        expect(latestBodyProps?.draft).toMatchObject({ name: 'Account B private prompt' });
    });
});
