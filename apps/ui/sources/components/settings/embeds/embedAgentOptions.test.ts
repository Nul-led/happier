import { describe, expect, it } from 'vitest';

import { selectEmbedAgentOptions } from './embedAgentOptions';

const entry = (backendTargetKey: string, catalogAgentId: string | null) => ({ backendTargetKey, catalogAgentId });
const agent = (agentId: string, installed: boolean) => ({ agentId, installed });

describe('embed agent options', () => {
    const claude = entry('agent:claude', 'claude');
    const codex = entry('agent:codex', 'codex');
    const plugin = entry('plugin:acme', null);

    it('offers only the agents installed on the bound computer', () => {
        const inventory = { status: 'ready' as const, agents: [agent('claude', true), agent('codex', false)] };
        expect(selectEmbedAgentOptions([claude, codex, plugin], inventory, null)).toEqual([claude, plugin]);
    });

    it('keeps the bound agent so a stored choice is never silently replaced', () => {
        const inventory = { status: 'ready' as const, agents: [agent('claude', true), agent('codex', false)] };
        expect(selectEmbedAgentOptions([claude, codex], inventory, 'agent:codex')).toEqual([claude, codex]);
    });

    it('does not narrow while the computer has not reported what it has', () => {
        expect(selectEmbedAgentOptions([claude, codex], { status: 'loading', agents: [] }, null)).toEqual([claude, codex]);
    });
});
