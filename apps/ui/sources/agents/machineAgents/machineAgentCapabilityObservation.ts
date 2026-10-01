import { projectMachineAgentsDetectResponse, type MachineAgentInventoryDescriptor, type MachineAgentInventoryItem } from '@happier-dev/protocol/capabilities';
import type { MachineCapabilitiesCacheState } from '@/hooks/server/useMachineCapabilitiesCache';
import type { MachineAgentInventoryObservation } from './machineAgentInventoryStore';

export function projectMachineAgentCapabilityObservation(agents: readonly MachineAgentInventoryDescriptor[], cache: MachineCapabilitiesCacheState | null): MachineAgentInventoryObservation {
    const snapshot = cache && 'snapshot' in cache ? cache.snapshot : undefined;
    const items: MachineAgentInventoryItem[] = [];
    let incomplete = false;
    let lastCheckedAt: number | null = null;
    if (snapshot) {
        for (const agent of agents) {
            try {
                items.push(...projectMachineAgentsDetectResponse({ agents: [agent], response: snapshot.response }).items);
                const checkedAt = snapshot.response.results[`cli.${agent.agentId}`]?.checkedAt;
                if (typeof checkedAt === 'number') lastCheckedAt = Math.max(lastCheckedAt ?? 0, checkedAt);
            } catch { incomplete = true; }
        }
    }
    const status = !cache || cache.status === 'idle' || cache.status === 'loading'
        ? 'loading'
        : cache.status === 'loaded' && !incomplete ? 'ready' : 'error';
    return { status, items, descriptors: agents, lastCheckedAt };
}
