import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import {
    evaluatePluginUiPolicy,
    type PluginUiPolicyEvaluationContext,
} from '@/sync/domains/plugins/ui/policy';

const state = vi.hoisted(() => ({
    mountedProps: null as Record<string, unknown> | null,
    session: null as ReturnType<typeof createSessionFixture> | null,
}));

vi.mock('@/components/plugins/surfaces', () => ({
    PluginInlineSurfaceHost: (props: Record<string, unknown>) => {
        state.mountedProps = props;
        return React.createElement('PluginInlineSurfaceHost');
    },
}));

vi.mock('@/components/plugins/projection/useScopedPluginUiProjection', () => ({
    // The scoped projection owner reports no platform; the shared Session
    // runtime owner resolves it through the canonical preview-platform owner.
    useScopedPluginUiProjection: () => ({
        interactionEnabled: true,
        phase: 'current',
        pluginBrowserProjection: null,
        pluginUiProjection: { surfacePlacementsById: {} },
    }),
}));

vi.mock('@/sync/domains/plugins/ui/surfacePlacementSelectors', () => ({
    selectPluginInlineSurfacePlacementsBySurface: () => [{
        id: 'inline-placement',
        pluginId: 'happier.agent.fixture',
        renderer: { kind: 'declarative' },
    }],
}));

vi.mock('@/components/sessions/model/useSessionMachineTarget', () => ({
    useSessionMachineTarget: () => ({ machineId: 'machine-b', basePath: '/repo' }),
}));

vi.mock('@/sync/store/hooks', () => ({
    useSession: () => state.session,
    useSessionServerId: () => 'server-b',
    useSettings: () => ({}),
}));

vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: (_sessionId: string, expectedServerId?: string | null) => (
        state.session?.serverId === expectedServerId ? state.session : null
    ),
}));

vi.mock('@/utils/sessions/sessionUtils', () => ({
    useSessionStatus: () => ({ state: 'waiting' }),
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesSnapshotForServerId: () => ({ status: 'ready', features: {} }),
    resolveRuntimeFeatureDecisionFromSnapshot: () => ({ state: 'enabled' }),
}));

describe('AgentInlineSurface', () => {
    beforeEach(() => {
        standardCleanup();
        state.mountedProps = null;
        state.session = createSessionFixture({
            id: 'session-1',
            serverId: 'server-b',
            metadataLayoutVersion: 1,
            metadata: {
                path: '/repo',
                host: 'fixture-host',
                agentPresentation: { agentId: 'happier.agent.fixture' },
            },
        });
    });

    it('uses the canonical mounted Session policy facts for inner surface availability', async () => {
        const { AgentInlineSurface } = await import('./AgentInlineSurface');

        await renderScreen(React.createElement(AgentInlineSurface, {
            pluginId: 'happier.agent.fixture',
            surfaceId: 'subagent-launch',
            sessionId: 'session-1',
            agentId: 'happier.agent.fixture',
            inlineMount: { role: 'sessionSubagentLaunch', presentation: 'content' },
        }));

        expect(state.mountedProps).not.toBeNull();
        // The exact Session's Home and machine, from the shared Session runtime
        // owner — never the focused Home or a serialized launch-card machine.
        expect(state.mountedProps?.serverId).toBe('server-b');
        expect(state.mountedProps?.machineId).toBe('machine-b');
        const policyContext = state.mountedProps?.policyContext as PluginUiPolicyEvaluationContext | undefined;
        expect(policyContext).toBeDefined();
        if (!policyContext) throw new Error('fixture policy context must be projected');
        expect(evaluatePluginUiPolicy({
            availability: {
                when: {
                    all: [
                        { fact: 'session.exists', operator: 'equals', value: true },
                        { fact: 'session.agentId', operator: 'equals', value: 'happier.agent.fixture' },
                        { fact: 'session.state', operator: 'equals', value: 'waiting' },
                        { fact: 'machine.id', operator: 'equals', value: 'machine-b' },
                        { fact: 'host.feature', operator: 'enabled', value: 'sessions.handoff' },
                    ],
                },
            },
        }, policyContext)).toMatchObject({
            visible: true,
            enabled: true,
        });
    });

    it('fails closed instead of borrowing a same-id Session from another Home', async () => {
        state.session = createSessionFixture({
            id: 'session-1',
            serverId: 'server-b',
            metadataLayoutVersion: 1,
            metadata: {
                path: '/repo',
                host: 'fixture-host',
                agentPresentation: { agentId: 'happier.agent.fixture' },
            },
        });
        const { AgentInlineSurface } = await import('./AgentInlineSurface');

        await renderScreen(React.createElement(AgentInlineSurface, {
            pluginId: 'happier.agent.fixture',
            surfaceId: 'subagent-launch',
            sessionId: 'session-1',
            serverId: 'server-a',
            agentId: 'happier.agent.fixture',
            inlineMount: { role: 'sessionSubagentLaunch', presentation: 'content' },
        }));

        expect(state.mountedProps).toBeNull();
    });
});
