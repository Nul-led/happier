import React from 'react';
import renderer from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const useFeatureDecisionMock = vi.fn();

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => useFeatureDecisionMock(),
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text' }));
vi.mock('@/components/ui/surfaces/SurfaceStateCard', () => ({
    SurfaceStateCard: (props: Record<string, unknown>) => React.createElement('SurfaceStateCard', props),
}));

afterEach(() => {
    useFeatureDecisionMock.mockReset();
});

describe('WorkflowsGate', () => {
    it('fails closed while the Workflow server decision is unresolved', async () => {
        useFeatureDecisionMock.mockReturnValue(null);

        const { WorkflowsGate } = await import('./WorkflowsGate');
        const tree = (await renderScreen(
            <WorkflowsGate><Allowed /></WorkflowsGate>,
        )).tree;

        expect(tree.root.findAllByProps({ testID: 'workflows-allowed-child' })).toHaveLength(0);
        const loading = tree.root.findByProps({ testID: 'workflows-gate-loading' });
        expect(loading.props).toMatchObject({
            kind: 'loading',
            accessibilitySemantics: 'status',
        });
    });

    it('renders children only for the enabled canonical decision', async () => {
        useFeatureDecisionMock.mockReturnValue({ state: 'enabled' });

        const { WorkflowsGate } = await import('./WorkflowsGate');
        const tree = (await renderScreen(
            <WorkflowsGate><Allowed /></WorkflowsGate>,
        )).tree;

        expect(tree.root.findAllByProps({ testID: 'workflows-allowed-child' })).toHaveLength(1);
    });

    it('keeps Workflow surfaces unavailable when the server bit is disabled', async () => {
        useFeatureDecisionMock.mockReturnValue({ state: 'disabled', blockedBy: 'server' });

        const { WorkflowsGate } = await import('./WorkflowsGate');
        const tree = (await renderScreen(
            <WorkflowsGate><Allowed /></WorkflowsGate>,
        )).tree;

        expect(tree.root.findAllByProps({ testID: 'workflows-allowed-child' })).toHaveLength(0);
        const unavailable = tree.root.findByProps({ testID: 'workflows-gate-disabled' });
        expect(unavailable.props).toMatchObject({
            kind: 'unavailable',
            accessibilitySemantics: 'status',
        });
    });

    /**
     * An unavailable capability is not a failed read. Borrowing the load-failure
     * copy told people their workflows could not be loaded and invited a retry
     * that could never succeed; the canonical Workflow problem mapping owns the
     * unavailable state and its (absent) repair.
     */
    it('states the capability is unavailable instead of borrowing load-failure copy', async () => {
        useFeatureDecisionMock.mockReturnValue({ state: 'disabled', blockedBy: 'server' });

        const { WorkflowsGate } = await import('./WorkflowsGate');
        const tree = (await renderScreen(
            <WorkflowsGate><Allowed /></WorkflowsGate>,
        )).tree;

        const unavailable = tree.root.findByProps({ testID: 'workflows-gate-disabled' });
        expect(unavailable.props).toMatchObject({
            title: 'workflows.unavailable.title',
            reason: 'workflows.unavailable.body',
        });
        expect(unavailable.props.action).toBeUndefined();
    });
});

function Allowed(): React.ReactElement {
    return React.createElement('Text', { testID: 'workflows-allowed-child' }, 'Allowed');
}
