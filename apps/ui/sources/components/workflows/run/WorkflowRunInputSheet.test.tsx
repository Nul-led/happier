import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { WorkflowInputDefinition } from '@happier-dev/protocol/workflows/workflowV1';

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
    return createTextModuleMock({ translate: (key: string) => key });
});

const REQUIRED_INPUT: WorkflowInputDefinition = {
    name: 'release',
    valueType: 'string',
    required: true,
};

const TYPED_INPUT: WorkflowInputDefinition = {
    name: 'attempts',
    valueType: 'number',
    required: false,
};

async function renderSheet(overrides: Record<string, unknown> = {}) {
    const { WorkflowRunInputSheet } = await import('./WorkflowRunInputSheet');
    return renderScreen(React.createElement(WorkflowRunInputSheet, {
        inputs: [REQUIRED_INPUT],
        values: {},
        onChangeValues: () => {},
        onRun: () => {},
        onCancel: () => {},
        ...overrides,
    } as never));
}

describe('WorkflowRunInputSheet accessibility', () => {
    it('associates a blocking field error with its own input the way the editor fields do', async () => {
        const screen = await renderSheet();

        // Same canonical pair the editor's own fields use: the message is an
        // alert, and the repair also reaches assistive technology on the field
        // rather than only as nearby text.
        const error = screen.findByTestId('workflow-run-inputs-release-error');
        expect(error?.props.accessibilityRole).toBe('alert');
        const field = screen.findHostByTestId('workflow-run-inputs-release');
        expect(field?.props.accessibilityHint).toBe('workflows.inputs.missingRequired');
    });

    it('exposes the first blocking reason as the disabled Run action hint', async () => {
        const screen = await renderSheet({ inputs: [REQUIRED_INPUT, TYPED_INPUT] });

        const run = screen.findByTestId('workflow-run-inputs-run');
        expect(run?.props.accessibilityState).toEqual({ disabled: true });
        // The nearby sentence alone leaves the disabled control unexplained for
        // anyone who reaches it directly.
        expect(run?.props.accessibilityHint).toBe('workflows.inputs.missingRequired');
    });

    it('names the type repair on the exact mistyped field and on the refused Run', async () => {
        const screen = await renderSheet({
            inputs: [TYPED_INPUT],
            values: { attempts: 'not a number' },
        });

        const field = screen.findHostByTestId('workflow-run-inputs-attempts');
        expect(field?.props.accessibilityHint).toContain('workflows.inputs.wrongType');
        expect(screen.findByTestId('workflow-run-inputs-attempts-error')?.props.accessibilityRole)
            .toBe('alert');
        expect(screen.findByTestId('workflow-run-inputs-run')?.props.accessibilityHint)
            .toBe('workflows.issue.invalid_input');
    });

    it('drops the hint and enables Run once every declared value is repaired', async () => {
        const screen = await renderSheet({ values: { release: '1.2.0' } });

        const run = screen.findByTestId('workflow-run-inputs-run');
        expect(run?.props.accessibilityState).toEqual({ disabled: false });
        expect(run?.props.accessibilityHint).toBeUndefined();
        expect(screen.findByTestId('workflow-run-inputs-release-error')).toBeNull();
    });
});
