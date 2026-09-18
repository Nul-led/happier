import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { IModal } from '@/modal';
import type { WorkflowDefinitionGetResultV1 } from '@happier-dev/protocol';
import type { WorkflowRunNowRequest } from '../run/useWorkflowRunNowController';

/**
 * The saved-row entry intents, consumed at the one editor owner.
 *
 * Edit, Run now and Schedule arrive through the same route because only this
 * page has the reviewed Machine, the page-level Run as choice and the declared
 * inputs. What these tests pin is that each intent reaches a different canonical
 * owner, exactly once, on the hydrated revision — and that Edit reaches none.
 */

type WorkflowEditorBodyProps = React.ComponentProps<
    typeof import('./WorkflowEditorBody').WorkflowEditorBody
>;

const modalShowSpy = vi.fn<IModal['show']>(() => 'workflow-run-input-modal');
const modalHideSpy = vi.fn<IModal['hide']>();
const modalUpdateSpy = vi.fn<IModal['update']>();
let latestBodyProps: WorkflowEditorBodyProps | null = null;
const focusPromptSpy = vi.fn<(blockId: string) => void>();

const definitionActions = vi.hoisted(() => ({ get: vi.fn() }));
const routerMock = vi.hoisted(() => ({ value: null as { spies: { push: ReturnType<typeof vi.fn> } } | null }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const mock = createExpoRouterMock();
    routerMock.value = mock as never;
    return mock.module;
});
vi.mock('expo-crypto', () => ({ randomUUID: () => 'draft-or-run-id' }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: { show: modalShowSpy, hide: modalHideSpy, update: modalUpdateSpy },
    }).module;
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    const { createMachineFixture: machineFixture } = await import('@/dev/testkit/fixtures/machineFixtures');
    return {
        // Only the reads this screen steers are substituted; the store handle
        // the shared authoring controls reach for stays the real module.
        ...actual,
        // A reviewed Machine and folder resolve through the canonical contextual
        // resolver, so Schedule has the exact placement it must freeze.
        useAllMachines: () => [machineFixture({ id: 'machine-1' })],
        useSetting: (key: string) => (key === 'recentMachinePaths'
            ? [{ machineId: 'machine-1', path: '/repo/project' }]
            : undefined),
        useActiveServerAccountScope: () => ({ serverId: 'server-a', accountId: 'account-a' }),
    };
});
vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    captureActiveServerAccountScopeLifetime: () => ({
        scope: { serverId: 'server-a', accountId: 'account-a' },
        isCurrent: () => true,
        onRetire: () => ({ dispose() {} }),
    }),
}));
vi.mock('@/sync/domains/workflows/workflowDefinitionActions', () => ({
    createWorkflowDefinition: vi.fn(),
    getWorkflowDefinition: definitionActions.get,
    isWorkflowDefinitionConflictError: () => false,
    updateWorkflowDefinition: vi.fn(),
}));
vi.mock('@/sync/domains/workflows/workflowDocumentFile', () => ({
    pickWorkflowDocumentText: vi.fn(),
    saveWorkflowDocument: vi.fn(),
    workflowDocumentFileName: () => 'workflow.json',
}));
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: vi.fn(),
}));
// The detached-runtime capability probe is a real network/daemon boundary.
vi.mock('@/sync/ops/actions/executionRunDetachedSupport', () => ({
    detectDetachedExecutionRunSupport: async () => 'machine_does_not_support_detached_runs',
}));
const runNowSpy = vi.hoisted(() => vi.fn<(request: WorkflowRunNowRequest) => Promise<null>>(async () => null));
vi.mock('../run/useWorkflowRunNowController', () => ({
    useWorkflowRunNowController: () => ({ runNow: runNowSpy, stateFor: () => 'idle' }),
}));
vi.mock('@/components/ui/layout/layout', () => ({
    useLayoutMaxWidthStyle: () => ({ maxWidth: 960 }),
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

/** A saved revision the canonical validator accepts, with one declared input. */
function savedDefinition(): WorkflowDefinitionGetResultV1 {
    return {
        definitionId: 'definition-exact',
        revision: { headerVersion: 1, bodyVersion: 2 },
        metadata: { title: 'Release check' },
        definition: {
            version: 1,
            inputs: [{ name: 'topic', valueType: 'string', required: true }],
            defaults: {
                agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
            },
            blocks: [{
                kind: 'step',
                id: 'review',
                document: { text: 'Review the release', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        },
    };
}

function pushSpy(): ReturnType<typeof vi.fn> {
    const spy = routerMock.value?.spies.push;
    if (!spy) throw new Error('Expected the router mock to expose its push spy');
    return spy;
}

beforeEach(() => {
    latestBodyProps = null;
    focusPromptSpy.mockClear();
    runNowSpy.mockClear();
    modalShowSpy.mockClear();
    modalHideSpy.mockClear();
    modalUpdateSpy.mockClear();
    definitionActions.get.mockReset();
    definitionActions.get.mockResolvedValue(savedDefinition());
    routerMock.value?.spies.push.mockClear();
});

afterEach(async () => {
    await standardCleanup();
});

describe('WorkflowEditorHostScreen saved-entry intents', () => {
    it('opens the definition and triggers nothing when the entry was Edit', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(<WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'definition-exact' }} />);
        await act(async () => {});

        expect(latestBodyProps?.draft).toMatchObject({ name: 'Release check' });
        expect(modalShowSpy).not.toHaveBeenCalled();
        expect(pushSpy()).not.toHaveBeenCalled();
        expect(runNowSpy).not.toHaveBeenCalled();
    });

    it('collects declared inputs through the Run-now owner for a Run intent', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        await renderScreen(
            <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'definition-exact', intent: 'run' }} />,
        );
        await act(async () => {});

        // The reviewed revision is what the person sees and runs; the intent does
        // not replace the hydrated draft with a fresh one.
        expect(latestBodyProps?.draft).toMatchObject({ name: 'Release check' });
        expect(modalShowSpy).toHaveBeenCalledTimes(1);
        // A required declared input is blocking, so nothing is admitted yet and
        // no Automation is written.
        expect(runNowSpy).not.toHaveBeenCalled();
        expect(pushSpy()).not.toHaveBeenCalled();
    });

    it('hands a reviewed copy to the Automation wrapper for a Schedule intent, once', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const source = { kind: 'saved', definitionId: 'definition-exact', intent: 'schedule' } as const;
        const screen = await renderScreen(<WorkflowEditorHostScreen source={source} />);
        await act(async () => {});

        expect(pushSpy()).toHaveBeenCalledTimes(1);
        expect(pushSpy()).toHaveBeenCalledWith({
            pathname: '/automations/new',
            // Only the opaque seed handle travels; no definition content.
            params: { workflowSeedId: expect.any(String) },
        });
        expect(modalShowSpy).not.toHaveBeenCalled();
        expect(runNowSpy).not.toHaveBeenCalled();

        // A rerender of the same logical source is not a second Schedule.
        await screen.update(<WorkflowEditorHostScreen source={{ ...source }} />);
        await act(async () => {});
        expect(pushSpy()).toHaveBeenCalledTimes(1);
    });

    it('consumes a new saved-row intent when the same mounted route changes definition', async () => {
        const { WorkflowEditorHostScreen } = await import('./WorkflowEditorHostScreen');
        const screen = await renderScreen(
            <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'definition-a', intent: 'schedule' }} />,
        );
        await act(async () => {});
        expect(pushSpy()).toHaveBeenCalledTimes(1);

        definitionActions.get.mockResolvedValueOnce({
            ...savedDefinition(),
            definitionId: 'definition-b',
            metadata: { title: 'Second release check' },
        });
        await screen.update(
            <WorkflowEditorHostScreen source={{ kind: 'saved', definitionId: 'definition-b', intent: 'schedule' }} />,
        );
        await act(async () => {});

        // A route rerender is not another press, but a different definition is
        // a distinct row action and must reach the Schedule owner once.
        expect(pushSpy()).toHaveBeenCalledTimes(2);
    });
});
