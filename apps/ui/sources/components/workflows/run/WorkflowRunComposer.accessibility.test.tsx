import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { WorkflowRunComposer, type WorkflowRunComposerProps } from './WorkflowRunComposer';

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

function mount(values: WorkflowRunComposerProps['values'] = {}) {
    return renderScreen(<WorkflowRunComposer inputs={[{ name: 'release', valueType: 'string', required: true }]}
        values={values} onChangeValues={() => {}} onRun={() => {}} onCancel={() => {}} />);
}

describe('workflow composer accessibility', () => {
    it('associates the required repair with the actual main input and an alert', async () => {
        const screen = await mount();
        expect(screen.findByTestId('workflow-run-inputs-reason')?.props.accessibilityRole).toBe('alert');
        expect(screen.findByTestId('new-session-composer-input')?.props.accessibilityHint).toBeTruthy();
    });
    it('explains a disabled Start on the action itself', async () => {
        const screen = await mount();
        const start = screen.findByTestId('workflow-run-inputs-run');
        expect(start?.props.disabled).toBe(true);
        expect(start?.props.accessibilityHint).toBeTruthy();
    });
    it('removes the refusal from the input and Start once the value is repaired', async () => {
        const screen = await mount({ release: '1.2.0' });
        expect(screen.findByTestId('new-session-composer-input')?.props.accessibilityHint).toBeUndefined();
        expect(screen.findByTestId('workflow-run-inputs-run')?.props.disabled).toBe(false);
        expect(screen.findByTestId('workflow-run-inputs-run')?.props.accessibilityHint).toBeUndefined();
        expect(screen.findByTestId('workflow-run-inputs-reason')).toBeNull();
    });
});
