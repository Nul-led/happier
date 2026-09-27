import { describe, expect, it } from 'vitest';

import {
    createAgentSettingsRoute,
    createCustomAcpAgentSettingsRoute,
    createPluginAgentSettingsRoute,
    resolveAgentModelsTargetKey,
    resolveCustomAcpAgentRoute,
} from './agentSettingsRoutes';

describe('agentSettingsRoutes', () => {
    it('addresses custom ACP agents inside the Agents collection: a draft, or a saved agent by id', () => {
        expect(createCustomAcpAgentSettingsRoute(null)).toBe('/(app)/settings/agents/custom');
        expect(createCustomAcpAgentSettingsRoute('my.agent')).toBe('/(app)/settings/agents/custom/my.agent');
        expect(resolveCustomAcpAgentRoute('/settings/agents/custom')).toEqual({ kind: 'draft' });
        expect(resolveCustomAcpAgentRoute('/settings/agents/custom/my.agent/')).toEqual({ kind: 'saved', backendId: 'my.agent' });
        expect(resolveCustomAcpAgentRoute('/settings/agents/claude')).toBeNull();
        expect(resolveCustomAcpAgentRoute('/settings/agents/custom/a/models')).toBeNull();
    });

    it('retains exact plugin identity when Agents share one local id', () => {
        const left = { pluginId: 'acme.agent-one', localId: 'assistant' };
        const right = { pluginId: 'acme.agent-two', localId: 'assistant' };

        expect(createAgentSettingsRoute({ agentId: 'left', identity: left }))
            .toBe('/(app)/settings/agents/assistant?pluginId=acme.agent-one');
        expect(createAgentSettingsRoute({ agentId: 'right', identity: right }))
            .toBe('/(app)/settings/agents/assistant?pluginId=acme.agent-two');
        expect(createPluginAgentSettingsRoute(right))
            .toBe('/(app)/settings/agents/assistant?pluginId=acme.agent-two');
    });

    it('keeps bundled-only Agents on their canonical local route', () => {
        expect(createAgentSettingsRoute({ agentId: 'codex', identity: null }))
            .toBe('/(app)/settings/agents/codex');
    });

    it('never recreates the built-in backend target split for model settings', () => {
        expect(resolveAgentModelsTargetKey({ agentId: 'codex' }))
            .toBe('agent:happier.agent.codex/codex');
        expect(resolveAgentModelsTargetKey({
            agentId: 'assistant',
            pluginId: 'acme.agent',
        })).toBe('agent:acme.agent/assistant');
        expect(resolveAgentModelsTargetKey({
            agentId: 'codex',
            agentTargetKey: 'agent:override.agent/codex',
        })).toBe('agent:override.agent/codex');
    });
});
