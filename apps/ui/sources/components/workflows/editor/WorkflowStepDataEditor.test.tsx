import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import type { WorkflowStep } from '@happier-dev/protocol/workflows/workflowV1';

/**
 * Every mutually exclusive choice set in the step data editor — where a row's
 * value comes from, which workflow input it reads, and which step produces it —
 * is one labelled radiogroup: a reader must hear the set it belongs to, each
 * choice as a radio, and which choice is checked, exactly as the canonical
 * Item primitive exposes a radio's state.
 */

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
    return createTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => (
            params ? `${key}:${JSON.stringify(params)}` : key
        ),
    });
});

afterEach(async () => {
    await standardCleanup();
});

function stepBlock(id: string, input: WorkflowStep['input']): WorkflowStep {
    return {
        kind: 'step',
        id,
        document: { text: '', references: [], attachments: [] },
        input,
        result: { kind: 'text' },
    };
}

async function renderEditor(draft: unknown, step: WorkflowStep) {
    const { WorkflowStepDataEditor } = await import('./WorkflowStepDataEditor');
    return renderScreen(
        <WorkflowStepDataEditor
            draft={draft as Parameters<typeof WorkflowStepDataEditor>['0']['draft']}
            step={step}
            onChangeInput={() => {}}
            testIDPrefix="editor"
        />,
    );
}

function findRadiogroupAncestor(node: ReactTestInstance): ReactTestInstance | null {
    let current = node.parent;
    while (current !== null) {
        if (current.props?.accessibilityRole === 'radiogroup') return current;
        current = current.parent;
    }
    return null;
}

function radiosWithLabel(root: ReactTestInstance, label: string): ReactTestInstance[] {
    // Count host elements only: the Pressable mock wraps a host of the same
    // name, so the composite and host would both match an unscoped search.
    return root.findAll((node) => (
        typeof node.type === 'string'
        && node.props?.accessibilityRole === 'radio'
        && node.props?.accessibilityLabel === label
    ));
}

describe('WorkflowStepDataEditor accessibility', () => {
    it('presents the reference-kind choices as one labelled radiogroup', async () => {
        const draftModule = await import('@/sync/domains/workflows/workflowEditorDraft');
        const step = stepBlock('step-a', [{ kind: 'literal', value: '' }]);
        const draft = draftModule.createWorkflowEditorDraft({ draftId: 'draft-1', name: 'Review', blocks: [step] });

        const screen = await renderEditor(draft, step);

        const selectedChoice = screen.findByTestId('editor-step-step-a-input-0-kind-literal');
        if (selectedChoice === null) throw new Error('Expected the selected literal choice');
        expect(selectedChoice.props.accessibilityRole).toBe('radio');
        expect(selectedChoice.props.accessibilityState).toMatchObject({ checked: true });
        expect(selectedChoice.props.accessibilityLabel).toBeTruthy();
        const unselectedChoice = screen.findByTestId('editor-step-step-a-input-0-kind-input');
        if (unselectedChoice === null) throw new Error('Expected the unselected workflow-input choice');
        expect(unselectedChoice.props.accessibilityState).toMatchObject({ checked: false });
        for (const choice of [selectedChoice, unselectedChoice]) {
            const group = findRadiogroupAncestor(choice);
            expect(group).not.toBeNull();
            expect(group?.props.accessibilityLabel).toBeTruthy();
        }
    });

    it('presents the workflow-input choices as one labelled radiogroup', async () => {
        const draftModule = await import('@/sync/domains/workflows/workflowEditorDraft');
        const step = stepBlock('step-a', [{ kind: 'input', name: 'tone' }]);
        const { setWorkflowInputs } = await import('@happier-dev/protocol/workflows/workflowDefinitionEditV1');
        const draft = setWorkflowInputs(
            draftModule.createWorkflowEditorDraft({ draftId: 'draft-1', name: 'Review', blocks: [step] }),
            [
                { name: 'topic', valueType: 'string', required: false },
                { name: 'tone', valueType: 'string', required: false },
            ],
        );

        const screen = await renderEditor(draft, step);

        const topicChoices = radiosWithLabel(screen.root, 'topic');
        const toneChoices = radiosWithLabel(screen.root, 'tone');
        expect(topicChoices).toHaveLength(1);
        expect(toneChoices).toHaveLength(1);
        expect(topicChoices[0]!.props.accessibilityState).toMatchObject({ checked: false });
        expect(toneChoices[0]!.props.accessibilityState).toMatchObject({ checked: true });
        const group = findRadiogroupAncestor(toneChoices[0]!);
        expect(group).not.toBeNull();
        expect(group?.props.accessibilityLabel).toBeTruthy();
        // Both choices of the set share one containing group.
        expect(findRadiogroupAncestor(topicChoices[0]!)).toBe(group);
    });

    it('presents the producer choices as one labelled radiogroup', async () => {
        const draftModule = await import('@/sync/domains/workflows/workflowEditorDraft');
        const producer = stepBlock('producer-a', []);
        const step = stepBlock('step-a', [
            { kind: 'result', producer: { blockId: 'producer-a', scope: { kind: 'current' } }, path: [] },
        ]);
        const draft = draftModule.createWorkflowEditorDraft({
            draftId: 'draft-1',
            name: 'Review',
            blocks: [producer, step],
        });

        const screen = await renderEditor(draft, step);

        const producerChoices = radiosWithLabel(screen.root, 'producer-a · workflows.input.scopeCurrent');
        expect(producerChoices).toHaveLength(1);
        expect(producerChoices[0]!.props.accessibilityState).toMatchObject({ checked: true });
        const group = findRadiogroupAncestor(producerChoices[0]!);
        expect(group).not.toBeNull();
        expect(group?.props.accessibilityLabel).toBeTruthy();
    });
});
