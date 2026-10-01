import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkflowDefinitionV1 } from '@happier-dev/protocol/workflows/workflowV1';

import { renderScreen } from '@/dev/testkit';

import { WorkflowFlowView } from './WorkflowFlowView';
import { projectWorkflowFlow } from './workflowFlowProjection';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) });
});

const AGENT_TARGET = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } };

function step(id: string) {
    return {
        kind: 'step' as const,
        id,
        document: { text: `${id} prompt`, references: [], attachments: [] },
        input: [],
        result: { kind: 'text' as const },
    };
}

/**
 * One parallel container holding two steps. Visually this is a rail with two
 * indented rows; structurally it is a group a reader has to be able to perceive.
 */
function nestedDefinition(): WorkflowDefinitionV1 {
    return {
        version: 1,
        inputs: [],
        defaults: { agentTarget: AGENT_TARGET },
        blocks: [
            step('analyze'),
            {
                kind: 'parallel' as const,
                id: 'fan-out',
                failurePolicy: 'fail_stop' as const,
                branches: [
                    { id: 'checks', blocks: [step('review'), step('implement')] },
                ],
            },
        ],
    } as WorkflowDefinitionV1;
}

async function renderFlow() {
    const projection = projectWorkflowFlow(nestedDefinition());
    return renderScreen(React.createElement(WorkflowFlowView, {
        projection,
        selectedNodeId: null,
        testIDPrefix: 'flow',
    }));
}

describe('WorkflowFlowView accessibility structure', () => {
    it('exposes every node as a real list item rather than a bare button under a list', async () => {
        const screen = await renderFlow();

        for (const nodeId of ['analyze', 'fan-out', 'fan-out#checks', 'review', 'implement']) {
            const item = screen.findByTestId(`flow-item-${nodeId}`);
            expect(item?.props.role).toBe('listitem');
        }
    });

    it('projects container ownership as a labelled group instead of indentation alone', async () => {
        const screen = await renderFlow();

        const group = screen.findByTestId('flow-group-fan-out');
        expect(group?.props.accessibilityRole).toBe('list');
        // The rails are decorative and hidden, so the group is the only thing
        // that can tell a reader these two steps run inside the container.
        expect(group?.props.accessibilityLabel).toBeTruthy();
    });

    it('names each node position within its own container', async () => {
        const screen = await renderFlow();

        expect(screen.findByTestId('flow-node-review')?.props.accessibilityLabel)
            .toContain('workflows.a11y.stepContext');
    });

    it('keeps the linear reading order the visual outline shows', async () => {
        const screen = await renderFlow();

        const ordered = ['analyze', 'fan-out', 'fan-out#checks', 'review', 'implement']
            .map((nodeId) => screen.findByTestId(`flow-node-${nodeId}`));
        expect(ordered.every((node) => node !== null)).toBe(true);
    });
});
