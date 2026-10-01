import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

/**
 * Render scope while authoring.
 *
 * The draft owner already preserves untouched subtree identity, but that only
 * pays off if the change stops at the row that changed. This measures the one
 * expensive thing a Workflow step mounts — its composer — and fails if typing
 * into one step executes another step's composer. It is deliberately a count,
 * not a memoization assertion: an implementation that reaches the same scope
 * another way passes.
 */

const composerRenders = vi.hoisted(() => ({ byBlockId: new Map<string, number>() }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@/components/ui/popover/Popover', () => ({
    Popover: (props: { open: boolean; children: (render: unknown) => React.ReactNode }) =>
        (props.open ? React.createElement(React.Fragment, null, props.children({})) : null),
}));
vi.mock('@/components/ui/icons/Icon', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
}));
// The composer host is the expensive leaf; counting its executions per block is
// the measurement. The scoped authoring composer and its document owner stay
// real above it.
vi.mock('@/components/sessions/agentInput', () => ({
    AgentInput: (props: Record<string, any>) => {
        const blockId = String(props.composerRef?.blockId ?? '');
        composerRenders.byBlockId.set(blockId, (composerRenders.byBlockId.get(blockId) ?? 0) + 1);
        return React.createElement('AgentInput', {
            testID: `composer-${blockId}`,
            value: props.value,
            onChangeText: props.onChangeText,
        });
    },
}));
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({ phase: 'idle', inputs: null }),
}));
vi.mock('@/components/plugins/surfaces/PluginContextualResourceStoreProvider', () => ({
    PluginContextualResourceStoreProvider: (props: Readonly<{ children?: React.ReactNode }>) =>
        React.createElement(React.Fragment, null, props.children),
}));

beforeEach(() => {
    composerRenders.byBlockId.clear();
});

afterEach(async () => {
    await standardCleanup();
});

const AGENT_TARGET = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } };

describe('workflow authoring render scope', () => {
    it('does not execute a sibling step composer when one step prompt changes', async () => {
        const { WorkflowBlockListEditor } = await import('./WorkflowBlockListEditor');
        const { createWorkflowEditorDraft } = await import('@/sync/domains/workflows/workflowEditorDraft');
        const { validateWorkflowEditorDraft } = await import('@/sync/domains/workflows/workflowAuthoring');
        const { createWorkflowAuthoringComposerCustody } = await import(
            '@/components/sessions/authoring/authoringComposerCustody'
        );
        const composerCustody = createWorkflowAuthoringComposerCustody('draft-1');

        const initialDraft = createWorkflowEditorDraft({
            draftId: 'draft-1',
            name: 'Review',
            defaults: { agentTarget: AGENT_TARGET },
            blocks: Array.from({ length: 8 }, (_unused, index) => ({
                kind: 'step' as const,
                id: `step-${index}`,
                document: { text: `Prompt ${index}`, references: [], attachments: [] },
                input: [],
                result: { kind: 'text' as const },
            })),
        });

        function Harness() {
            const [draft, setDraft] = React.useState(initialDraft);
            const validation = React.useMemo(() => validateWorkflowEditorDraft(draft), [draft]);
            return React.createElement(WorkflowBlockListEditor, {
                draft,
                list: { kind: 'root' },
                blocks: draft.blocks,
                depth: 0,
                selectedBlockId: null,
                composerScope: {
                    kind: 'machine',
                    machineId: 'machine-1',
                    serverId: 'server-a',
                    directory: '/repo/project',
                    machineHomeDir: '/Users/me',
                },
                composerCustody,
                validation,
                onChange: setDraft,
                onSelect: () => {},
                onCustomize: () => {},
                testIDPrefix: 'workflow-editor',
            });
        }

        const screen = await renderScreen(React.createElement(Harness));
        const changedId = 'step-3';
        const siblingId = 'step-6';
        expect(composerRenders.byBlockId.get(changedId)).toBe(1);
        expect(composerRenders.byBlockId.get(siblingId)).toBe(1);

        await act(async () => {
            screen.findByTestId(`composer-${changedId}`)?.props.onChangeText('Prompt 3 edited');
        });

        expect(composerRenders.byBlockId.get(changedId)).toBe(2);
        // The whole draft object necessarily changes on every keystroke, so a
        // sibling composer re-executing here is the fan-out UI-07 names.
        expect(composerRenders.byBlockId.get(siblingId)).toBe(1);
    });
});
