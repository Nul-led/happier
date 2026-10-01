import { describe, expect, it } from 'vitest';
import { buildMachineAgentInventoryDescriptors } from './machineAgentCatalog';

describe('machine agent catalog', () => {
    it('lists only registry agents that declare session capabilities, including disabled and qualified plugin agents', () => {
        expect(buildMachineAgentInventoryDescriptors({ pluginProjectionV2: { agentsById: {
            'plugin/agent': { id: 'agent', title: 'Agent', providerOwnedEnvironmentKeys: [], capabilities: { surfaces: [], sessions: { open: ['create'], delivery: ['newTurn'], cancel: true } } },
            helper: { id: 'helper', title: 'Helper', providerOwnedEnvironmentKeys: [], capabilities: { surfaces: [] } },
        } } })).toEqual([{ agentId: 'plugin/agent', title: 'Agent' }]);
        expect(buildMachineAgentInventoryDescriptors(null)).toEqual([]);
    });
});
