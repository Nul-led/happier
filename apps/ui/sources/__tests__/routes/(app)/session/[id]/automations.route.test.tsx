import * as React from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const automationsScreenSpy = vi.hoisted(() => vi.fn());
const workflowEditorScreenSpy = vi.hoisted(() => vi.fn());

const routerMock = createExpoRouterMock({
    params: { id: ['s1', 's2'] },
    router: {
        push: vi.fn(),
        back: vi.fn(),
        replace: vi.fn(),
        setParams: vi.fn(),
    },
});

vi.mock('expo-router', () => routerMock.module);

vi.mock('@/components/automations/gating/AutomationsGate', () => ({
    AutomationsGate: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/automations/screens/SessionAutomationsScreen', () => ({
    SessionAutomationsScreen: (props: { sessionId: string }) => automationsScreenSpy(props),
}));

vi.mock('@/components/workflows/screens/SessionWorkflowEditorScreen', () => ({
    SessionWorkflowEditorScreen: (props: { sessionId: string }) => workflowEditorScreenSpy(props),
}));

describe('session automations routes', () => {
    beforeEach(() => {
        automationsScreenSpy.mockClear();
        workflowEditorScreenSpy.mockClear();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('normalizes array session ids before rendering the automations screen', async () => {
        const { default: AutomationsRoute } = await import('@/app/(app)/session/[id]/automations');

        await renderScreen(<AutomationsRoute />);

        expect(automationsScreenSpy).toHaveBeenCalledWith({ sessionId: 's1' });
    });

    it('normalizes array session ids before rendering the canonical Workflow editor', async () => {
        const { default: CreateRoute } = await import('@/app/(app)/session/[id]/automations/new');

        await renderScreen(<CreateRoute />);

        expect(workflowEditorScreenSpy).toHaveBeenCalledTimes(1);
        expect(workflowEditorScreenSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
    });
});
