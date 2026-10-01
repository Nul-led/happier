import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { WorkflowRunComposer } from './WorkflowRunComposer';
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

const inputs: readonly WorkflowInputDefinition[] = [
    { name: 'brief', valueType: 'string', required: true },
    { name: 'version', valueType: 'number', required: true },
    { name: 'announce', valueType: 'boolean', required: false, default: true },
];

async function mount(initial: React.ComponentProps<typeof WorkflowRunComposer>['values'] = {}) {
    const onRun = vi.fn();
    function Host() {
        const [values, onChangeValues] = React.useState(initial);
        return <WorkflowRunComposer inputs={inputs} values={values} onChangeValues={onChangeValues} onRun={onRun} onCancel={() => {}} />;
    }
    return { screen: await renderScreen(<Host />), onRun };
}

describe('workflow composer admission', () => {
    it('projects the first text input into the composer and other inputs into its chip', async () => {
        const { screen } = await mount({ brief: 'Release the current draft' });
        expect(screen.findByTestId('workflow-run-inputs-main')).not.toBeNull();
        expect(screen.findByTestId('workflow-run-inputs-inputs-chip')).not.toBeNull();
        expect(screen.findByTestId('workflow-run-inputs-run')?.props.disabled).toBe(true);
    });

    it('submits validated supplied inputs and defaults through the start callback', async () => {
        const { screen, onRun } = await mount({ brief: 'Keep exact whitespace  ', version: 3 });
        await screen.pressByTestIdAsync('workflow-run-inputs-run');
        expect(onRun).toHaveBeenCalledWith({ brief: 'Keep exact whitespace  ', version: 3, announce: true });
    });

    it('does not admit missing required input even if the Start handler is invoked', async () => {
        const { screen, onRun } = await mount({ brief: 'Release' });
        await screen.pressByTestIdAsync('workflow-run-inputs-run');
        expect(onRun).not.toHaveBeenCalled();
        expect(screen.findByTestId('workflow-run-inputs-reason')).not.toBeNull();
    });

    it('keeps a no-text workflow inspectable without a dead editable input', async () => {
        const screen = await renderScreen(<WorkflowRunComposer inputs={[]} values={{}} onChangeValues={() => {}} onRun={() => {}} onCancel={() => {}} />);
        expect(screen.findByTestId('workflow-run-inputs-preview')).not.toBeNull();
        expect(screen.findByTestId('workflow-run-inputs-run')?.props.disabled).toBe(false);
    });
});
