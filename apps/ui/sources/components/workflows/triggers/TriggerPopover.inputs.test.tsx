import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { act } from 'react-test-renderer';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
// The portal is a platform boundary; keep the trigger form and its typed fields real.
vi.mock('@/components/ui/popover', () => ({
    Popover: ({ children }: { children: (size: { maxHeight: number }) => React.ReactNode }) => children({ maxHeight: 640 }),
}));

const { TriggerPopover } = await import('./TriggerPopover');

describe('Run a workflow trigger inputs', () => {
    it('shows defaults, refuses missing or invalid inputs, and submits typed edits', async () => {
        const submit = vi.fn<React.ComponentProps<typeof TriggerPopover>['onSubmit']>(async () => {});
        const screen = await renderScreen(<TriggerPopover testID="typed-trigger" anchorRef={React.createRef()}
            onRequestClose={vi.fn()} whenKinds={['turnEnds']} sessionId="session-1"
            initial={{ when: { kind: 'turnEnds' }, enabled: true,
                then: { kind: 'runWorkflow', ref: 'builtin:review-and-converge', inputs: {} } }}
            workflowOptions={[{ ref: 'builtin:review-and-converge', title: 'Review & converge' }]} onSubmit={submit} />);
        const field = (name: string) => screen.findByTestId(`typed-trigger-input-${name}`);
        expect(field('maxRounds')?.props.value).toBe('3');
        expect(screen.findByTestId('typed-trigger-submit')?.props.disabled).toBe(true);
        await act(async () => {
            screen.findAll((node) => node.props.label === 'engines' && typeof node.props.onChange === 'function')[0]?.props.onChange(['codex']);
        });
        await act(async () => { screen.changeTextByTestId('typed-trigger-input-maxRounds', '3e'); });
        expect(field('maxRounds')?.props.value).toBe('3e');
        expect(screen.findByTestId('typed-trigger-submit')?.props.disabled).toBe(true);
        await act(async () => { screen.changeTextByTestId('typed-trigger-input-maxRounds', '5'); });
        expect(screen.findByTestId('typed-trigger-submit')?.props.disabled).toBe(false);
        await act(async () => { screen.pressByTestId('typed-trigger-submit'); });
        expect(submit.mock.calls[0]?.[1]).toMatchObject({ target: { kind: 'workflow', ref: 'builtin:review-and-converge' },
            inputs: { engines: ['codex'], maxRounds: 5, apply: 'fix', useJudge: false } });
    });
});
