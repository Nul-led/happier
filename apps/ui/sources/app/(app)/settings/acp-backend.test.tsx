import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routeState = vi.hoisted(() => ({ params: {} as Record<string, string> }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const mock = createExpoRouterMock().module;
    return { ...mock, useLocalSearchParams: () => routeState.params };
});

afterEach(() => {
    routeState.params = {};
    standardCleanup();
});

describe('/settings/acp-backend', () => {
    it('opens older links in the Agents collection: a new agent, or the named one', async () => {
        const Route = (await import('./acp-backend')).default;

        const draft = await renderScreen(React.createElement(Route));
        expect(draft.findAll((node) => (node.type as unknown) === 'Redirect')[0]?.props.href).toBe('/(app)/settings/agents/custom');

        routeState.params = { backendId: 'kiro' };
        const saved = await renderScreen(React.createElement(Route));
        expect(saved.findAll((node) => (node.type as unknown) === 'Redirect')[0]?.props.href).toBe('/(app)/settings/agents/custom/kiro');
    });
});
